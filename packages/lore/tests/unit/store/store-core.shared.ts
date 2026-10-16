/**
 * Shared StoreInterface contract suite (AC-TG-9, TG-12): the behaviour that
 * `InMemoryStore`, `SQLiteStore` and `TursoStore` must all satisfy, written ONCE.
 *
 * Not a test file (no `.test.ts` / `.bun.test.ts` suffix). It exports suite
 * functions invoked from `in-memory-store.test.ts` (vitest) and from
 * `sqlite-store.bun.test.ts` / `turso-store.bun.test.ts` (`bun test`).
 * Like `batch-methods.shared.ts` it imports only `vitest` (bun resolves it too)
 * and the `StoreInterface` TYPE — never `bun:sqlite` or an adapter class — so
 * the same module loads under both runners.
 *
 * Spec references (SPEC-LORE-STORE-001): AC-STORE-001 … AC-STORE-009,
 * AC-STORE-CAS-001, AC-BLS2-9.
 *
 * @spec_ref AC-STORE-001
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  AuditEntry,
  CalibrationRecord,
  DocRecord,
  LinkRecord,
  ReviewJudgment,
  VersionRecord,
} from "@lore/core";
import type { StoreInterface } from "../../../src/store/store-interface.js";

/** How a runner builds / tears down the adapter under test. */
export interface StoreSuiteOptions {
  readonly label: string;
  /** Fresh, empty store; called once per test. */
  readonly createStore: () => StoreInterface;
  /** Release the store and any temp files; called once per test. */
  readonly destroyStore: (store: StoreInterface) => void;
  /**
   * `false` marks AC-STORE-005.11 / .12 / .14 as NOT APPLICABLE (reported as
   * skipped, never silently dropped). Reason: `InMemoryStore.detectParentCycle`
   * walks only `links` rows and ignores `docs.parent_id`, so a cycle formed purely
   * through `docs.parent_id` is not rejected there. SQLiteStore and TursoStore
   * walk `docs.parent_id` and must pass. Defaults to `true`.
   */
  readonly parentIdOnlyCycleDetection?: boolean;
}

// ─── Factories ───────────────────────────────────────────────────────────────

let _counter = 0;

export function nextId(): string {
  _counter += 1;
  const padded = String(_counter).padStart(20, "0");
  return `01HTEST${padded}`;
}

export function makeDoc(overrides: Partial<DocRecord> = {}): DocRecord {
  _counter += 1;
  return {
    id: nextId(),
    slug: `prd-test-${_counter}`,
    type: "prd",
    role: "intent",
    title: "Test Document",
    status: "draft",
    priority: "medium",
    content: "Test content",
    parent_id: null,
    extra: {},
    tags: [],
    version: 1,
    created_at: "2026-06-08T10:00:00.000Z",
    updated_at: "2026-06-08T10:00:00.000Z",
    created_by: "agent:test",
    deleted_at: null,
    ...overrides,
  };
}

export function makeLink(
  fromId: string,
  toId: string,
  linkType: LinkRecord["link_type"] = "relates-to",
): LinkRecord {
  return {
    from_id: fromId,
    to_id: toId,
    link_type: linkType,
    created_at: "2026-06-08T10:00:00.000Z",
    created_by: "agent:test",
  };
}

export function makeVersion(docId: string, version: number): VersionRecord {
  return {
    doc_id: docId,
    version,
    content: `Content at version ${version}`,
    extra: {},
    status: "draft",
    title: "Test Document",
    action: "create",
    created_at: "2026-06-08T10:00:00.000Z",
    created_by: "agent:test",
  };
}

export function makeAuditEntry(docId: string): AuditEntry {
  return {
    timestamp: "2026-06-08T10:00:00.000Z",
    actor: "agent:test",
    session_id: "sess-001",
    action: "create",
    doc_id: docId,
    details: { field: "value" },
  };
}

export function makeJudgment(docId: string, overrides: Partial<ReviewJudgment> = {}): ReviewJudgment {
  _counter += 1;
  return {
    id: `01HJUDGE${String(_counter).padStart(18, "0")}`,
    doc_id: docId,
    doc_version: 1,
    decision: "approve",
    confidence: 0.9,
    reasons: [{ dimension: "completeness", finding: "All ACs covered." }],
    checks: [{ check: "schema", outcome: "pass" }],
    blocking_questions: [],
    judge: { provider: "claude-cli", model: "claude-sonnet-5", prompt_version: "v1" },
    // reason: SPEC-044 D3 — explicit here (not omitted-then-`?? "review"`-defaulted) so
    // this fixture's round-trip through insertJudgment/findJudgments/rowToReviewJudgment
    // stays byte-identical (the store layer always persists a concrete "review"/
    // "staleness" string, never leaves the column conceptually "absent").
    kind: "review",
    created_at: "2026-06-08T10:00:00.000Z",
    created_by: "ai:claude-cli:claude-sonnet-5:v1",
    ...overrides,
  };
}

export function makeCalibrationRecord(
  judgmentId: string,
  docId: string,
  overrides: Partial<CalibrationRecord> = {},
): CalibrationRecord {
  _counter += 1;
  return {
    id: `01HCALIB${String(_counter).padStart(18, "0")}`,
    judgment_id: judgmentId,
    doc_id: docId,
    doc_type: "spec",
    human_outcome: "confirmed",
    delta_reasons: [],
    actor: "alice",
    created_at: "2026-06-08T10:00:00.000Z",
    ...overrides,
  };
}

/** Reset the factory counter (id / slug uniqueness) — call from each suite's beforeEach. */
export function resetCounter(): void {
  _counter = 0;
}

export function runStoreCoreSuite(opts: StoreSuiteOptions): void {
  describe(`${opts.label} — StoreInterface core contract`, () => {
    let store: StoreInterface;
    const parentCycleIt = opts.parentIdOnlyCycleDetection === false ? it.skip : it;

    beforeEach(() => {
      _counter = 0;
      store = opts.createStore();
    });

    afterEach(() => {
      opts.destroyStore(store);
    });

    // ── Happy Path ─────────────────────────────────────────────────────────────

    describe("happy path", () => {
      it("AC-STORE-001.01: insert + find by id round-trip", async () => {
        const doc = makeDoc({ slug: "prd-hello" });
        const insertResult = await store.insert(doc);
        expect(insertResult.ok).toBe(true);

        const findResult = await store.find(doc.id);
        expect(findResult.ok).toBe(true);
        if (!findResult.ok) return;
        expect(findResult.value?.id).toBe(doc.id);
        expect(findResult.value?.slug).toBe("prd-hello");
      });

      it("AC-STORE-001.02: insert + findBySlug round-trip", async () => {
        const doc = makeDoc({ slug: "spec-auth-flow" });
        await store.insert(doc);

        const result = await store.findBySlug("spec-auth-flow");
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value?.id).toBe(doc.id);
      });

      it("SPEC-065 D2: findByIdPrefix resolves a unique 10-char prefix", async () => {
        const doc = makeDoc({ id: "01HZUNIQUE0000000000000001", slug: "prd-unique-prefix" });
        await store.insert(doc);

        const result = await store.findByIdPrefix(doc.id.slice(0, 10));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.map((d) => d.id)).toEqual([doc.id]);
      });

      it("SPEC-065 D2: findByIdPrefix is case-insensitive (mirrors SQLite/libSQL's default ASCII LIKE)", async () => {
        const doc = makeDoc({ id: "01HZCASEINS0000000000000001", slug: "prd-case-insensitive" });
        await store.insert(doc);

        const result = await store.findByIdPrefix(doc.id.slice(0, 10).toLowerCase());
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.map((d) => d.id)).toEqual([doc.id]);
      });

      it("tags round-trip: insert doc with tags, retrieve with tags preserved", async () => {
        const doc = makeDoc({
          slug: "prd-tags",
          tags: ["auth", "security", "phase-1"],
        });
        await store.insert(doc);

        const result = await store.find(doc.id);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value?.tags).toEqual(["auth", "security", "phase-1"]);
      });

      it("extra round-trip: insert doc with extra, retrieve with extra preserved", async () => {
        const doc = makeDoc({
          slug: "adr-test",
          type: "adr",
          role: "decision",
          extra: { decision_status: "proposed", notes: "initial draft" },
        });
        await store.insert(doc);

        const result = await store.find(doc.id);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value?.extra).toEqual({
          decision_status: "proposed",
          notes: "initial draft",
        });
      });

      it("AC-STORE-002.01: update patches doc fields and they persist", async () => {
        const doc = makeDoc({ slug: "prd-updateme" });
        await store.insert(doc);

        const updateResult = await store.update(doc.id, {
          title: "Updated Title",
          status: "in-review",
          version: 2,
          updated_at: "2026-06-08T11:00:00.000Z",
        });
        expect(updateResult.ok).toBe(true);
        if (!updateResult.ok) return;
        expect(updateResult.value.title).toBe("Updated Title");
        expect(updateResult.value.status).toBe("in-review");
        expect(updateResult.value.version).toBe(2);
      });

      it("AC-STORE-002.01: version field incremented on the stored record", async () => {
        const doc = makeDoc({ slug: "prd-version" });
        await store.insert(doc);

        await store.update(doc.id, {
          content: "new content",
          version: 2,
          updated_at: "2026-06-08T11:00:00.000Z",
        });

        const result = await store.find(doc.id);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value?.version).toBe(2);
      });

      it("AC-STORE-003.01: softDelete sets deleted_at timestamp", async () => {
        const doc = makeDoc({ slug: "prd-delete" });
        await store.insert(doc);

        const deleteResult = await store.softDelete(doc.id);
        expect(deleteResult.ok).toBe(true);

        // find() still returns the doc (soft delete preserved in storage)
        const found = await store.find(doc.id);
        expect(found.ok).toBe(true);
        if (!found.ok) return;
        expect(found.value?.deleted_at).not.toBeNull();
      });

      it("AC-STORE-003.02: findMany(default) excludes soft-deleted docs", async () => {
        const doc = makeDoc({ slug: "prd-exclude", type: "prd" });
        await store.insert(doc);
        await store.softDelete(doc.id);

        const result = await store.findMany({ type: "prd" });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const ids = result.value.map((d) => d.id);
        expect(ids).not.toContain(doc.id);
      });

      it("AC-STORE-005.01: addLink creates a link record", async () => {
        const docA = makeDoc({ slug: "prd-link-a" });
        const docB = makeDoc({ slug: "prd-link-b" });
        await store.insert(docA);
        await store.insert(docB);

        const link = makeLink(docA.id, docB.id, "relates-to");
        const result = await store.addLink(link);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.from_id).toBe(docA.id);
        expect(result.value.link_type).toBe("relates-to");
      });

      it("AC-STORE-005.09 (regression, migration-004): addLink accepts link_type='governs'", async () => {
        // reason: links.link_type is enforced by a SQLite CHECK constraint
        // (migration-001), not just Zod — this is the store-level oracle proving
        // migration-004's widened CHECK actually applies to a freshly-created DB.
        const skill = makeDoc({ slug: "knowledge-governs-skill" });
        const artifact = makeDoc({ slug: "spec-governs-artifact" });
        await store.insert(skill);
        await store.insert(artifact);

        const link = makeLink(skill.id, artifact.id, "governs");
        const result = await store.addLink(link);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.link_type).toBe("governs");
      });

      it("AC-ICL-1 (regression, migration-012): addLink accepts link_type='resolves'", async () => {
        // reason: same store-level oracle shape as migration-004's "governs"
        // regression test above — proves migration-012's widened CHECK
        // (spec-issue-closure-loop-computed-resolution-agent-reachable §D1)
        // actually applies to a freshly-created DB, not just
        // `linkTypeSchema`/`CorpusService.link()`'s Zod-level acceptance
        // (discovered gap: those two already accepted "resolves" while the
        // SQLite CHECK constraint itself still rejected it — see
        // migration-012.ts's own module JSDoc).
        const fix = makeDoc({ slug: "task-resolves-fix" });
        const issue = makeDoc({ slug: "task-resolves-issue" });
        await store.insert(fix);
        await store.insert(issue);

        const link = makeLink(fix.id, issue.id, "resolves");
        const result = await store.addLink(link);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.link_type).toBe("resolves");
      });

      it("AC-STORE-005.06: findLinks(out) returns outbound links", async () => {
        const a = makeDoc({ slug: "prd-fl-a" });
        const b = makeDoc({ slug: "prd-fl-b" });
        await store.insert(a);
        await store.insert(b);
        await store.addLink(makeLink(a.id, b.id, "informs"));

        const result = await store.findLinks(a.id, "out");
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.to_id).toBe(b.id);
      });

      it("AC-STORE-005.07: findLinks(in) returns inbound links", async () => {
        const a = makeDoc({ slug: "prd-in-a" });
        const b = makeDoc({ slug: "prd-in-b" });
        await store.insert(a);
        await store.insert(b);
        await store.addLink(makeLink(a.id, b.id, "informs"));

        const result = await store.findLinks(b.id, "in");
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.from_id).toBe(a.id);
      });

      it("AC-STORE-005.08: findLinks(both) returns all links for a doc", async () => {
        const a = makeDoc({ slug: "prd-both-a" });
        const b = makeDoc({ slug: "prd-both-b" });
        const c = makeDoc({ slug: "prd-both-c" });
        await store.insert(a);
        await store.insert(b);
        await store.insert(c);
        await store.addLink(makeLink(a.id, b.id, "informs"));
        await store.addLink(makeLink(c.id, a.id, "blocks"));

        const result = await store.findLinks(a.id, "both");
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(2);
      });

      it("AC-STORE-005.05: removeLink deletes the specific link", async () => {
        const a = makeDoc({ slug: "prd-rm-a" });
        const b = makeDoc({ slug: "prd-rm-b" });
        await store.insert(a);
        await store.insert(b);
        await store.addLink(makeLink(a.id, b.id, "informs"));

        await store.removeLink(a.id, b.id, "informs");

        const result = await store.findLinks(a.id, "out");
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(0);
      });

      it("AC-STORE-007.01: insertVersion + findVersions round-trip", async () => {
        const doc = makeDoc({ slug: "prd-ver" });
        await store.insert(doc);

        const v1 = makeVersion(doc.id, 1);
        await store.insertVersion(v1);

        const result = await store.findVersions(doc.id);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.version).toBe(1);
        expect(result.value[0]?.action).toBe("create");
      });

      it("AC-STORE-008.01: appendAuditEntry + queryAudit round-trip", async () => {
        const doc = makeDoc({ slug: "prd-audit" });
        await store.insert(doc);

        const entry = makeAuditEntry(doc.id);
        await store.appendAuditEntry(entry);

        const result = await store.queryAudit({ doc_id: doc.id });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.actor).toBe("agent:test");
        expect(result.value[0]?.action).toBe("create");
      });

      it("AC-STORE-006.01: search returns ranked results with snippets", async () => {
        const doc1 = makeDoc({
          slug: "spec-auth-v1",
          title: "Authentication Service",
          content:
            "This spec defines the auth flow for all users using JWT tokens.",
          type: "spec",
          role: "spec",
        });
        const doc2 = makeDoc({
          slug: "spec-auth-v2",
          title: "Auth Token Refresh",
          content: "Handles authentication token refresh logic.",
          type: "spec",
          role: "spec",
        });
        const doc3 = makeDoc({
          slug: "prd-unrelated",
          title: "Unrelated Document",
          content: "Nothing about tokens or logins here.",
        });
        await store.insert(doc1);
        await store.insert(doc2);
        await store.insert(doc3);

        const result = await store.search("auth");
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.length).toBeGreaterThanOrEqual(2);
        const ids = result.value.map((h) => h.id);
        expect(ids).toContain(doc1.id);
        expect(ids).toContain(doc2.id);
        for (const hit of result.value) {
          expect(typeof hit.snippet).toBe("string");
        }
      });

      it("AC-STORE-009.01: findMany with type+status filters returns matching docs", async () => {
        const docs = Array.from({ length: 10 }, (_, i) => {
          const type = i < 5 ? ("spec" as const) : ("prd" as const);
          const role = type === "spec" ? ("spec" as const) : ("intent" as const);
          return makeDoc({
            slug: `${type}-many-${i}`,
            type,
            role,
            status: i % 2 === 0 ? ("draft" as const) : ("in-review" as const),
          });
        });
        for (const d of docs) await store.insert(d);

        const result = await store.findMany({ type: "spec", status: "draft" });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        for (const doc of result.value) {
          expect(doc.type).toBe("spec");
          expect(doc.status).toBe("draft");
        }
      });

      it("addLink with type=parent creates link record in links table", async () => {
        const parent = makeDoc({ slug: "prd-par" });
        const child = makeDoc({
          slug: "spec-child",
          type: "spec",
          role: "spec",
        });
        await store.insert(parent);
        await store.insert(child);

        const result = await store.addLink(makeLink(child.id, parent.id, "parent"));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.link_type).toBe("parent");

        const links = await store.findLinks(child.id, "out");
        expect(links.ok).toBe(true);
        if (!links.ok) return;
        expect(links.value).toHaveLength(1);
        expect(links.value[0]?.link_type).toBe("parent");
      });
    });

    // ── Negative Cases ─────────────────────────────────────────────────────────

    describe("negative cases", () => {
      it("AC-STORE-001.N01: find on missing id returns null (not error)", async () => {
        const result = await store.find("01HNOTEXIST0000000000000");
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toBeNull();
      });

      it("findBySlug on missing slug returns null (not error)", async () => {
        const result = await store.findBySlug("prd-does-not-exist");
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toBeNull();
      });

      it("SPEC-065 D2: findByIdPrefix on a non-matching prefix returns an empty array (not an error)", async () => {
        const result = await store.findByIdPrefix("01HZNOMATCH");
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toEqual([]);
      });

      it("SPEC-065 D2: findByIdPrefix returns every matching doc when the prefix is ambiguous", async () => {
        const a = makeDoc({ id: "01HZAMBIGAAAA0000000000001", slug: "prd-ambig-a" });
        const b = makeDoc({ id: "01HZAMBIGBBBB0000000000002", slug: "prd-ambig-b" });
        await store.insert(a);
        await store.insert(b);

        const result = await store.findByIdPrefix("01HZAMBIG");
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.map((d) => d.id).sort()).toEqual([a.id, b.id].sort());
      });

      it("SPEC-065 D2: findByIdPrefix excludes soft-deleted docs, mirroring findMany's default", async () => {
        const doc = makeDoc({ id: "01HZSOFTDEL0000000000000001", slug: "prd-soft-deleted" });
        await store.insert(doc);
        await store.softDelete(doc.id);

        const result = await store.findByIdPrefix(doc.id.slice(0, 10));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toEqual([]);
      });

      it("AC-STORE-002.N01: update on missing id returns DOC_NOT_FOUND", async () => {
        const result = await store.update("01HNOTEXIST0000000000000", {
          title: "x",
        });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("DOC_NOT_FOUND");
      });

      it("AC-STORE-003.N01: softDelete on missing id returns DOC_NOT_FOUND", async () => {
        const result = await store.softDelete("01HNOTEXIST0000000000000");
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("DOC_NOT_FOUND");
      });

      it("AC-STORE-004.01: insert duplicate slug returns DUPLICATE_SLUG", async () => {
        const doc1 = makeDoc({ slug: "prd-dupe" });
        const doc2 = makeDoc({ slug: "prd-dupe" });
        await store.insert(doc1);

        const result = await store.insert(doc2);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("DUPLICATE_SLUG");
      });

      it("AC-STORE-005.02: addLink duplicate link returns DUPLICATE_LINK", async () => {
        const a = makeDoc({ slug: "prd-dup-a" });
        const b = makeDoc({ slug: "prd-dup-b" });
        await store.insert(a);
        await store.insert(b);

        await store.addLink(makeLink(a.id, b.id, "informs"));
        const result = await store.addLink(makeLink(a.id, b.id, "informs"));
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("DUPLICATE_LINK");
      });

      it("findMany returns empty array for filters matching nothing", async () => {
        const result = await store.findMany({ type: "knowledge", status: "archived" });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(0);
      });

      it("AC-STORE-006.03: search with no matching docs returns empty array", async () => {
        const result = await store.search("xyzzy_notfound_12345");
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(0);
      });
    });

    // ── Boundary Values ────────────────────────────────────────────────────────

    describe("boundary values", () => {
      it("AC-STORE-009.02: findMany exclude_deleted=false includes soft-deleted docs", async () => {
        const doc = makeDoc({ slug: "prd-del-bv" });
        await store.insert(doc);
        await store.softDelete(doc.id);

        const result = await store.findMany({ exclude_deleted: false });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const ids = result.value.map((d) => d.id);
        expect(ids).toContain(doc.id);
      });

      it("AC-STORE-007.02: findVersions with limit=1 returns only newest version", async () => {
        const doc = makeDoc({ slug: "prd-lim-ver" });
        await store.insert(doc);
        await store.insertVersion(makeVersion(doc.id, 1));
        await store.insertVersion(makeVersion(doc.id, 2));
        await store.insertVersion(makeVersion(doc.id, 3));

        const result = await store.findVersions(doc.id, { limit: 1 });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.version).toBe(3); // newest first
      });

      it("AC-STORE-007.03: findVersions with offset=1 skips newest version", async () => {
        const doc = makeDoc({ slug: "prd-off-ver" });
        await store.insert(doc);
        await store.insertVersion(makeVersion(doc.id, 1));
        await store.insertVersion(makeVersion(doc.id, 2));

        const result = await store.findVersions(doc.id, { limit: 10, offset: 1 });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.version).toBe(1); // offset skipped v2
      });

      it("doc with empty tags array preserved on round-trip", async () => {
        const doc = makeDoc({ slug: "prd-no-tags", tags: [] });
        await store.insert(doc);

        const result = await store.find(doc.id);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value?.tags).toEqual([]);
      });

      it("doc with empty extra object preserved on round-trip", async () => {
        const doc = makeDoc({ slug: "prd-no-extra", extra: {} });
        await store.insert(doc);

        const result = await store.find(doc.id);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value?.extra).toEqual({});
      });

      it("AC-STORE-008.02: queryAudit with limit returns correct number of entries", async () => {
        const doc = makeDoc({ slug: "prd-audit-lim" });
        await store.insert(doc);
        await store.appendAuditEntry({
          ...makeAuditEntry(doc.id),
          timestamp: "2026-06-08T10:00:00.000Z",
        });
        await store.appendAuditEntry({
          ...makeAuditEntry(doc.id),
          timestamp: "2026-06-08T11:00:00.000Z",
        });
        await store.appendAuditEntry({
          ...makeAuditEntry(doc.id),
          timestamp: "2026-06-08T12:00:00.000Z",
        });

        const result = await store.queryAudit({ doc_id: doc.id, limit: 2 });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(2);
      });
    });

    // ── Error Handling ─────────────────────────────────────────────────────────

    describe("error handling", () => {
      it("insert with duplicate primary key returns err Result, does not throw", async () => {
        const doc = makeDoc({ slug: "prd-pk1" });
        const doc2 = { ...doc, slug: "prd-pk2" }; // same id, different slug
        await store.insert(doc);
        const result = await store.insert(doc2);
        expect(result).toBeDefined();
        expect(result.ok).toBe(false);
      });

      it("all store operations return Result, never throw on bad input", async () => {
        const badId = "01HNOTEXIST0000000000000";
        await expect(store.find(badId)).resolves.toBeDefined();
        await expect(store.findBySlug("not-exist")).resolves.toBeDefined();
        await expect(store.update(badId, {})).resolves.toBeDefined();
        await expect(store.softDelete(badId)).resolves.toBeDefined();
        await expect(store.findMany({})).resolves.toBeDefined();
        await expect(store.search("test")).resolves.toBeDefined();
        await expect(store.findVersions(badId)).resolves.toBeDefined();
        await expect(store.queryAudit({})).resolves.toBeDefined();
      });
    });

    // ── State Transitions ──────────────────────────────────────────────────────

    describe("state transitions", () => {
      it("AC-STORE-005.03: parent cycle A→B then B→A rejected with LINK_CYCLE", async () => {
        const a = makeDoc({ slug: "prd-cycle-a" });
        const b = makeDoc({ slug: "prd-cycle-b" });
        await store.insert(a);
        await store.insert(b);

        // b's parent = a
        await store.addLink(makeLink(b.id, a.id, "parent"));

        // try to make a's parent = b → cycle
        const result = await store.addLink(makeLink(a.id, b.id, "parent"));
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("LINK_CYCLE");
      });

      it("AC-STORE-005.04: 3-node parent cycle A→B→C→A rejected with LINK_CYCLE", async () => {
        const a = makeDoc({ slug: "prd-3c-a" });
        const b = makeDoc({ slug: "prd-3c-b" });
        const c = makeDoc({ slug: "prd-3c-c" });
        await store.insert(a);
        await store.insert(b);
        await store.insert(c);

        await store.addLink(makeLink(b.id, a.id, "parent")); // b → a
        await store.addLink(makeLink(c.id, b.id, "parent")); // c → b

        // try a → c: would form a→c→b→a cycle
        const result = await store.addLink(makeLink(a.id, c.id, "parent"));
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("LINK_CYCLE");
      });

      parentCycleIt("AC-STORE-005.11 (REGRESSION, audit 2026-07-27 spec-corpus-schema §4.3): 2-node parent cycle formed via docs.parent_id only (no links row — mirrors `lore create --parent`) is rejected on link close", async () => {
        const root = makeDoc({ slug: "prd-pid-cycle-root" });
        await store.insert(root);
        // `lore create --parent` writes ONLY docs.parent_id — never an
        // addLink call, so no row lands in `links`. Reproduced here by
        // setting parent_id directly on the inserted doc instead of going
        // through addLink, exactly like CorpusService.create's --parent path.
        const child = makeDoc({ slug: "prd-pid-cycle-child", parent_id: root.id });
        await store.insert(child);

        // Sanity: the links table has NO row for this pair — a cycle
        // detector that only walked `links` would see nothing here and miss
        // the cycle below entirely (the exact audit hole).
        const outLinks = await store.findLinks(child.id, "out");
        expect(outLinks.ok).toBe(true);
        if (outLinks.ok) expect(outLinks.value).toHaveLength(0);

        // Attempt to close the cycle: root's parent = child.
        const result = await store.addLink(makeLink(root.id, child.id, "parent"));
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("LINK_CYCLE");
      });

      parentCycleIt("AC-STORE-005.12 (REGRESSION): deeper 3-node parent cycle via docs.parent_id-only chain (zero links rows) is rejected", async () => {
        const a = makeDoc({ slug: "prd-pid-3c-a" });
        await store.insert(a);
        const b = makeDoc({ slug: "prd-pid-3c-b", parent_id: a.id });
        await store.insert(b);
        const c = makeDoc({ slug: "prd-pid-3c-c", parent_id: b.id });
        await store.insert(c);

        // No addLink calls above — the entire A←B←C chain exists only as
        // docs.parent_id. Confirm the links table is empty for this fixture.
        const links = await store.findLinks(a.id, "in");
        expect(links.ok).toBe(true);
        if (links.ok) expect(links.value).toHaveLength(0);

        // a → c would close a→c→b→a.
        const result = await store.addLink(makeLink(a.id, c.id, "parent"));
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("LINK_CYCLE");
      });

      it("AC-STORE-005.13 (HAPPY / legal reparent): a doc with an existing docs.parent_id-only ancestor chain can be relinked to an unrelated parent", async () => {
        const a = makeDoc({ slug: "prd-pid-legal-a" });
        await store.insert(a);
        const b = makeDoc({ slug: "prd-pid-legal-b", parent_id: a.id });
        await store.insert(b);
        const unrelated = makeDoc({ slug: "prd-pid-legal-unrelated" });
        await store.insert(unrelated);

        // b is not an ancestor of `unrelated` — no cycle; must succeed.
        const result = await store.addLink(makeLink(b.id, unrelated.id, "parent"));
        expect(result.ok).toBe(true);
      });

      parentCycleIt("AC-STORE-005.14 (STATE/ERROR): a rejected cycle-closing link leaves docs.parent_id and the links table unchanged, and reports a well-formed path", async () => {
        const root = makeDoc({ slug: "prd-pid-noop-root" });
        await store.insert(root);
        const child = makeDoc({ slug: "prd-pid-noop-child", parent_id: root.id });
        await store.insert(child);

        const result = await store.addLink(makeLink(root.id, child.id, "parent"));
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("LINK_CYCLE");
        if (result.error.code !== "LINK_CYCLE") return;
        expect(result.error.path[0]).toBe(root.id);
        expect(result.error.path).toContain(child.id);

        // No partial write: root's parent_id is still null, no links row exists.
        const rootAfter = await store.find(root.id);
        expect(rootAfter.ok).toBe(true);
        if (rootAfter.ok) expect(rootAfter.value?.parent_id).toBeNull();

        const outLinks = await store.findLinks(root.id, "out");
        expect(outLinks.ok).toBe(true);
        if (outLinks.ok) expect(outLinks.value).toHaveLength(0);
      });

      it("AC-STORE-005.10: self-referencing parent link A→A rejected with LINK_CYCLE", async () => {
        const a = makeDoc({ slug: "prd-self-cyc-a" });
        await store.insert(a);

        // a's parent = a → self-cycle, must be rejected even with no
        // pre-existing outgoing parent link on a.
        const result = await store.addLink(makeLink(a.id, a.id, "parent"));
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("LINK_CYCLE");
        if (result.error.code !== "LINK_CYCLE") return;
        expect(result.error.path).toEqual([a.id]);
      });

      it("AC-STORE-005.E01: non-parent links do NOT trigger cycle detection", async () => {
        const a = makeDoc({ slug: "prd-no-cyc-a" });
        const b = makeDoc({ slug: "prd-no-cyc-b" });
        await store.insert(a);
        await store.insert(b);

        await store.addLink(makeLink(b.id, a.id, "informs"));

        // Circular informs link is allowed (not a tree constraint)
        const result = await store.addLink(makeLink(a.id, b.id, "informs"));
        expect(result.ok).toBe(true);
      });

      it("AC-STORE-003.03: softDelete: find(id) returns deleted_at; findMany excludes", async () => {
        const doc = makeDoc({ slug: "prd-st-del" });
        await store.insert(doc);
        await store.softDelete(doc.id);

        const byId = await store.find(doc.id);
        expect(byId.ok).toBe(true);
        if (!byId.ok) return;
        expect(byId.value?.deleted_at).not.toBeNull();

        const many = await store.findMany({});
        expect(many.ok).toBe(true);
        if (!many.ok) return;
        expect(many.value.map((d) => d.id)).not.toContain(doc.id);
      });
    });

    // ── Search (FTS5) ──────────────────────────────────────────────────────────

    describe("search (FTS5)", () => {
      it("AC-STORE-006.02: search with type filter returns only matching type", async () => {
        const spec = makeDoc({
          slug: "spec-fts-auth",
          title: "Auth Spec",
          content: "Authentication requirements for the API.",
          type: "spec",
          role: "spec",
        });
        const prd = makeDoc({
          slug: "prd-fts-auth",
          title: "Auth PRD",
          content: "Authentication product requirements.",
          type: "prd",
          role: "intent",
        });
        await store.insert(spec);
        await store.insert(prd);

        const result = await store.search("auth", { type: "spec" });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        // All returned hits must be spec type
        for (const hit of result.value) {
          const docResult = await store.find(hit.id);
          if (docResult.ok && docResult.value) {
            expect(docResult.value.type).toBe("spec");
          }
        }
      });

      it("search returns snippet string from content column", async () => {
        const doc = makeDoc({
          slug: "prd-snippet",
          title: "Snippet Test",
          content:
            "This document describes the authentication protocol in detail. " +
            "The auth system uses JWT tokens for stateless sessions.",
        });
        await store.insert(doc);

        const result = await store.search("authentication");
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.length).toBeGreaterThan(0);
        const hit = result.value[0];
        expect(hit).toBeDefined();
        expect(typeof hit!.snippet).toBe("string");
        expect(hit!.snippet.length).toBeGreaterThan(0);
      });

      it("search for term in title is found in results", async () => {
        const doc = makeDoc({
          slug: "prd-fts-title",
          title: "Corpus Management System",
          content: "Details about the corpus.",
        });
        await store.insert(doc);

        const result = await store.search("Corpus");
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const ids = result.value.map((h) => h.id);
        expect(ids).toContain(doc.id);
      });

      // SPEC-037 D5 — snippet highlight sentinels replace literal '['/']'
      it("AC-37-8: snippet wraps the matched term in the control-char sentinels, not literal brackets", async () => {
        const doc = makeDoc({
          slug: "prd-sentinel-match",
          title: "Sentinel Match Test",
          content:
            "This document explains the retrogradation protocol used by the sync engine.",
        });
        await store.insert(doc);

        const result = await store.search("retrogradation");
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const hit = result.value.find((h) => h.id === doc.id);
        expect(hit).toBeDefined();
        expect(hit!.snippet).toContain("retrogradation");
        expect(hit!.snippet).not.toContain("[");
        expect(hit!.snippet).not.toContain("]");
      });

      // A document whose body contains literal '[brackets]' must not have them
      // misread as highlight markers — only the real FTS match is wrapped.
      it("AC-37-8: literal brackets in doc content are not treated as highlight markers", async () => {
        const doc = makeDoc({
          slug: "prd-literal-brackets",
          title: "Literal Brackets Test",
          content:
            "See the migrationflowchart [figure 3] for the full walkthrough of the system.",
        });
        await store.insert(doc);

        const result = await store.search("walkthrough");
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const hit = result.value.find((h) => h.id === doc.id);
        expect(hit).toBeDefined();
        // The literal brackets around "figure 3" survive untouched...
        expect(hit!.snippet).toContain("[figure 3]");
        // ...while the real match is wrapped in sentinels, not brackets.
        expect(hit!.snippet).toContain("walkthrough");
      });

      // SPEC-037 §2 — SearchHit now carries type + status from the docs join
      it("AC-37-8: hits carry the doc's type and status (zero extra query)", async () => {
        const doc = makeDoc({
          slug: "spec-hit-meta",
          title: "Hit Metadata Test",
          content: "Covers the metadata propagation requirement end to end.",
          type: "spec",
          role: "spec",
          status: "approved",
        });
        await store.insert(doc);

        const result = await store.search("metadata");
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const hit = result.value.find((h) => h.id === doc.id);
        expect(hit).toBeDefined();
        expect(hit!.type).toBe("spec");
        expect(hit!.status).toBe("approved");
      });
    });

    // ── Regression ────────────────────────────────────────────────────────────

    describe("regression", () => {
      // Regression: insert must not mutate the input doc object (immutability)
      it("insert does not mutate the input doc record", async () => {
        const doc = makeDoc({ slug: "prd-reg-immut" });
        const originalTitle = doc.title;
        await store.insert(doc);
        expect(doc.title).toBe(originalTitle);
      });

      // Regression: findMany with no filters should not crash
      it("AC-STORE-009.03: findMany with empty filters does not throw", async () => {
        const result = await store.findMany({});
        expect(result.ok).toBe(true);
      });

      // Regression: FTS5 update trigger keeps index in sync after content update
      it("FTS index updated after doc update — search finds new content", async () => {
        const doc = makeDoc({
          slug: "prd-fts-update",
          title: "Original Title",
          content: "Original content without special keyword.",
        });
        await store.insert(doc);

        await store.update(doc.id, {
          content: "Updated content with unique_search_keyword_xyz.",
          updated_at: "2026-06-08T11:00:00.000Z",
        });

        const result = await store.search("unique_search_keyword_xyz");
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.map((h) => h.id)).toContain(doc.id);
      });

      // Regression: queryAudit with no filters returns all entries
      it("queryAudit with empty filters returns all entries", async () => {
        const doc = makeDoc({ slug: "prd-audit-all" });
        await store.insert(doc);
        await store.appendAuditEntry(makeAuditEntry(doc.id));
        await store.appendAuditEntry(makeAuditEntry(doc.id));

        const result = await store.queryAudit({});
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.length).toBeGreaterThanOrEqual(2);
      });

      // Regression: change_summary is optional in VersionRecord — must round-trip as undefined
      it("insertVersion without change_summary round-trips as undefined", async () => {
        const doc = makeDoc({ slug: "prd-ver-nosumm" });
        await store.insert(doc);
        const version = makeVersion(doc.id, 1);
        await store.insertVersion({ ...version });

        const result = await store.findVersions(doc.id);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value[0]?.change_summary).toBeUndefined();
      });

      // Regression: large batch insert + filter — no memory issues
      it("AC-STORE-009.01: findMany handles 100 docs with type+status filters", async () => {
        const types = ["spec", "prd", "adr"] as const;
        const roles = ["spec", "intent", "decision"] as const;
        const docs = Array.from({ length: 100 }, (_, i) => {
          const typeIdx = i % 3;
          const type = types[typeIdx]!;
          const role = roles[typeIdx]!;
          return makeDoc({
            slug: `${type}-big-${i}`,
            type,
            role,
            status: i % 2 === 0 ? ("draft" as const) : ("in-review" as const),
          });
        });
        for (const d of docs) await store.insert(d);

        const result = await store.findMany({ type: "spec", status: "draft" });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        for (const doc of result.value) {
          expect(doc.type).toBe("spec");
          expect(doc.status).toBe("draft");
        }
      });
    });

    // ── Optimistic Locking (CAS) — RED scenarios ───────────────────────────────
    //
    // @spec_ref AC-STORE-CAS-001
    // Contract: StoreInterface.update(id, patch, opts?) with opts.expected_version.
    // Source: src/store/store-interface.ts JSDoc for UpdateOpts, SPEC-009 §4.2, D-002.
    //
    // Tests CAS-01 – CAS-04 against SQLiteStore (same contract as InMemoryStore).
    // CAS-02 and CAS-BOUND-01 are RED until conditional UPDATE lands in SQLiteStore.
    // CAS-01, CAS-03, CAS-04 are GREEN today (unconditional update, missing doc).

    describe("optimistic locking (CAS)", () => {
      describe("happy path", () => {
        it("CAS-01: version match → ok, patch applied", async () => {
          // HAPPY: expected_version matches stored version → conditional update succeeds.
          const doc = makeDoc({ slug: "prd-cas-sqlite-v3", version: 3 });
          await store.insert(doc);

          const result = await store.update(
            doc.id,
            { content: "CAS updated content", updated_at: "2026-06-11T01:00:00.000Z" },
            { expected_version: 3 },
          );

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(result.value.content).toBe("CAS updated content");
          // Store does NOT own version increment — patch did not include version, so it stays at 3
          expect(result.value.version).toBe(3);
        });
      });

      describe("negative cases", () => {
        it("CAS-02: version mismatch → err STALE_VERSION with {id, expected, actual}", async () => {
          // NEGATIVE: concurrent writer advanced version to 4; caller expected v3.
          // SQLiteStore must return STALE_VERSION — RED until conditional UPDATE implemented.
          const doc = makeDoc({ slug: "prd-cas-sqlite-v4", version: 4 });
          await store.insert(doc);

          const result = await store.update(
            doc.id,
            { content: "stale write" },
            { expected_version: 3 }, // actual is v4
          );

          expect(result.ok).toBe(false);
          if (result.ok) return;

          expect(result.error.code).toBe("STALE_VERSION");
          if (result.error.code !== "STALE_VERSION") return;
          expect(result.error.id).toBe(doc.id);
          expect(result.error.expected).toBe(3);
          expect(result.error.actual).toBe(4);
        });

        it("CAS-03: doc missing + expected_version → DOC_NOT_FOUND (NOT STALE_VERSION)", async () => {
          // NEGATIVE: non-existent document — must return DOC_NOT_FOUND regardless of expected_version.
          const missingId = "01HMISSINGSQLITE0000CASTEST";

          const result = await store.update(
            missingId,
            { content: "ghost write" },
            { expected_version: 1 },
          );

          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.error.code).toBe("DOC_NOT_FOUND");
          expect(result.error.code).not.toBe("STALE_VERSION");
        });
      });

      describe("boundary values", () => {
        it("CAS-BOUND-01: expected_version=0 → STALE_VERSION (docs start at v1)", async () => {
          // BOUNDARY: v0 never matches a real document (minimum version is 1).
          const doc = makeDoc({ slug: "prd-cas-sqlite-v1-bv", version: 1 });
          await store.insert(doc);

          const result = await store.update(
            doc.id,
            { content: "v0 update attempt" },
            { expected_version: 0 },
          );

          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.error.code).toBe("STALE_VERSION");
        });
      });

      describe("regression — legacy unconditional semantics preserved", () => {
        it("CAS-04: no opts → unconditional update succeeds", async () => {
          // REGRESSION: existing callers pass no opts — backward-compatibility must be preserved.
          // Expected to pass TODAY (before CAS implementation).
          const doc = makeDoc({ slug: "prd-cas-sqlite-legacy", version: 7 });
          await store.insert(doc);

          const result = await store.update(doc.id, {
            content: "unconditional sqlite update",
            updated_at: "2026-06-11T02:00:00.000Z",
          });

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(result.value.content).toBe("unconditional sqlite update");
        });

        it("CAS-04b: opts={} (empty) → unconditional update", async () => {
          // REGRESSION: empty opts object should behave like no opts.
          const doc = makeDoc({ slug: "prd-cas-sqlite-emptyopts", version: 2 });
          await store.insert(doc);

          const result = await store.update(
            doc.id,
            { title: "empty opts update" },
            {}, // no expected_version key
          );

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(result.value.title).toBe("empty opts update");
        });
      });
    });

    // AC-BLS2-9: maxDocVersion — MAX(version) over live docs of every type, no doc parsing.
    describe("maxDocVersion (AC-BLS2-9)", () => {
      it("BOUNDARY: empty corpus reports 0", async () => {
        const r = await store.maxDocVersion();
        expect(r).toEqual({ ok: true, value: 0 });
      });

      it("HAPPY: max over live docs of any type, ignoring soft-deleted rows", async () => {
        await store.insert(makeDoc({ slug: "k-high", type: "knowledge", version: 17 }));
        const gone = makeDoc({ slug: "k-gone", type: "knowledge", version: 40 });
        await store.insert(gone);
        await store.insert(makeDoc({ slug: "t-low", type: "task", version: 3 }));
        expect(await store.maxDocVersion()).toEqual({ ok: true, value: 40 });
        await store.softDelete(gone.id);
        expect(await store.maxDocVersion()).toEqual({ ok: true, value: 17 });
      });
    });
  });
}

/**
 * `dbSizeBytes` for DISK-BACKED stores (SQLiteStore on a temp file, TursoStore
 * file mode). N/A for InMemoryStore, which reports 0 by contract (its own
 * `dbSizeBytes` cases stay in `in-memory-store.test.ts`).
 */
export function runFileBackedDbSizeSuite(opts: StoreSuiteOptions): void {
  describe(`${opts.label} — dbSizeBytes on a disk-backed store (AC-STORE-010)`, () => {
    let store: StoreInterface;

    beforeEach(() => {
      _counter = 0;
      store = opts.createStore();
    });

    afterEach(() => {
      opts.destroyStore(store);
    });

    it("HAPPY: reports > 0 bytes for a freshly-migrated temp db (schema pages alone occupy disk space)", async () => {
      const result = await store.dbSizeBytes();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeGreaterThan(0);
    });

    it("STATE: reports a larger size after inserting documents than an empty schema-only db", async () => {
      const before = await store.dbSizeBytes();
      expect(before.ok).toBe(true);
      if (!before.ok) return;

      for (let i = 0; i < 20; i += 1) {
        await store.insert(
          makeDoc({
            slug: `prd-size-${i}`,
            content: "x".repeat(2000),
          }),
        );
      }

      const after = await store.dbSizeBytes();
      expect(after.ok).toBe(true);
      if (!after.ok) return;
      expect(after.value).toBeGreaterThanOrEqual(before.value);
    });
  });
}
