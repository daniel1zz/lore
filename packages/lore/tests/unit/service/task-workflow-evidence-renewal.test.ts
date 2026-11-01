/**
 * Six-dimension tests for TaskWorkflowService's evidence-triggered claim renewal
 * (SPEC-069 §Design Decisions D4/D5, F2 — closes window W3). Additive to
 * task-workflow-service.test.ts — deliberately NOT merged into that file so this
 * renewal-specific dimension stays isolated and easy to locate; the pre-existing
 * suite is exercised UNMODIFIED as a regression floor (see the completion report).
 *
 * Uses InMemoryStore — no file I/O, no SQLite.
 *
 * Dimension mapping:
 *   HAPPY:      same-holder fresh claim -> addEvidence renews claim.at to the
 *               evidence's own recorded_at, in the SAME single CAS write
 *               (doc version delta === 1), audit details.claim_renewed === true
 *   NEGATIVE:   foreign-holder claim -> extra.claim left byte-identical, no
 *               claim_renewed key in the audit entry's details
 *   BOUNDARY:   same-holder STALE claim (age far past TTL) -> STILL renewed —
 *               the defining D5 behavior (a still-working session outlives TTL)
 *   ERROR:      STALE_VERSION sequential-CAS recipe (SPEC-025 §7) still rejects
 *               correctly with a same-holder claim in play — renewal never
 *               short-circuits the CAS guard, and a rejected write leaves
 *               extra.claim at its pre-call value (REGRESSION for the new wiring)
 *   STATE:      no claim held -> extra.claim stays absent after addEvidence,
 *               no claim_renewed key in audit details
 *   REGRESSION: n/a beyond ERROR above; full pre-existing six-dim coverage
 *               (including the untouched STALE_VERSION recipe) lives in
 *               task-workflow-service.test.ts
 *
 * @spec_ref AC-069-4
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { TaskWorkflowService, type EvidenceInput } from "../../../src/service/task-workflow-service.js";
import type { CreateDocInput, AuditEntry } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

import { fakeWorktreeProbe } from "../../helpers/fake-worktree-probe.js";
import { ensureRequirementsDocId } from "../../helpers/parented-create.js";
// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeServices(ttl = 120) {
  const store = actedStore(new InMemoryStore());
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const taskWorkflowService = new TaskWorkflowService(store, undefined, { claimTtlMinutes: ttl }, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, fakeWorktreeProbe());
  return { store, corpusService, taskWorkflowService };
}

async function createPlan(cs: CorpusService, title = "Renewal Plan"): Promise<string> {
  const result = await cs.create({ parent_id: await ensureRequirementsDocId(cs), type: "plan", title, content: "body" } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create plan: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

async function createTask(cs: CorpusService, planId: string, title = "Renewal Task"): Promise<string> {
  const result = await cs.create({
    type: "task",
    title,
    parent_id: planId,
    content: "body",
    extra: { plan_id: planId, kind: "code" },
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create task: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

// reason: SUPERSEDED default oracle (task-raise-the-evidence-tail-guard-s-
// predicate-to-its-own, D5) — was "tsc", now "manual"; see task-workflow-
// audit.test.ts's identical fixture header for the full rationale.
function evidence(overrides: Partial<EvidenceInput> = {}): EvidenceInput {
  return {
    oracle: "manual",
    command: "bun run typecheck",
    result: "pass",
    recorded_by: "alice",
    output_tail: "ok",
    // reason: task-capture-source-is-optional-at-the-evidence-write-boundary —
    // now compile-time-required on EvidenceInput.
    capture_source: "self-report",
    ...overrides,
  };
}

// ─── HAPPY ────────────────────────────────────────────────────────────────────

describe("HAPPY — same-holder evidence renews the claim in one CAS write (AC-069-4)", () => {
  it("renews claim.at to the evidence's recorded_at, version delta === 1, audit details.claim_renewed === true", async () => {
    const { store, corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const claimResult = await taskWorkflowService.claim(taskId, { by: "alice", worktree: "wt-alice" },() => "2026-07-23T10:00:00.000Z");
    expect(claimResult.ok).toBe(true);
    if (!claimResult.ok) return;
    const versionBeforeEvidence = claimResult.value.version;

    const evidenceResult = await taskWorkflowService.addEvidence(
      taskId,
      evidence({ recorded_by: "alice" }),
      () => "2026-07-23T11:00:00.000Z",
    );
    expect(evidenceResult.ok).toBe(true);
    if (!evidenceResult.ok) return;

    // Atomicity: evidence append + claim renewal is ONE write, not two.
    expect(evidenceResult.value.version).toBe(versionBeforeEvidence + 1);

    const claim = evidenceResult.value.extra["claim"] as Record<string, unknown>;
    const evidenceArr = evidenceResult.value.extra["verification_evidence"] as Array<Record<string, unknown>>;
    expect(claim.at).toBe("2026-07-23T11:00:00.000Z");
    expect(claim.by).toBe("alice");
    expect(evidenceArr[0]?.["recorded_at"]).toBe(claim.at);

    const auditResult = await store.queryAudit({ doc_id: taskId, action: "evidence" });
    expect(auditResult.ok).toBe(true);
    if (!auditResult.ok) return;
    expect(auditResult.value).toHaveLength(1);
    const entry = auditResult.value[0] as AuditEntry;
    expect(entry.details?.["claim_renewed"]).toBe(true);
  });

  it("preserves branch/machine/worktree fields on the renewed claim", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.claim(
      taskId,
      { by: "alice", branch: "feat/x", machine: "alices-mbp", worktree: "/repo/.worktrees/t1" },
      () => "2026-07-23T10:00:00.000Z",
    );

    const evidenceResult = await taskWorkflowService.addEvidence(
      taskId,
      evidence({ recorded_by: "alice" }),
      () => "2026-07-23T11:00:00.000Z",
    );
    expect(evidenceResult.ok).toBe(true);
    if (!evidenceResult.ok) return;
    expect(evidenceResult.value.extra["claim"]).toMatchObject({
      by: "alice",
      branch: "feat/x",
      machine: "alices-mbp",
      worktree: "/repo/.worktrees/t1",
    });
  });
});

// ─── NEGATIVE ─────────────────────────────────────────────────────────────────

describe("NEGATIVE — foreign-holder evidence leaves the claim untouched (AC-069-4)", () => {
  it("extra.claim stays byte-identical and audit details carry no claim_renewed key", async () => {
    const { store, corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const claimResult = await taskWorkflowService.claim(taskId, { by: "alice", worktree: "wt-alice" },() => "2026-07-23T10:00:00.000Z");
    expect(claimResult.ok).toBe(true);
    if (!claimResult.ok) return;
    const claimBefore = claimResult.value.extra["claim"];

    // "bob" records evidence while "alice" still holds the claim.
    const evidenceResult = await taskWorkflowService.addEvidence(
      taskId,
      evidence({ recorded_by: "bob" }),
      () => "2026-07-23T11:00:00.000Z",
    );
    expect(evidenceResult.ok).toBe(true);
    if (!evidenceResult.ok) return;
    expect(evidenceResult.value.extra["claim"]).toStrictEqual(claimBefore);

    const auditResult = await store.queryAudit({ doc_id: taskId, action: "evidence" });
    expect(auditResult.ok).toBe(true);
    if (!auditResult.ok) return;
    expect(auditResult.value).toHaveLength(1);
    const entry = auditResult.value[0] as AuditEntry;
    expect(entry.details?.["claim_renewed"]).toBeUndefined();
  });
});

// ─── BOUNDARY ─────────────────────────────────────────────────────────────────

describe("BOUNDARY — same-holder STALE claim still renews on evidence (AC-069-4, D5)", () => {
  it("a claim far past the TTL is still renewed when the SAME actor records evidence", async () => {
    const { corpusService, taskWorkflowService } = makeServices(120);
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.claim(taskId, { by: "alice", worktree: "wt-alice" },() => "2026-01-01T00:00:00.000Z");

    // Far past any TTL — a foreign claimant would find this stale and claimable
    // without --steal, but the evidence recorder here IS the same holder.
    const evidenceResult = await taskWorkflowService.addEvidence(
      taskId,
      evidence({ recorded_by: "alice" }),
      () => "2026-07-23T12:00:00.000Z",
    );
    expect(evidenceResult.ok).toBe(true);
    if (!evidenceResult.ok) return;
    const claim = evidenceResult.value.extra["claim"] as Record<string, unknown>;
    expect(claim.at).toBe("2026-07-23T12:00:00.000Z");
    expect(claim.by).toBe("alice");
  });
});

// ─── STATE ────────────────────────────────────────────────────────────────────

describe("STATE — no claim held (AC-069-4)", () => {
  it("extra.claim stays absent after addEvidence, and audit details carry no claim_renewed key", async () => {
    const { store, corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const evidenceResult = await taskWorkflowService.addEvidence(taskId, evidence({ recorded_by: "alice" }));
    expect(evidenceResult.ok).toBe(true);
    if (!evidenceResult.ok) return;
    expect(evidenceResult.value.extra["claim"]).toBeUndefined();

    const auditResult = await store.queryAudit({ doc_id: taskId, action: "evidence" });
    expect(auditResult.ok).toBe(true);
    if (!auditResult.ok) return;
    const entry = auditResult.value[0] as AuditEntry;
    expect(entry.details?.["claim_renewed"]).toBeUndefined();
  });
});

// ─── ERROR — STALE_VERSION regression under the new renewal wiring ──────────

describe("ERROR — STALE_VERSION sequential-CAS recipe still rejects correctly with a same-holder claim in play (AC-069-4, REGRESSION)", () => {
  it("addEvidence surfaces STALE_VERSION and leaves extra.claim at its pre-call value when the write is rejected", async () => {
    const { corpusService, taskWorkflowService, store } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const claimResult = await taskWorkflowService.claim(taskId, { by: "alice", worktree: "wt-alice" },() => "2026-07-23T10:00:00.000Z");
    expect(claimResult.ok).toBe(true);
    if (!claimResult.ok) return;
    const versionAfterClaim = claimResult.value.version;
    const claimBefore = claimResult.value.extra["claim"];

    let sideEffectApplied = false;
    // reason: `now()` fires AFTER resolveTask() has captured task.version (the CAS
    // expected_version) but BEFORE writeTaskExtra's store.update call — bumping the
    // doc's version here deterministically simulates a concurrent writer, per the
    // documented sequential-CAS recipe (SPEC-025 §7).
    const now = (): string => {
      if (!sideEffectApplied) {
        sideEffectApplied = true;
        void store.update(
          taskId,
          { extra: { plan_id: planId, claim: claimBefore, injected_by_other_writer: true }, version: versionAfterClaim + 1 },
          { expected_version: versionAfterClaim },
        );
      }
      return "2026-07-23T11:00:00.000Z";
    };

    // The SAME actor as the claim holder records evidence — renewClaimForEvidence
    // would produce a non-null renewal, but the CAS guard must still reject.
    const result = await taskWorkflowService.addEvidence(taskId, evidence({ recorded_by: "alice" }), now);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("STALE_VERSION");

    const finalDoc = await corpusService.get(taskId);
    expect(finalDoc.ok).toBe(true);
    if (!finalDoc.ok) return;
    expect(finalDoc.value.doc.extra["claim"]).toStrictEqual(claimBefore);
    expect(finalDoc.value.doc.extra["verification_evidence"]).toBeUndefined();
  });
});
