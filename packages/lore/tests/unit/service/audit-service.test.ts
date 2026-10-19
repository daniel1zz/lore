/**
 * Six-dimension tests for AuditService (SPEC-035 §2, §5).
 * Uses InMemoryStore — no file I/O, no SQLite.
 *
 * Dimension mapping:
 *   HAPPY:      a CorpusService.create() write satisfies verify() out of the box;
 *               query({doc_id}) surfaces the create audit entry
 *   NEGATIVE:   a versions row with NO matching audit entry (a writer that "forgot"
 *               to audit) is reported as a miss
 *   BOUNDARY:   no date skips a version (the retired D5 cut-off); a version-number
 *               mismatch (off-by-one) between versions row and audit entry is NOT
 *               satisfied by an adjacent version's audit entry
 *   STATE:      every version is reported audited, reconstructed (only a backfill
 *               entry) or missing
 *   REGRESSION: `delete` is excluded from the anchor set even though CorpusService
 *               stamps details.version on delete's audit entry too; the
 *               TaskWorkflowService action-string divergence (versions:"update"
 *               vs audit:"claim"/"release"/"evidence") does NOT produce false
 *               misses — this is the central regression this file guards
 *
 * @spec_ref SPEC-035 §2, §5
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import { AuditService } from "../../../src/service/audit-service.js";
import { resolveActorWithSource } from "@lore/core/node";
import type { CreateDocInput, VersionRecord, AuditEntry } from "@lore/core";
import { liveInvocation, actedStore } from "../../live-invocation.js";

// ─── Fixture helpers ──────────────────────────────────────────────────────────

const FAR_PAST = "2000-01-01T00:00:00.000Z"; // always before any doc created during a test run

function makeStore() {
  const store = actedStore(new InMemoryStore());
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
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
  it("verify() reports clean:true after a single create", async () => {
    const { store, corpusService } = makeStore();
    const auditService = new AuditService(store);

    const planId = await createPlan(corpusService);
    void planId;

    const result = await auditService.verify();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.clean).toBe(true);
    expect(result.value.misses).toEqual([]);
    expect(result.value).toMatchObject({ audited: 1, reconstructed: 0 });
  });

  it("query({doc_id}) returns the create audit entry with action 'create' and details.version 1", async () => {
    const { store, corpusService } = makeStore();
    const auditService = new AuditService(store);

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
    expect(entry.actor).toBe(resolveActorWithSource(undefined, process.env, liveInvocation().user).actor);
    expect(entry.details?.["version"]).toBe(1);
  });

  it("query() with an unrelated doc_id returns an empty array (defeats a hardcoded non-empty stub)", async () => {
    const { store, corpusService } = makeStore();
    const auditService = new AuditService(store);

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
    const auditService = new AuditService(store);

    const planId = await createPlan(corpusService);

    // Simulate a writer that forgot to audit: insertVersion with no appendAuditEntry.
    await store.insertVersion(
      baseVersionRow({ doc_id: planId, version: 2, action: "update", created_at: "2020-06-01T00:00:00.000Z" }),
    );

    const result = await auditService.verify();
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

describe("BOUNDARY — no date skips a version (task-audit-verification-checks-every-version-pre-writer-history)", () => {
  it("a versions row recorded long ago, with no matching audit entry, IS a miss", async () => {
    const { store, corpusService } = makeStore();
    const auditService = new AuditService(store);

    const planId = await createPlan(corpusService);
    await store.insertVersion(
      baseVersionRow({ doc_id: planId, version: 2, action: "update", created_at: "2001-01-01T00:00:00.000Z" }),
    );

    const result = await auditService.verify();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.clean).toBe(false);
    expect(result.value.misses).toEqual([
      { doc_id: planId, version: 2, action: "update", created_at: "2001-01-01T00:00:00.000Z" },
    ]);
  });
});

describe("BOUNDARY — exact (doc_id, version) join, not a fuzzy/adjacent match", () => {
  it("an audit entry at details.version=2 does NOT satisfy a versions row at version=3", async () => {
    const { store, corpusService } = makeStore();
    const auditService = new AuditService(store);

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

    const result = await auditService.verify();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.clean).toBe(false);
    expect(result.value.misses).toHaveLength(1);
    expect(result.value.misses[0]).toMatchObject({ doc_id: planId, version: 3 });
  });
});

// ─── STATE — audited vs reconstructed vs missing ───────────────────────────

describe("STATE — every version is reported audited, reconstructed or missing", () => {
  it("a backfill entry satisfies its version and counts as reconstructed; an original entry counts as audited", async () => {
    const { store, corpusService } = makeStore();
    const auditService = new AuditService(store);
    const planId = await createPlan(corpusService); // version 1: audited by the create entry

    await store.insertVersion(
      baseVersionRow({ doc_id: planId, version: 2, action: "update", created_at: "2001-01-01T00:00:00.000Z" }),
    );
    await store.appendAuditEntry({
      timestamp: "2026-10-19T00:00:00.000Z",
      actor: "system",
      session_id: "audit-backfill-run",
      action: "audit-backfill",
      doc_id: planId,
      details: { version: 2, reconstructed: true },
    });

    const result = await auditService.verify();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.clean).toBe(true);
    expect(result.value.audited).toBe(1);
    expect(result.value.reconstructed).toBe(1);
    expect(result.value.misses).toEqual([]);
    expect(result.value.chain.clean).toBe(true);
  });

  it("an original entry wins: a version with BOTH an original and a backfill entry counts as audited", async () => {
    const { store, corpusService } = makeStore();
    const planId = await createPlan(corpusService);
    await store.appendAuditEntry({
      timestamp: "2026-10-19T00:00:00.000Z",
      actor: "system",
      session_id: "audit-backfill-run",
      action: "audit-backfill",
      doc_id: planId,
      details: { version: 1, reconstructed: true },
    });

    const result = await new AuditService(store).verify();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ audited: 1, reconstructed: 0, clean: true });
  });

  it("a backfill entry never satisfies a different version of the same doc", async () => {
    const { store, corpusService } = makeStore();
    const planId = await createPlan(corpusService);
    await store.insertVersion(
      baseVersionRow({ doc_id: planId, version: 3, action: "update", created_at: "2001-01-01T00:00:00.000Z" }),
    );
    await store.appendAuditEntry({
      timestamp: "2026-10-19T00:00:00.000Z",
      actor: "system",
      session_id: "audit-backfill-run",
      action: "audit-backfill",
      doc_id: planId,
      details: { version: 2, reconstructed: true },
    });

    const result = await new AuditService(store).verify();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.clean).toBe(false);
    expect(result.value.misses).toHaveLength(1);
    expect(result.value.misses[0]).toMatchObject({ doc_id: planId, version: 3 });
  });
});

// ─── REGRESSION ───────────────────────────────────────────────────────────────

describe("REGRESSION — delete is excluded from the verifiable-action anchor set", () => {
  it("a delete versions row (version:0) with no matching audit entry does NOT count as a miss", async () => {
    const { store, corpusService } = makeStore();
    const auditService = new AuditService(store);

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

    const result = await auditService.verify();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.clean).toBe(true);
    expect(result.value.misses).toEqual([]);
  });
});

describe("REGRESSION — an unrelated action family (\"judge\") does not mask a missing audit entry", () => {
  it("an update versions row satisfied ONLY by a same-version 'judge' audit entry is still reported as a MISS", async () => {
    const { store, corpusService } = makeStore();
    const auditService = new AuditService(store);

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

    const result = await auditService.verify();
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
    const auditService = new AuditService(store);

    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const claimResult = await taskWorkflowService.claim(taskId, { by: "alice" });
    expect(claimResult.ok).toBe(true);

    // reason: SUPERSEDED oracle (task-raise-the-evidence-tail-guard-s-
    // predicate-to-its-own) — "tsc" self-report is now refused regardless of
    // tail content; "manual" is the one oracle that still lets a genuinely
    // non-empty self-reported tail succeed. This test only checks audit
    // action-string mapping, not capture_source semantics.
    const evidenceResult = await taskWorkflowService.addEvidence(taskId, {
      oracle: "manual",
      command: "bun run typecheck",
      result: "pass",
      recorded_by: "alice",
      output_tail: "ok",
      capture_source: "self-report",
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
