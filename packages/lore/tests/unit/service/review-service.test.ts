/** @spec_ref AC-REVIEW-001 */
/**
 * Tests for ReviewService — human review workflow.
 * Source: SPEC-005 §3, §4, §6
 *
 * Test plan:
 * EP:       pending(no filter), pending(author), pending(type), pending(since)
 * BVA:      empty store, all-approved store
 * STATE:    approve draft→approved, reject keeps draft, reject in-review→draft
 * NEGATIVE: approve already-approved, approve archived, reject approved, reject archived
 * ERROR:    approve non-existent id, reject non-existent id
 * REGRESSION: rejected doc version unchanged; approved doc absent from pending
 *
 * SPEC-036 addendum — PendingDoc.meta projection (source: task dispatch contract,
 * "PendingDoc.meta 投影 + dashboard pending 徽章", cross-referencing SPEC-036 §2 D3
 * `deriveTypeMeta`). Written BEFORE reading `pending()`'s / `toPendingDoc`'s bodies —
 * only the public `PendingDoc`/`ReviewService` signatures (JSDoc + constructor) and
 * the `@lore/core` `DocTypeMeta` union + enum SSOTs (`SPEC_KINDS`, `DECISION_STATUSES`,
 * `KNOWLEDGE_SUB_TYPES`) were read.
 * HAPPY:      knowledge (2 distinct sub_type values), spec kind, adr decision_status,
 *             plan phase_count, task evidence counts (2 distinct value sets)
 * NEGATIVE:   prd omits meta key entirely; illegal spec_kind/decision_status/sub_type
 *             each omit meta entirely (not a fabricated default)
 * BOUNDARY:   missing spec_kind defaults to "feature" (documented create-time default);
 *             missing extra.phases -> phase_count 0; task with no claim/evidence omits
 *             claimed_by and yields 0/0; claim_stale key absent entirely when the
 *             service isn't constructed with claimTtlMinutes; claim_stale computed
 *             true/false once claimTtlMinutes IS injected
 * ERROR:      malformed extra (wrong types) does not throw through pending() — N/A for
 *             store-level failure propagation, see inline note below
 * STATE:      pending() reflects freshly-appended evidence on re-read (no caching)
 * REGRESSION: original PendingDoc fields (id/type/title/status/created_by/updated_at/
 *             version) are unaffected by meta projection on a non-prd doc
 */

import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { ReviewService } from "../../../src/service/review-service.js";
import type { DocRecord } from "@lore/core";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { actedStore } from "../../live-invocation.js";

// ─── Factories ───────────────────────────────────────────────────────────────

let _seq = 0;

function nextId(): string {
  _seq += 1;
  return `01HREV${String(_seq).padStart(20, "0")}`;
}

function makeDoc(overrides: Partial<DocRecord> = {}): DocRecord {
  _seq += 1;
  return {
    id: nextId(),
    slug: `prd-test-doc-${_seq}`,
    type: "prd",
    role: "intent",
    title: `Test Doc ${_seq}`,
    status: "draft",
    priority: "medium",
    content: "Test content",
    parent_id: null,
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
    created_by: "alice",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ReviewService", () => {
  let store: InMemoryStore;
  let service: ReviewService;

  beforeEach(() => {
    _seq = 0;
    store = actedStore(new InMemoryStore());
    service = new ReviewService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  });

  // ── pending ───────────────────────────────────────────────────────────────

  describe("pending", () => {
    describe("happy path", () => {
      it("returns only draft docs from a mixed set", async () => {
        const draft1 = makeDoc({ status: "draft", created_by: "alice" });
        const draft2 = makeDoc({ status: "draft", created_by: "bob" });
        const approved = makeDoc({ status: "approved", created_by: "carol" });

        await store.insert(draft1);
        await store.insert(draft2);
        await store.insert(approved);

        const result = await service.pending();

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value).toHaveLength(2);
        const ids = result.value.map((d) => d.id);
        expect(ids).toContain(draft1.id);
        expect(ids).toContain(draft2.id);
        expect(ids).not.toContain(approved.id);
      });

      it("returns PendingDoc shape with correct fields", async () => {
        const doc = makeDoc({
          status: "draft",
          created_by: "alice",
          title: "My Draft",
          type: "prd",
          version: 3,
          updated_at: "2026-06-05T10:00:00.000Z",
        });
        await store.insert(doc);

        const result = await service.pending();

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(1);

        const pending = result.value[0]!;
        expect(pending.id).toBe(doc.id);
        expect(pending.type).toBe("prd");
        expect(pending.title).toBe("My Draft");
        expect(pending.status).toBe("draft");
        expect(pending.created_by).toBe("alice");
        expect(pending.version).toBe(3);
        expect(pending.updated_at).toBe("2026-06-05T10:00:00.000Z");
      });
    });

    describe("filter: author", () => {
      it("returns only docs created by the specified author", async () => {
        const aliceDoc = makeDoc({ status: "draft", created_by: "alice" });
        const bobDoc = makeDoc({ status: "draft", created_by: "bob" });
        await store.insert(aliceDoc);
        await store.insert(bobDoc);

        const result = await service.pending({ author: "alice" });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(1);
        expect(result.value[0]!.id).toBe(aliceDoc.id);
      });

      it("returns empty array when author has no drafts", async () => {
        const doc = makeDoc({ status: "draft", created_by: "alice" });
        await store.insert(doc);

        const result = await service.pending({ author: "nobody" });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(0);
      });
    });

    describe("filter: type", () => {
      it("returns only docs of the specified type", async () => {
        const prdDoc = makeDoc({ status: "draft", type: "prd" });
        const adrDoc = makeDoc({
          status: "draft",
          type: "adr",
          extra: { decision_status: "proposed" },
        });
        await store.insert(prdDoc);
        await store.insert(adrDoc);

        const result = await service.pending({ type: "prd" });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(1);
        expect(result.value[0]!.type).toBe("prd");
      });
    });

    describe("filter: since", () => {
      it("returns only docs updated at or after the since timestamp", async () => {
        const oldDoc = makeDoc({
          status: "draft",
          updated_at: "2026-01-01T00:00:00.000Z",
        });
        const newDoc = makeDoc({
          status: "draft",
          slug: "prd-newer-doc",
          updated_at: "2026-06-01T00:00:00.000Z",
        });
        await store.insert(oldDoc);
        await store.insert(newDoc);

        const result = await service.pending({ since: "2026-05-01T00:00:00.000Z" });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(1);
        expect(result.value[0]!.id).toBe(newDoc.id);
      });
    });

    describe("boundary values", () => {
      it("returns empty array when store has no docs at all", async () => {
        const result = await service.pending();

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(0);
      });

      it("returns empty array when all docs are approved (no drafts)", async () => {
        const approved = makeDoc({ status: "approved" });
        await store.insert(approved);

        const result = await service.pending();

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(0);
      });
    });

    describe("meta projection (SPEC-036 / PendingDoc.meta)", () => {
      describe("happy path", () => {
        it("knowledge doc projects extra.sub_type='research' into meta", async () => {
          const doc = makeDoc({ status: "draft", type: "knowledge", extra: { sub_type: "research" } });
          await store.insert(doc);

          const result = await service.pending();

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(result.value[0]!.meta).toEqual({ t: "knowledge", sub_type: "research" });
        });

        // Distinct sub_type value from the case above — defeats a hardcoded/constant projection.
        // SPEC-103 M3 — "assessment" is a ledger sub_type, hidden from the default queue;
        // `{ all: true }` restores it so this meta-PROJECTION assertion (unrelated to M3's
        // own filtering concern) still observes the doc.
        it("knowledge doc projects extra.sub_type='assessment' into meta", async () => {
          const doc = makeDoc({ status: "draft", type: "knowledge", extra: { sub_type: "assessment" } });
          await store.insert(doc);

          const result = await service.pending({ all: true });

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(result.value[0]!.meta).toEqual({ t: "knowledge", sub_type: "assessment" });
        });

        it("spec doc projects extra.spec_kind into meta.kind", async () => {
          const doc = makeDoc({ status: "draft", type: "spec", extra: { spec_kind: "tech" } });
          await store.insert(doc);

          const result = await service.pending();

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(result.value[0]!.meta).toEqual({ t: "spec", kind: "tech" });
        });

        it("adr doc projects extra.decision_status into meta", async () => {
          const doc = makeDoc({ status: "draft", type: "adr", extra: { decision_status: "accepted" } });
          await store.insert(doc);

          const result = await service.pending();

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(result.value[0]!.meta).toEqual({ t: "adr", decision_status: "accepted" });
        });

        it("plan doc projects extra.phases.length into meta.phase_count", async () => {
          const doc = makeDoc({
            status: "draft",
            type: "plan",
            extra: { phases: [{ name: "P1" }, { name: "P2" }] },
          });
          await store.insert(doc);

          const result = await service.pending();

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(result.value[0]!.meta).toEqual({ t: "plan", phase_count: 2 });
        });

        it("task doc with 2 pass / 1 fail evidence entries projects those exact counts", async () => {
          const doc = makeDoc({
            status: "draft",
            type: "task",
            extra: {
              plan_id: "01HPLAN000000000000000001",
              verification_evidence: [
                { oracle: "tsc", command: "bun run typecheck", result: "pass", recorded_at: "2026-07-01T00:00:00.000Z", recorded_by: "alice" },
                { oracle: "test", command: "bun test", result: "pass", recorded_at: "2026-07-01T00:01:00.000Z", recorded_by: "alice" },
                { oracle: "lint", command: "bun run lint", result: "fail", recorded_at: "2026-07-01T00:02:00.000Z", recorded_by: "alice" },
              ],
            },
          });
          await store.insert(doc);

          // SPEC-103 M3 — task is hidden from the default queue; `{ all: true }` restores
          // it (unrelated to this test's actual concern: meta evidence-count projection).
          const result = await service.pending({ all: true });

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          const meta = result.value[0]!.meta;
          expect(meta).toMatchObject({ t: "task", evidence_pass: 2, evidence_fail: 1 });
        });

        // Distinct evidence counts from the case above — defeats a hardcoded projection.
        it("task doc with 0 pass / 3 fail evidence entries projects those exact counts", async () => {
          const doc = makeDoc({
            status: "draft",
            type: "task",
            extra: {
              plan_id: "01HPLAN000000000000000001",
              verification_evidence: [
                { oracle: "test", command: "bun test a", result: "fail", recorded_at: "2026-07-01T00:00:00.000Z", recorded_by: "bob" },
                { oracle: "test", command: "bun test b", result: "fail", recorded_at: "2026-07-01T00:01:00.000Z", recorded_by: "bob" },
                { oracle: "test", command: "bun test c", result: "fail", recorded_at: "2026-07-01T00:02:00.000Z", recorded_by: "bob" },
              ],
            },
          });
          await store.insert(doc);

          // SPEC-103 M3 — see the sibling "2 pass / 1 fail" case's identical comment.
          const result = await service.pending({ all: true });

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          const meta = result.value[0]!.meta;
          expect(meta).toMatchObject({ t: "task", evidence_pass: 0, evidence_fail: 3 });
        });
      });

      describe("negative", () => {
        it("prd doc omits the meta key entirely (not a fabricated undefined/empty object)", async () => {
          const doc = makeDoc({ status: "draft", type: "prd" });
          await store.insert(doc);

          const result = await service.pending();

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect("meta" in result.value[0]!).toBe(false);
        });

        it("spec doc with an illegal spec_kind omits meta entirely (does not fall back to a default)", async () => {
          const doc = makeDoc({ status: "draft", type: "spec", extra: { spec_kind: "not-a-real-kind" } });
          await store.insert(doc);

          const result = await service.pending();

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect("meta" in result.value[0]!).toBe(false);
        });

        it("adr doc with an illegal decision_status omits meta entirely", async () => {
          const doc = makeDoc({ status: "draft", type: "adr", extra: { decision_status: "bogus" } });
          await store.insert(doc);

          const result = await service.pending();

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect("meta" in result.value[0]!).toBe(false);
        });

        it("knowledge doc with a missing sub_type omits meta entirely", async () => {
          const doc = makeDoc({ status: "draft", type: "knowledge", extra: {} });
          await store.insert(doc);

          const result = await service.pending();

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect("meta" in result.value[0]!).toBe(false);
        });

        it("knowledge doc with an illegal sub_type omits meta entirely", async () => {
          const doc = makeDoc({ status: "draft", type: "knowledge", extra: { sub_type: "not-a-real-subtype" } });
          await store.insert(doc);

          const result = await service.pending();

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect("meta" in result.value[0]!).toBe(false);
        });
      });

      describe("boundary values", () => {
        it("spec doc missing extra.spec_kind defaults meta.kind to 'feature' (documented create-time default)", async () => {
          const doc = makeDoc({ status: "draft", type: "spec", extra: {} });
          await store.insert(doc);

          const result = await service.pending();

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(result.value[0]!.meta).toEqual({ t: "spec", kind: "feature" });
        });

        it("plan doc missing extra.phases yields phase_count 0", async () => {
          const doc = makeDoc({ status: "draft", type: "plan", extra: {} });
          await store.insert(doc);

          const result = await service.pending();

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(result.value[0]!.meta).toEqual({ t: "plan", phase_count: 0 });
        });

        it("task doc with no claim and no evidence yields evidence_pass:0, evidence_fail:0 and omits claimed_by (not undefined)", async () => {
          const doc = makeDoc({
            status: "draft",
            type: "task",
            extra: { plan_id: "01HPLAN000000000000000001" },
          });
          await store.insert(doc);

          // SPEC-103 M3 — task is hidden from the default queue; `{ all: true }` restores it.
          const result = await service.pending({ all: true });

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          const meta = result.value[0]!.meta;
          expect(meta).toMatchObject({ t: "task", evidence_pass: 0, evidence_fail: 0 });
          expect(meta && "claimed_by" in meta).toBe(false);
        });

        it("task claim_stale key is entirely absent when ReviewService is constructed WITHOUT claimTtlMinutes, even though the doc carries a fresh claim", async () => {
          // `service` (beforeEach) is `new ReviewService(store, new RecordLockService(store, new GateEnforcer(undefined)))` — no claimTtlMinutes.
          const doc = makeDoc({
            status: "draft",
            type: "task",
            extra: {
              plan_id: "01HPLAN000000000000000001",
              claim: { by: "alice", at: new Date().toISOString() },
            },
          });
          await store.insert(doc);

          // SPEC-103 M3 — task is hidden from the default queue; `{ all: true }` restores it.
          const result = await service.pending({ all: true });

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          const meta = result.value[0]!.meta;
          expect(meta && "claimed_by" in meta && meta.claimed_by).toBe("alice");
          expect(meta && "claim_stale" in meta).toBe(false);
        });

        it("task claim_stale is computed false for a fresh claim and true for a stale claim once ReviewService IS constructed with claimTtlMinutes", async () => {
          const ttlMinutes = 60;
          const ttlService = new ReviewService(store, new RecordLockService(store, new GateEnforcer(undefined)), ttlMinutes);

          const freshDoc = makeDoc({
            slug: "task-fresh-claim",
            status: "draft",
            type: "task",
            extra: {
              plan_id: "01HPLAN000000000000000001",
              claim: { by: "alice", at: new Date().toISOString() },
            },
          });
          const staleDoc = makeDoc({
            slug: "task-stale-claim",
            status: "draft",
            type: "task",
            extra: {
              plan_id: "01HPLAN000000000000000001",
              // 2h ago, well past a 60-minute TTL.
              claim: { by: "bob", at: new Date(Date.now() - 120 * 60_000).toISOString() },
            },
          });
          await store.insert(freshDoc);
          await store.insert(staleDoc);

          // SPEC-103 M3 — task is hidden from the default queue; `{ all: true }` restores it.
          const result = await ttlService.pending({ all: true });

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          const fresh = result.value.find((d) => d.id === freshDoc.id)!;
          const stale = result.value.find((d) => d.id === staleDoc.id)!;
          expect(fresh.meta && "claim_stale" in fresh.meta ? (fresh.meta as { claim_stale?: boolean }).claim_stale : undefined).toBe(false);
          expect(stale.meta && "claim_stale" in stale.meta ? (stale.meta as { claim_stale?: boolean }).claim_stale : undefined).toBe(true);
        });
      });

      describe("error handling (resilience)", () => {
        // N/A: store-level failure propagation for `pending()` — InMemoryStore.findMany
        // (packages/lore/src/store/in-memory-store.ts:85) has no fault-injection surface
        // and always returns ok(); no existing `pending()` test in this file covers a
        // store-error path either (see the class-level test plan comment: ERROR dimension
        // is only exercised for approve/reject's DOC_NOT_FOUND). deriveTypeMeta's own
        // "never throws on arbitrary extra" contract (AC-36-10) has a dedicated fuzz suite
        // at packages/core/src/doc-type-meta.test.ts; the test below pins that guarantee
        // at THIS integration point (ReviewService.pending's map over toPendingDoc).
        it("does not throw and still resolves ok() when a task doc's extra fields have the wrong shape", async () => {
          const doc = makeDoc({
            status: "draft",
            type: "task",
            extra: {
              plan_id: "01HPLAN000000000000000001",
              claim: "not-an-object",
              verification_evidence: "not-an-array",
            },
          });
          await store.insert(doc);

          const result = await service.pending();

          expect(result.ok).toBe(true);
        });
      });

      describe("state", () => {
        it("reflects freshly-appended evidence on re-read (no stale caching of the projection)", async () => {
          const doc = makeDoc({
            status: "draft",
            type: "task",
            extra: { plan_id: "01HPLAN000000000000000001", verification_evidence: [] },
          });
          await store.insert(doc);

          // SPEC-103 M3 — task is hidden from the default queue; `{ all: true }` restores it.
          const before = await service.pending({ all: true });
          expect(before.ok).toBe(true);
          if (!before.ok) return;
          expect(before.value[0]!.meta).toMatchObject({ evidence_pass: 0, evidence_fail: 0 });

          const updateResult = await store.update(doc.id, {
            extra: {
              plan_id: "01HPLAN000000000000000001",
              verification_evidence: [
                { oracle: "tsc", command: "bun run typecheck", result: "pass", recorded_at: "2026-07-02T00:00:00.000Z", recorded_by: "alice" },
              ],
            },
          });
          expect(updateResult.ok).toBe(true);

          const after = await service.pending({ all: true });
          expect(after.ok).toBe(true);
          if (!after.ok) return;
          expect(after.value[0]!.meta).toMatchObject({ evidence_pass: 1, evidence_fail: 0 });
        });
      });

      describe("regression", () => {
        it("original PendingDoc fields are unaffected by meta projection on a non-prd doc", async () => {
          const doc = makeDoc({
            status: "draft",
            type: "adr",
            title: "My ADR",
            created_by: "dave",
            version: 4,
            updated_at: "2026-06-09T00:00:00.000Z",
            extra: { decision_status: "proposed" },
          });
          await store.insert(doc);

          const result = await service.pending();

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          const pending = result.value[0]!;
          expect(pending.id).toBe(doc.id);
          expect(pending.type).toBe("adr");
          expect(pending.title).toBe("My ADR");
          expect(pending.status).toBe("draft");
          expect(pending.created_by).toBe("dave");
          expect(pending.version).toBe(4);
          expect(pending.updated_at).toBe("2026-06-09T00:00:00.000Z");
          expect(pending.meta).toEqual({ t: "adr", decision_status: "proposed" });
        });
      });
    });

    // ── validity filtering (SPEC-043 D3) ────────────────────────────────────
    // Source: task-lore-pending-does-not-filter-invalidated-docs-an. `pending`
    // is a review-QUEUE list-surface; an invalidated draft (e.g. a duplicate
    // superseded by its canonical version) has no lifecycle exit (`draft` never
    // transitions to `archived`) and would otherwise sit here forever.
    // HAPPY:      excluded by default; --include-invalid restores it, carrying
    //             its `validity` field for CLI badge rendering
    // NEGATIVE:   a future valid_at does NOT exclude a doc (only invalid_at filters)
    // BOUNDARY:   invalidated mid-queue (no caching between two reads); zero
    //             pending at all; every pending draft invalidated
    // ERROR:      malformed extra.validity does not throw — degrades to "not
    //             invalidated" rather than propagating a store/parse failure
    // STATE:      moving the injected `now` across invalid_at flips visibility
    // REGRESSION: a non-invalidated doc's fields are byte-identical whether or
    //             not an invalidated sibling exists in the same batch;
    //             PendingDoc.validity is omitted (not a fabricated key) absent
    //             validity metadata
    describe("validity filtering (SPEC-043 D3)", () => {
      describe("happy path", () => {
        it("excludes an invalidated draft by default", async () => {
          const invalidated = makeDoc({
            status: "draft",
            type: "knowledge",
            extra: { sub_type: "ideation", validity: { invalid_at: "2026-06-01T00:00:00.000Z" } },
          });
          const valid = makeDoc({ status: "draft", type: "knowledge", extra: { sub_type: "ideation" } });
          await store.insert(invalidated);
          await store.insert(valid);

          const result = await service.pending(undefined, () => "2026-07-01T00:00:00.000Z");

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          const ids = result.value.map((d) => d.id);
          expect(ids).not.toContain(invalidated.id);
          expect(ids).toContain(valid.id);
        });

        it("--include-invalid restores the invalidated draft, carrying its validity field for badge rendering", async () => {
          const invalidAt = "2026-06-01T00:00:00.000Z";
          const invalidated = makeDoc({
            status: "draft",
            type: "knowledge",
            extra: { sub_type: "ideation", validity: { invalid_at: invalidAt } },
          });
          await store.insert(invalidated);

          const result = await service.pending({ include_invalid: true }, () => "2026-07-01T00:00:00.000Z");

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(result.value).toHaveLength(1);
          expect(result.value[0]!.id).toBe(invalidated.id);
          expect(result.value[0]!.validity?.invalid_at).toBe(invalidAt);
        });
      });

      describe("negative", () => {
        it("a future valid_at does NOT exclude a doc (only invalid_at filters)", async () => {
          const doc = makeDoc({
            status: "draft",
            type: "knowledge",
            extra: { sub_type: "ideation", validity: { valid_at: "2099-01-01T00:00:00.000Z" } },
          });
          await store.insert(doc);

          const result = await service.pending();

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(result.value.map((d) => d.id)).toContain(doc.id);
        });
      });

      describe("boundary values", () => {
        it("a doc invalidated AFTER an initial pending() read is excluded on the next read (no caching, mid-queue invalidation)", async () => {
          const doc = makeDoc({ status: "draft", type: "knowledge", extra: { sub_type: "ideation" } });
          await store.insert(doc);

          const before = await service.pending();
          expect(before.ok).toBe(true);
          if (!before.ok) return;
          expect(before.value.map((d) => d.id)).toContain(doc.id);

          // Simulate `lore invalidate` landing between two pending() reads.
          const updateResult = await store.update(
            doc.id,
            { extra: { ...doc.extra, validity: { invalid_at: "2026-06-01T00:00:00.000Z" } } },
            { expected_version: doc.version },
          );
          expect(updateResult.ok).toBe(true);

          const after = await service.pending(undefined, () => "2026-07-01T00:00:00.000Z");
          expect(after.ok).toBe(true);
          if (!after.ok) return;
          expect(after.value.map((d) => d.id)).not.toContain(doc.id);
        });

        it("returns an empty array when zero drafts are pending (store empty)", async () => {
          const result = await service.pending();
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(result.value).toHaveLength(0);
        });

        it("returns an empty array by default when EVERY pending draft is invalidated; --include-invalid restores all of them", async () => {
          const d1 = makeDoc({
            status: "draft",
            type: "knowledge",
            extra: { sub_type: "ideation", validity: { invalid_at: "2026-06-01T00:00:00.000Z" } },
          });
          const d2 = makeDoc({
            status: "draft",
            type: "adr",
            extra: { decision_status: "proposed", validity: { invalid_at: "2026-06-01T00:00:00.000Z" } },
          });
          await store.insert(d1);
          await store.insert(d2);

          const now = () => "2026-07-01T00:00:00.000Z";
          const defaultResult = await service.pending(undefined, now);
          expect(defaultResult.ok).toBe(true);
          if (!defaultResult.ok) return;
          expect(defaultResult.value).toHaveLength(0);

          const includeInvalidResult = await service.pending({ include_invalid: true }, now);
          expect(includeInvalidResult.ok).toBe(true);
          if (!includeInvalidResult.ok) return;
          expect(includeInvalidResult.value.map((d) => d.id).sort()).toEqual([d1.id, d2.id].sort());
        });
      });

      describe("error handling (resilience)", () => {
        it("a malformed extra.validity (wrong shape) does not throw — degrades to 'not invalidated', doc stays visible", async () => {
          const doc = makeDoc({
            status: "draft",
            type: "knowledge",
            extra: { sub_type: "ideation", validity: "not-an-object" },
          });
          await store.insert(doc);

          const result = await service.pending();

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(result.value.map((d) => d.id)).toContain(doc.id);
          expect(result.value[0]!.validity).toBeUndefined();
        });
      });

      describe("state", () => {
        it("moving the injected `now` across invalid_at flips pending() visibility", async () => {
          const invalidAt = "2026-06-01T00:00:00.000Z";
          const doc = makeDoc({
            status: "draft",
            type: "knowledge",
            extra: { sub_type: "ideation", validity: { invalid_at: invalidAt } },
          });
          await store.insert(doc);

          const beforeBoundary = await service.pending(undefined, () => "2026-05-01T00:00:00.000Z");
          expect(beforeBoundary.ok).toBe(true);
          if (!beforeBoundary.ok) return;
          expect(beforeBoundary.value.map((d) => d.id)).toContain(doc.id);

          const afterBoundary = await service.pending(undefined, () => "2026-07-01T00:00:00.000Z");
          expect(afterBoundary.ok).toBe(true);
          if (!afterBoundary.ok) return;
          expect(afterBoundary.value.map((d) => d.id)).not.toContain(doc.id);
        });
      });

      describe("regression", () => {
        it("a non-invalidated doc's PendingDoc fields are byte-identical whether or not an invalidated sibling exists in the same batch", async () => {
          const valid = makeDoc({
            status: "draft",
            type: "prd",
            title: "Valid Doc",
            created_by: "alice",
            version: 2,
            updated_at: "2026-06-05T10:00:00.000Z",
          });
          await store.insert(valid);

          const withoutInvalidSibling = await service.pending();
          expect(withoutInvalidSibling.ok).toBe(true);
          if (!withoutInvalidSibling.ok) return;

          const invalidated = makeDoc({
            status: "draft",
            type: "knowledge",
            extra: { sub_type: "ideation", validity: { invalid_at: "2026-06-01T00:00:00.000Z" } },
          });
          await store.insert(invalidated);

          const withInvalidSibling = await service.pending(undefined, () => "2026-07-01T00:00:00.000Z");
          expect(withInvalidSibling.ok).toBe(true);
          if (!withInvalidSibling.ok) return;

          const validRowBefore = withoutInvalidSibling.value.find((d) => d.id === valid.id);
          const validRowAfter = withInvalidSibling.value.find((d) => d.id === valid.id);
          expect(validRowAfter).toEqual(validRowBefore);
          expect(withInvalidSibling.value.map((d) => d.id)).not.toContain(invalidated.id);
        });

        it("PendingDoc.validity is absent (not a fabricated undefined key) for a doc with no validity metadata", async () => {
          const doc = makeDoc({ status: "draft", type: "prd" });
          await store.insert(doc);

          const result = await service.pending();
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect("validity" in result.value[0]!).toBe(false);
        });
      });
    });
  });

  // ── approve ───────────────────────────────────────────────────────────────

  describe("approve", () => {
    describe("happy path", () => {
      it("transitions draft → approved and returns updated doc", async () => {
        const doc = makeDoc({ status: "draft" });
        await store.insert(doc);

        const result = await service.approve(doc.id, { reviewer: "carol" });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.status).toBe("approved");
        expect(result.value.id).toBe(doc.id);
      });

      it("increments the version number on approve", async () => {
        const doc = makeDoc({ status: "draft", version: 2 });
        await store.insert(doc);

        const result = await service.approve(doc.id, { reviewer: "carol" });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.version).toBe(3);
      });

      it("creates a version record with action=approve and correct reviewer", async () => {
        const doc = makeDoc({ status: "draft" });
        await store.insert(doc);

        await service.approve(doc.id, { reviewer: "reviewer1" });

        const versionsResult = await store.findVersions(doc.id);
        expect(versionsResult.ok).toBe(true);
        if (!versionsResult.ok) return;
        expect(versionsResult.value).toHaveLength(1);
        expect(versionsResult.value[0]!.action).toBe("approve");
        expect(versionsResult.value[0]!.status).toBe("approved");
        expect(versionsResult.value[0]!.created_by).toBe("reviewer1");
      });

      it("appends an audit entry with reviewer and action=approve", async () => {
        const doc = makeDoc({ status: "draft" });
        await store.insert(doc);

        await service.approve(doc.id, { reviewer: "carol" });

        const auditResult = await store.queryAudit({ doc_id: doc.id });
        expect(auditResult.ok).toBe(true);
        if (!auditResult.ok) return;
        expect(auditResult.value).toHaveLength(1);
        expect(auditResult.value[0]!.action).toBe("approve");
        expect(auditResult.value[0]!.actor).toBe("carol");
        expect(auditResult.value[0]!.doc_id).toBe(doc.id);
      });

      it("transitions in-review → approved", async () => {
        const doc = makeDoc({ status: "in-review" });
        await store.insert(doc);

        const result = await service.approve(doc.id);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.status).toBe("approved");
      });

      it("uses 'system' as reviewer when opts is omitted", async () => {
        const doc = makeDoc({ status: "draft" });
        await store.insert(doc);

        await service.approve(doc.id);

        const auditResult = await store.queryAudit({ doc_id: doc.id });
        expect(auditResult.ok).toBe(true);
        if (!auditResult.ok) return;
        expect(auditResult.value[0]!.actor).toBe("system");
      });
    });

    describe("state transitions (negative)", () => {
      it("returns INVALID_TRANSITION when doc is already approved", async () => {
        const doc = makeDoc({ status: "approved" });
        await store.insert(doc);

        const result = await service.approve(doc.id);

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("INVALID_TRANSITION");
        if (result.error.code !== "INVALID_TRANSITION") return;
        expect(result.error.from).toBe("approved");
        expect(result.error.to).toBe("approved");
      });

      it("returns INVALID_TRANSITION when doc is archived", async () => {
        const doc = makeDoc({ status: "archived" });
        await store.insert(doc);

        const result = await service.approve(doc.id);

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("INVALID_TRANSITION");
        if (result.error.code !== "INVALID_TRANSITION") return;
        expect(result.error.from).toBe("archived");
        expect(result.error.to).toBe("approved");
      });

      it("returns INVALID_TRANSITION when doc is deprecated", async () => {
        const doc = makeDoc({ status: "deprecated" });
        await store.insert(doc);

        const result = await service.approve(doc.id);

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("INVALID_TRANSITION");
        if (result.error.code !== "INVALID_TRANSITION") return;
        expect(result.error.from).toBe("deprecated");
      });
    });

    describe("error handling", () => {
      it("returns DOC_NOT_FOUND when id does not exist", async () => {
        const result = await service.approve("nonexistent-id");

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("DOC_NOT_FOUND");
      });
    });
  });

  // ── reject ────────────────────────────────────────────────────────────────

  describe("reject", () => {
    describe("happy path", () => {
      it("keeps status as draft and records reason in audit", async () => {
        const doc = makeDoc({ status: "draft" });
        await store.insert(doc);

        const result = await service.reject(doc.id, {
          reviewer: "bob",
          reason: "incomplete",
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.status).toBe("draft");

        const auditResult = await store.queryAudit({ doc_id: doc.id });
        expect(auditResult.ok).toBe(true);
        if (!auditResult.ok) return;
        expect(auditResult.value).toHaveLength(1);
        expect(auditResult.value[0]!.action).toBe("reject");
        expect(auditResult.value[0]!.actor).toBe("bob");
        expect(auditResult.value[0]!.details?.["reason"]).toBe("incomplete");
      });

      it("rejects an in-review doc, status returns to draft", async () => {
        const doc = makeDoc({ status: "in-review" });
        await store.insert(doc);

        const result = await service.reject(doc.id, { reason: "needs more work" });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.status).toBe("draft");
      });

      it("stores reason in audit details", async () => {
        const doc = makeDoc({ status: "draft" });
        await store.insert(doc);

        await service.reject(doc.id, { reviewer: "reviewer1", reason: "missing tests" });

        const auditResult = await store.queryAudit({ doc_id: doc.id, action: "reject" });
        expect(auditResult.ok).toBe(true);
        if (!auditResult.ok) return;
        expect(auditResult.value[0]!.details?.["reason"]).toBe("missing tests");
      });

      it("omits reason key from audit details when reason is not provided", async () => {
        const doc = makeDoc({ status: "draft" });
        await store.insert(doc);

        await service.reject(doc.id, { reviewer: "reviewer1" });

        const auditResult = await store.queryAudit({ doc_id: doc.id });
        expect(auditResult.ok).toBe(true);
        if (!auditResult.ok) return;
        expect(auditResult.value[0]!.details?.["reason"]).toBeUndefined();
      });

      it("uses 'system' as reviewer when opts is omitted", async () => {
        const doc = makeDoc({ status: "draft" });
        await store.insert(doc);

        await service.reject(doc.id);

        const auditResult = await store.queryAudit({ doc_id: doc.id });
        expect(auditResult.ok).toBe(true);
        if (!auditResult.ok) return;
        expect(auditResult.value[0]!.actor).toBe("system");
      });
    });

    describe("state transitions (negative)", () => {
      it("returns INVALID_TRANSITION when doc is approved (cannot reject approved)", async () => {
        const doc = makeDoc({ status: "approved" });
        await store.insert(doc);

        const result = await service.reject(doc.id, { reason: "test" });

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("INVALID_TRANSITION");
        if (result.error.code !== "INVALID_TRANSITION") return;
        expect(result.error.from).toBe("approved");
        expect(result.error.to).toBe("draft");
      });

      it("returns INVALID_TRANSITION when doc is archived", async () => {
        const doc = makeDoc({ status: "archived" });
        await store.insert(doc);

        const result = await service.reject(doc.id);

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("INVALID_TRANSITION");
        if (result.error.code !== "INVALID_TRANSITION") return;
        expect(result.error.from).toBe("archived");
      });

      it("returns INVALID_TRANSITION when doc is deprecated", async () => {
        const doc = makeDoc({ status: "deprecated" });
        await store.insert(doc);

        const result = await service.reject(doc.id);

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("INVALID_TRANSITION");
        if (result.error.code !== "INVALID_TRANSITION") return;
        expect(result.error.from).toBe("deprecated");
      });
    });

    describe("error handling", () => {
      it("returns DOC_NOT_FOUND when id does not exist", async () => {
        const result = await service.reject("nonexistent-id");

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("DOC_NOT_FOUND");
      });
    });

    describe("regression", () => {
      // Regression: reject MUST NOT increment version — only approve bumps version
      it("reject does not increment version number", async () => {
        const doc = makeDoc({ status: "draft", version: 1 });
        await store.insert(doc);

        const result = await service.reject(doc.id, { reason: "incomplete" });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.version).toBe(1);
      });

      // Regression: approved doc must not appear in pending list
      it("approved doc no longer appears in pending after approval", async () => {
        const doc = makeDoc({ status: "draft" });
        await store.insert(doc);

        await service.approve(doc.id);

        const pendingResult = await service.pending();
        expect(pendingResult.ok).toBe(true);
        if (!pendingResult.ok) return;
        const ids = pendingResult.value.map((d) => d.id);
        expect(ids).not.toContain(doc.id);
      });
    });
  });
});
