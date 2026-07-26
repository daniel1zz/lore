/**
 * Six-dimension tests for AuditService (SPEC-035 §2, §5).
 * Uses InMemoryStore — no file I/O, no SQLite.
 *
 * Dimension mapping:
 *   HAPPY:      a CorpusService.create() write satisfies verify() out of the box;
 *               query({doc_id}) surfaces the create audit entry
 *   NEGATIVE:   a versions row with NO matching audit entry (a writer that "forgot"
 *               to audit) is reported as a miss
 *   BOUNDARY:   pre-watermark holes are ignored (D5); a version-number mismatch
 *               (off-by-one) between versions row and audit entry is NOT satisfied
 *               by an adjacent version's audit entry
 *   STATE:      verify()'s `since` resolution — constructor default vs per-call
 *               override — is genuinely read from the two different sources, not
 *               hardcoded
 *   REGRESSION: `delete` is excluded from the anchor set even though CorpusService
 *               stamps details.version on delete's audit entry too; the
 *               TaskWorkflowService action-string divergence (versions:"update"
 *               vs audit:"claim"/"release"/"evidence") does NOT produce false
 *               misses — this is the central regression this file guards
 *
 * @spec_ref SPEC-035 §2, §5
 */

import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import { AuditService } from "../../../src/service/audit-service.js";
import { resolveActorWithSource } from "@lore/core/node";
import type { CreateDocInput, VersionRecord, AuditEntry } from "@lore/core";

// ─── Fixture helpers ──────────────────────────────────────────────────────────

const FAR_PAST = "2000-01-01T00:00:00.000Z"; // always before any doc created during a test run

function makeStore() {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store);
  return { store, corpusService };
}

async function createPlan(cs: CorpusService, title = "Audit Test Plan"): Promise<string> {
  const result = await cs.create({ type: "plan", title, content: "body" } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create plan: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

async function createTask(cs: CorpusService, planId: string, title = "Audit Test Task"): Promise<string> {
  const result = await cs.create({
    type: "task",
    title,
    parent_id: planId,
    content: "body",
    extra: { plan_id: planId },
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create task: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

function baseVersionRow(overrides: Partial<VersionRecord> & Pick<VersionRecord, "doc_id" | "version" | "action">): VersionRecord {
  return {
    content: "content",
    extra: {},
    status: "draft",
    title: "title",
    created_at: FAR_PAST,
    created_by: "system",
    ...overrides,
  };
}

// ─── HAPPY ────────────────────────────────────────────────────────────────────

describe("HAPPY — a CorpusService.create() write satisfies verify() out of the box", () => {
  it("verify({since: <before creation>}) reports clean:true after a single create", async () => {
    const { store, corpusService } = makeStore();
    const auditService = new AuditService(store, { verifySince: FAR_PAST });

    const planId = await createPlan(corpusService);
    void planId;

    const result = await auditService.verify({ since: FAR_PAST });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.clean).toBe(true);
    expect(result.value.misses).toEqual([]);
    expect(result.value.since).toBe(FAR_PAST);
  });

  it("query({doc_id}) returns the create audit entry with action 'create' and details.version 1", async () => {
    const { store, corpusService } = makeStore();
    const auditService = new AuditService(store, { verifySince: FAR_PAST });

    const planId = await createPlan(corpusService);

    const result = await auditService.query({ doc_id: planId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    const entry = result.value[0] as AuditEntry;
    expect(entry.action).toBe("create");
    // SPEC-079 G2 (actor fidelity) — the audit entry's actor is now the
    // resolved actor (opts.by > $LORE_ACTOR > session tier > OS username),
    // never the literal "system". `createPlan` passes no `by`, so the
    // expected value is whatever the SAME env-chain resolution yields at
    // test time (this test never mutates process.env, so it's stable within
    // a single run — see audit-actor-fidelity.test.ts for the full env-chain
    // coverage this asymmetry is dedicated to).
    expect(entry.actor).toBe(resolveActorWithSource(undefined, process.env).actor);
    expect(entry.details?.["version"]).toBe(1);
  });

  it("query() with an unrelated doc_id returns an empty array (defeats a hardcoded non-empty stub)", async () => {
    const { store, corpusService } = makeStore();
    const auditService = new AuditService(store, { verifySince: FAR_PAST });

    await createPlan(corpusService);

    const result = await auditService.query({ doc_id: "01J5X7KZRF4AXRHX9WKE6DVP6P" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });
});

// ─── NEGATIVE ─────────────────────────────────────────────────────────────────

describe("NEGATIVE — a versions row with no matching audit entry is a miss", () => {
  it("an update versions row written WITHOUT a matching appendAuditEntry call is reported as exactly one miss", async () => {
    const { store, corpusService } = makeStore();
    const auditService = new AuditService(store, { verifySince: FAR_PAST });

    const planId = await createPlan(corpusService);

    // Simulate a writer that forgot to audit: insertVersion with no appendAuditEntry.
    await store.insertVersion(
      baseVersionRow({ doc_id: planId, version: 2, action: "update", created_at: "2020-06-01T00:00:00.000Z" }),
    );

    const result = await auditService.verify({ since: FAR_PAST });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.clean).toBe(false);
    expect(result.value.misses).toHaveLength(1);
    expect(result.value.misses[0]).toMatchObject({
      doc_id: planId,
      version: 2,
      action: "update",
    });
  });
});

// ─── BOUNDARY ─────────────────────────────────────────────────────────────────

describe("BOUNDARY — pre-watermark holes are ignored (D5)", () => {
  it("a versions row created BEFORE `since`, with no matching audit entry, does not count as a miss", async () => {
    const { store, corpusService } = makeStore();
    const since = "2025-06-01T00:00:00.000Z";
    const auditService = new AuditService(store, { verifySince: since });

    const planId = await createPlan(corpusService);

    // This row predates the watermark — must be excluded from the reconcile walk.
    await store.insertVersion(
      baseVersionRow({ doc_id: planId, version: 2, action: "update", created_at: "2025-01-01T00:00:00.000Z" }),
    );

    const result = await auditService.verify({ since });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.clean).toBe(true);
    expect(result.value.misses).toEqual([]);
  });
});

describe("BOUNDARY — exact (doc_id, version) join, not a fuzzy/adjacent match", () => {
  it("an audit entry at details.version=2 does NOT satisfy a versions row at version=3", async () => {
    const { store, corpusService } = makeStore();
    const auditService = new AuditService(store, { verifySince: FAR_PAST });

    const planId = await createPlan(corpusService);

    // versions row demands an audit entry at (planId, 3)...
    await store.insertVersion(
      baseVersionRow({ doc_id: planId, version: 3, action: "update", created_at: "2020-06-01T00:00:00.000Z" }),
    );
    // ...but the only non-create audit entry present is for version 2 (off-by-one).
    await store.appendAuditEntry({
      timestamp: "2020-06-01T00:00:00.000Z",
      actor: "system",
      session_id: planId,
      action: "update",
      doc_id: planId,
      details: { version: 2 },
    });

    const result = await auditService.verify({ since: FAR_PAST });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.clean).toBe(false);
    expect(result.value.misses).toHaveLength(1);
    expect(result.value.misses[0]).toMatchObject({ doc_id: planId, version: 3 });
  });
});

// ─── STATE — since resolution: constructor default vs per-call override ────

describe("STATE — verify()'s `since` genuinely reads from the constructor default when opts is omitted", () => {
  it("two AuditService instances with different constructor verifySince values disagree on the same store state", async () => {
    const store = new InMemoryStore();
    const corpusService = new CorpusService(store);
    const planId = await createPlan(corpusService);

    // A versions row sitting between two candidate watermarks, with no matching audit entry.
    await store.insertVersion(
      baseVersionRow({ doc_id: planId, version: 2, action: "update", created_at: "2025-06-15T00:00:00.000Z" }),
    );

    // Watermark BEFORE the row → row is a candidate → miss → dirty.
    const serviceEarlyWatermark = new AuditService(store, { verifySince: "2025-06-01T00:00:00.000Z" });
    const dirtyResult = await serviceEarlyWatermark.verify(); // no opts — must use constructor default
    expect(dirtyResult.ok).toBe(true);
    if (!dirtyResult.ok) return;
    expect(dirtyResult.value.clean).toBe(false);
    expect(dirtyResult.value.since).toBe("2025-06-01T00:00:00.000Z");

    // Watermark AFTER the row → row is excluded → clean.
    const serviceLateWatermark = new AuditService(store, { verifySince: "2025-07-01T00:00:00.000Z" });
    const cleanResult = await serviceLateWatermark.verify(); // no opts — must use constructor default
    expect(cleanResult.ok).toBe(true);
    if (!cleanResult.ok) return;
    expect(cleanResult.value.clean).toBe(true);
    expect(cleanResult.value.since).toBe("2025-07-01T00:00:00.000Z");
  });

  it("a per-call opts.since overrides the constructor default", async () => {
    const store = new InMemoryStore();
    const corpusService = new CorpusService(store);
    const planId = await createPlan(corpusService);

    await store.insertVersion(
      baseVersionRow({ doc_id: planId, version: 2, action: "update", created_at: "2025-06-15T00:00:00.000Z" }),
    );

    // Constructor default would report dirty (early watermark)...
    const auditService = new AuditService(store, { verifySince: "2025-06-01T00:00:00.000Z" });
    const withoutOverride = await auditService.verify();
    expect(withoutOverride.ok).toBe(true);
    if (!withoutOverride.ok) return;
    expect(withoutOverride.value.clean).toBe(false);

    // ...but an explicit per-call `since` after the row overrides it to clean.
    const withOverride = await auditService.verify({ since: "2025-07-01T00:00:00.000Z" });
    expect(withOverride.ok).toBe(true);
    if (!withOverride.ok) return;
    expect(withOverride.value.clean).toBe(true);
    expect(withOverride.value.since).toBe("2025-07-01T00:00:00.000Z");
  });
});

// ─── REGRESSION ───────────────────────────────────────────────────────────────

describe("REGRESSION — delete is excluded from the verifiable-action anchor set", () => {
  it("a delete versions row (version:0) with no matching audit entry does NOT count as a miss", async () => {
    const { store, corpusService } = makeStore();
    const auditService = new AuditService(store, { verifySince: FAR_PAST });

    const planId = await createPlan(corpusService);

    // Simulate exactly what CorpusService.delete's versions row looks like — action "delete",
    // version 0 sentinel — but WITHOUT the accompanying appendAuditEntry call.
    await store.insertVersion(
      baseVersionRow({
        doc_id: planId,
        version: 0,
        action: "delete",
        status: "archived",
        content: "",
        title: "",
        created_at: "2020-06-01T00:00:00.000Z",
      }),
    );

    const result = await auditService.verify({ since: FAR_PAST });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.clean).toBe(true);
    expect(result.value.misses).toEqual([]);
  });
});

describe("REGRESSION — an unrelated action family (\"judge\") does not mask a missing audit entry", () => {
  it("an update versions row satisfied ONLY by a same-version 'judge' audit entry is still reported as a MISS", async () => {
    const { store, corpusService } = makeStore();
    const auditService = new AuditService(store, { verifySince: FAR_PAST });

    const planId = await createPlan(corpusService);

    // A writer regression: an update versions row was inserted with NO accompanying
    // create/update/approve/reject/restore-family audit entry...
    await store.insertVersion(
      baseVersionRow({ doc_id: planId, version: 2, action: "update", created_at: "2020-06-01T00:00:00.000Z" }),
    );
    // ...but an UNRELATED "judge" audit entry (SPEC-034 AI review judgment, which stamps
    // the doc's CURRENT version but never bumps it) happens to carry the same version.
    // Before the action-family fix, matching on version alone would let this incidentally
    // satisfy the versions row — masking the writer regression. It must NOT.
    await store.appendAuditEntry({
      timestamp: "2020-06-01T00:00:00.000Z",
      actor: "ai:claude-cli:claude-sonnet-5:v1",
      session_id: `judge-${planId}`,
      action: "judge",
      doc_id: planId,
      details: { judgment_ref: "01JUDGMENTFAKE00000000001", version: 2 },
    });

    const result = await auditService.verify({ since: FAR_PAST });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.clean).toBe(false);
    expect(result.value.misses).toHaveLength(1);
    expect(result.value.misses[0]).toMatchObject({ doc_id: planId, version: 2, action: "update" });
  });
});

describe("REGRESSION — TaskWorkflowService's action-string divergence does not produce false misses", () => {
  it("claim → addEvidence → release all satisfy verify() despite versions:'update' vs audit:'claim'/'evidence'/'release'", async () => {
    const { store, corpusService } = makeStore();
    const taskWorkflowService = new TaskWorkflowService(store, undefined, { claimTtlMinutes: 120 });
    const auditService = new AuditService(store, { verifySince: FAR_PAST });

    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const claimResult = await taskWorkflowService.claim(taskId, { by: "alice" });
    expect(claimResult.ok).toBe(true);

    const evidenceResult = await taskWorkflowService.addEvidence(taskId, {
      oracle: "tsc",
      command: "bun run typecheck",
      result: "pass",
      recorded_by: "alice",
    });
    expect(evidenceResult.ok).toBe(true);

    const releaseResult = await taskWorkflowService.release(taskId, { by: "alice" });
    expect(releaseResult.ok).toBe(true);

    // Sanity: the versions rows for these three writes really do carry action "update",
    // NOT "claim"/"evidence"/"release" — this is the divergence the join-key design tolerates.
    const versions = await store.listAllVersions(FAR_PAST);
    expect(versions.ok).toBe(true);
    if (!versions.ok) return;
    const taskVersionActions = versions.value.filter((v) => v.doc_id === taskId).map((v) => v.action);
    expect(taskVersionActions.filter((a) => a === "update").length).toBe(3);

    const result = await auditService.verify();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.clean).toBe(true);
    expect(result.value.misses).toEqual([]);
  });
});
