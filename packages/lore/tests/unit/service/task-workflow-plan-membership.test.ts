/**
 * task-workflow-plan-membership.test.ts —
 * task-plan-membership-is-extra-plan-id-but-the-last-task.
 *
 * Plan membership is `extra.plan_id` (the DECLARED, mandatory property every
 * non-adhoc task's `--plan-id` writes) — not `parent_id` (a proxy `--parent`
 * legitimately diverges from per SPEC-065 D4: "a task parented somewhere OTHER
 * than its own plan passes --parent explicitly"). Before this fix, BOTH
 * `TaskWorkflowService.ready()` and the private `computePlanNowFullyTerminal`
 * (the `done()` last-task advisory, DD-2/AC-CLOSURE-3) queried `parent_id` —
 * silently dropping a diverged member from its OWN plan and attributing it to
 * whatever plan it happens to be filed under instead.
 *
 * Case H (measured, throwaway-corpus repro 2026-08-01): P3/P4 are plans. T5 is
 * `--parent P3 --plan-id P3` (undiverged, a real P3 member). T6 is `--parent P4
 * --plan-id P3` (BELONGS to P3, filed under P4). T6 stays draft. Before the fix,
 * `lore done T5` fires the last-task advisory for P3 even though T6 (a real P3
 * member) is still draft — because the old `parent_id`-keyed sibling query never
 * saw T6 at all (it is parented at P4, not P3).
 *
 * Also covers the ADR proxy/silence/opt-in review's Q2 requirement: a plan whose
 * `extra.plan_id` member set is EMPTY while the retired `parent_id`-keyed set is
 * NON-EMPTY is a contradiction, reported as a distinct
 * `plan_membership_disagreement` value — never unioned away.
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 *
 * @spec_ref task-plan-membership-is-extra-plan-id-but-the-last-task
 * @spec_ref adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the (Q2)
 * @spec_ref spec-plan-closure-must-be-loud-terminality-divergence-silent DD-2 / AC-CLOSURE-3
 */

import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import type {
  EvidenceInput,
  VerifiedEvidenceInput,
  DoneResult,
} from "../../../src/service/task-workflow-service.js";
import type { CreateDocInput, DocRecord, Result, LoreError } from "@lore/core";

function makeServices(ttl = 120) {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store);
  const taskWorkflowService = new TaskWorkflowService(store, undefined, { claimTtlMinutes: ttl });
  return { store, corpusService, taskWorkflowService };
}

async function createPlan(cs: CorpusService, title: string): Promise<DocRecord> {
  const result = await cs.create({ type: "plan", title, content: "body" } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create plan: ${JSON.stringify(result.error)}`);
  return result.value;
}

/**
 * `parentId` is where the task is FILED (`--parent`); `planId` is the plan it
 * BELONGS to (`--plan-id`). Passing different values reproduces the SPEC-065 D4
 * divergence this fix is about; passing the same value for both is the plain,
 * undiverged control shape every other task-workflow test already exercises.
 */
async function createTask(
  cs: CorpusService,
  parentId: string,
  planId: string,
  title: string,
): Promise<DocRecord> {
  const result = await cs.create({
    type: "task",
    title,
    parent_id: parentId,
    content: "body",
    extra: { plan_id: planId },
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create task: ${JSON.stringify(result.error)}`);
  return result.value;
}

function evidence(overrides: Partial<EvidenceInput> = {}): EvidenceInput {
  return {
    oracle: "tsc",
    command: "bun run typecheck",
    result: "pass",
    recorded_by: "alice",
    // reason: task-capture-source-is-optional-at-the-evidence-write-boundary —
    // now compile-time-required on EvidenceInput.
    capture_source: "self-report",
    ...overrides,
  };
}

/** A runner-attested `result: "pass"` row (SPEC-039 §2 D2) — `done()`'s attestation
 *  floor (adr-lore-done-requires-a-runner-attested-pass-the-sixth-false) requires
 *  at least one of these; a self-reported `evidence()` row alone no longer suffices. */
function attestedPass(overrides: Partial<VerifiedEvidenceInput> = {}): VerifiedEvidenceInput {
  return {
    oracle: "tsc",
    command: "bun run typecheck",
    result: "pass",
    recorded_by: "runner",
    attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false },
    // reason: task-capture-source-is-optional-at-the-evidence-write-boundary —
    // now compile-time-required on VerifiedEvidenceInput; "runner" is the value
    // the real-world caller (VerifyRunnerService) actually proves.
    capture_source: "runner",
    ...overrides,
  };
}

async function archiveTask(
  tw: TaskWorkflowService,
  taskId: string,
): Promise<Result<DoneResult, LoreError>> {
  await tw.addEvidence(taskId, evidence());
  await tw.recordVerifiedEvidence(taskId, attestedPass(), "2026-08-01T09:00:00.000Z");
  return tw.done(taskId, { by: "alice" });
}

describe("plan membership: extra.plan_id vs parent_id (task-plan-membership-is-extra-plan-id-but-the-last-task)", () => {
  // ── HAPPY ──────────────────────────────────────────────────────────────

  it("HAPPY (AC1, case H): archiving T5 (an undiverged P3 member) does NOT fire the last-task advisory while T6 (a diverged real P3 member, filed at P4) is still draft", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const p3 = await createPlan(corpusService, "P3");
    const p4 = await createPlan(corpusService, "P4");
    const t5 = await createTask(corpusService, p3.id, p3.id, "T5 undiverged P3 member");
    const t6 = await createTask(corpusService, p4.id, p3.id, "T6 diverged P3 member (filed at P4)");
    void t6; // stays draft — the point of this scenario

    const doneResult = await archiveTask(taskWorkflowService, t5.id);
    expect(doneResult.ok).toBe(true);
    if (!doneResult.ok) return;

    expect(
      doneResult.value.plan_now_fully_terminal,
      "advisory fired for P3 while T6 (a real P3 member via extra.plan_id) is still draft — the exact bug this task removes",
    ).toBeUndefined();
    expect(doneResult.value.plan_membership_disagreement).toBeUndefined();
  });

  // ── NEGATIVE ───────────────────────────────────────────────────────────

  it("NEGATIVE (AC2): ready(P3) lists T6 (a real P3 member); ready(P4) does NOT (T6 is merely FILED there)", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const p3 = await createPlan(corpusService, "P3 Ready");
    const p4 = await createPlan(corpusService, "P4 Ready");
    await createTask(corpusService, p3.id, p3.id, "T5 undiverged P3 member");
    const t6 = await createTask(corpusService, p4.id, p3.id, "T6 diverged P3 member (filed at P4)");

    const readyP3 = await taskWorkflowService.ready(p3.id);
    expect(readyP3.ok).toBe(true);
    if (!readyP3.ok) return;
    expect(readyP3.value.records.some((r) => r.task.id === t6.id)).toBe(true);

    const readyP4 = await taskWorkflowService.ready(p4.id);
    expect(readyP4.ok).toBe(true);
    if (!readyP4.ok) return;
    expect(readyP4.value.records.some((r) => r.task.id === t6.id)).toBe(false);
    expect(readyP4.value.records).toEqual([]);
  });

  // ── BOUNDARY ───────────────────────────────────────────────────────────

  it("BOUNDARY (AC5, Q2): a plan whose extra.plan_id member set is EMPTY but whose parent_id-keyed set is NON-EMPTY reports a DISTINCT membership_disagreement value, not the same undefined a genuinely empty plan gets", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const p3 = await createPlan(corpusService, "P3 Disagreement");
    const p4 = await createPlan(corpusService, "P4 Disagreement");
    // T6 is filed at P4 but BELONGS to P3 — P4's extra.plan_id member set is
    // empty, but P4's parent_id-keyed set is {T6} (non-empty): a contradiction.
    const t6 = await createTask(corpusService, p4.id, p3.id, "T6 sole P4-filed, P3-owned task");

    const doneResult = await archiveTask(taskWorkflowService, t6.id);
    expect(doneResult.ok).toBe(true);
    if (!doneResult.ok) return;

    // NOT resolved by unioning the two sets — asserting the field is undefined
    // pins that the disagreement branch does not ALSO masquerade as "fully terminal".
    expect(doneResult.value.plan_now_fully_terminal).toBeUndefined();
    expect(doneResult.value.plan_membership_disagreement).toEqual({
      plan_slug: p4.slug,
      parent_id_only_count: 1,
    });
  });

  // ── ERROR ──────────────────────────────────────────────────────────────

  it("ERROR: a store failure on the corpus-wide task scan propagates as err(...), never silently masquerading as ok(undefined) / no advisory", async () => {
    const { corpusService, taskWorkflowService, store } = makeServices();
    const plan = await createPlan(corpusService, "Store Error Plan");
    const task = await createTask(corpusService, plan.id, plan.id, "Solo Task");

    const originalFindMany = store.findMany.bind(store);
    store.findMany = async (filters) => {
      // reason: only intercept the NEW corpus-wide `type: "task"` membership scan
      // this fix introduces (no `parent_id` key) — every OTHER findMany call
      // (blocker-status lookup, plan/parent lookups) passes through unchanged.
      if (filters.type === "task" && filters.parent_id === undefined) {
        return { ok: false, error: { code: "STORE_ERROR", message: "simulated task-scan failure" } };
      }
      return originalFindMany(filters);
    };

    await taskWorkflowService.addEvidence(task.id, evidence());
    await taskWorkflowService.recordVerifiedEvidence(task.id, attestedPass(), "2026-08-01T09:00:00.000Z");
    const doneResult = await taskWorkflowService.done(task.id, { by: "alice" });
    expect(doneResult.ok).toBe(false);
    if (doneResult.ok) return;
    expect(doneResult.error.code).toBe("STORE_ERROR");
  });

  // ── STATE ──────────────────────────────────────────────────────────────

  it("STATE (AC6, SENTINEL): all real P3 members terminal still fires the advisory — proves the probe can see the advisory at all", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const p3 = await createPlan(corpusService, "P3 Sentinel");
    const t5 = await createTask(corpusService, p3.id, p3.id, "T5");
    const t6 = await createTask(corpusService, p3.id, p3.id, "T6");

    const firstDone = await archiveTask(taskWorkflowService, t5.id);
    expect(firstDone.ok).toBe(true);
    if (firstDone.ok) expect(firstDone.value.plan_now_fully_terminal).toBeUndefined();

    const secondDone = await archiveTask(taskWorkflowService, t6.id);
    expect(secondDone.ok).toBe(true);
    if (!secondDone.ok) return;
    expect(secondDone.value.plan_now_fully_terminal).toEqual({ plan_slug: p3.slug });
  });

  it("STATE (AC6, N1 control): a same-parent sibling still draft keeps the advisory ABSENT (undiverged, unaffected by the fix)", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const plan = await createPlan(corpusService, "N1 Plan");
    const taskA = await createTask(corpusService, plan.id, plan.id, "Task A");
    const taskB = await createTask(corpusService, plan.id, plan.id, "Task B (stays draft)");
    void taskB;

    const doneResult = await archiveTask(taskWorkflowService, taskA.id);
    expect(doneResult.ok).toBe(true);
    if (!doneResult.ok) return;
    expect(doneResult.value.plan_now_fully_terminal).toBeUndefined();
    expect(doneResult.value.plan_membership_disagreement).toBeUndefined();
  });

  it("STATE (AC6, N2 control): an adhoc task (parent is the root PRD, not a plan) keeps the advisory ABSENT", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const rootPrd = await corpusService.create({
      type: "prd",
      title: "Root PRD N2",
      content: "root",
    } as CreateDocInput);
    if (!rootPrd.ok) throw new Error(`Failed to create root PRD: ${JSON.stringify(rootPrd.error)}`);

    const adhocTask = await corpusService.create({
      type: "task",
      title: "Adhoc N2 Task",
      content: "body",
      extra: { adhoc: true },
    } as CreateDocInput);
    if (!adhocTask.ok) throw new Error(`Failed to create adhoc task: ${JSON.stringify(adhocTask.error)}`);

    const doneResult = await archiveTask(taskWorkflowService, adhocTask.value.id);
    expect(doneResult.ok).toBe(true);
    if (!doneResult.ok) return;
    expect(doneResult.value.plan_now_fully_terminal).toBeUndefined();
    expect(doneResult.value.plan_membership_disagreement).toBeUndefined();
  });

  // ── REGRESSION ─────────────────────────────────────────────────────────

  it("REGRESSION (AC7): a plain same-parent plan's ready() result set is unchanged by the extra.plan_id-based rewrite", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const plan = await createPlan(corpusService, "Plain Plan");
    const t1 = await createTask(corpusService, plan.id, plan.id, "T1");
    const t2 = await createTask(corpusService, plan.id, plan.id, "T2");
    const t3 = await createTask(corpusService, plan.id, plan.id, "T3");

    const readyResult = await taskWorkflowService.ready(plan.id);
    expect(readyResult.ok).toBe(true);
    if (!readyResult.ok) return;
    const ids = readyResult.value.records.map((r) => r.task.id);
    expect(new Set(ids)).toEqual(new Set([t1.id, t2.id, t3.id]));
    expect(ids.length).toBe(3);
  });
});
