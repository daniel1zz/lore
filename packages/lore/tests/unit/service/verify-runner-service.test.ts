/**
 * Six-dimension tests for VerifyRunnerService (SPEC-039 §2 D2, D3, D4, D6, D9).
 *
 * This is orchestration logic over three injected ports (`getPlanBundle`,
 * `recordVerifiedEvidence`, `executor`) — tested entirely with HAND-WRITTEN test
 * doubles for all three, mirroring `task-workflow-service.test.ts`'s
 * `makeServicesWithAcPort` rationale: the PORT'S CONTRACT (what this orchestrator
 * does with each port's Result) is under test here, not a callee's own logic (a
 * real store/CorpusService/TaskWorkflowService fixture chain would re-test THEIR
 * logic, not this file's). `resolveTargetTask` is the one exception — it's a REAL
 * pure function imported from `@lore/core`, not a double, since it's cheap to
 * exercise directly and doing so proves the actual claim/staleness contract this
 * service relies on.
 *
 * Dimension mapping:
 *   HAPPY:      two script-mode ACs both pass, distinct commands/exit-codes
 *               recorded individually (defeats a hardcoded-return stub)
 *   NEGATIVE:   undeclared acIds; plan bundle with no parent spec; spec with no
 *               (or empty) acceptance_criteria — executor never called in any case
 *   BOUNDARY:   a spec whose declared criteria are ALL ai/human mode is valid
 *               (not an error) — ok() with empty results, full skipped list
 *   ERROR:      executor launch-failure on the 2nd of 3 ACs aborts immediately
 *               (message names both the aborting AC and the one already
 *               recorded); resolveTargetTask ambiguity (0 or >1 fresh claims)
 *               propagates verbatim
 *   STATE:      spec.status advisory warning (draft vs approved) never gates
 *               execution; explicitTaskIdOrSlug wins over claim-based resolution
 *   REGRESSION: a recordVerifiedEvidence failure (STALE_VERSION-shaped) on the
 *               first AC propagates verbatim and aborts before the second AC's
 *               executor runs — same abort-on-write-failure semantics as
 *               abort-on-launch-failure
 *
 * @spec_ref AC-VRF-3
 */

import { describe, it, expect } from "vitest";
import { ok, err } from "@lore/core";
import type { AcceptanceCriterion, DocRecord, LoreError, PlanBundle, Result } from "@lore/core";
import { VerifyRunnerService } from "../../../src/service/verify-runner-service.js";
import type { VerifySpawnSpec, VerifyExecutionResult } from "../../../src/service/verify-spawn.js";
import type { VerifiedEvidenceInput } from "../../../src/service/task-workflow-service.js";

// ─── Fixture builders ─────────────────────────────────────────────────────────

function makeDoc(overrides: Partial<DocRecord> & Pick<DocRecord, "id" | "type" | "title">): DocRecord {
  return {
    slug: overrides.id,
    role: "plan",
    status: "approved",
    priority: "medium",
    content: "body",
    parent_id: null,
    created_at: "2026-07-08T00:00:00.000Z",
    updated_at: "2026-07-08T00:00:00.000Z",
    created_by: "alice",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
    ...overrides,
  } as DocRecord;
}

function makePlan(overrides: Partial<DocRecord> = {}): DocRecord {
  return makeDoc({ id: "plan-1", type: "plan", title: "Plan", ...overrides });
}

function makeSpec(acceptanceCriteria: AcceptanceCriterion[], overrides: Partial<DocRecord> = {}): DocRecord {
  return makeDoc({
    id: "spec-1",
    type: "spec",
    title: "Spec",
    status: "approved",
    extra: { acceptance_criteria: acceptanceCriteria },
    ...overrides,
  });
}

function makeTask(id: string, overrides: Partial<DocRecord> = {}): DocRecord {
  return makeDoc({ id, type: "task", title: `Task ${id}`, slug: id, parent_id: "plan-1", ...overrides });
}

function scriptAc(id: string, command = "run"): AcceptanceCriterion {
  return {
    id,
    statement: `${id} statement`,
    verify: { mode: "script", oracle: "test", command },
  };
}

function aiAc(id: string): AcceptanceCriterion {
  return { id, statement: `${id} statement`, verify: { mode: "ai", rubric: "rubric" } };
}

function humanAc(id: string): AcceptanceCriterion {
  return { id, statement: `${id} statement`, verify: { mode: "human" } };
}

// ─── Port doubles ─────────────────────────────────────────────────────────────

function makeGetPlanBundle(bundle: PlanBundle) {
  const calls: string[] = [];
  const fn = async (planIdOrSlug: string): Promise<Result<PlanBundle, LoreError>> => {
    calls.push(planIdOrSlug);
    return ok(bundle);
  };
  return { fn, calls };
}

function makeExecutor(results: Array<Result<VerifyExecutionResult, LoreError>>) {
  const calls: VerifySpawnSpec[] = [];
  const fn = async (spec: VerifySpawnSpec): Promise<Result<VerifyExecutionResult, LoreError>> => {
    calls.push(spec);
    const r = results[calls.length - 1];
    if (r === undefined) throw new Error("executor double called more times than scripted");
    return r;
  };
  return {
    fn,
    calls,
    get callCount(): number {
      return calls.length;
    },
  };
}

function makeRecordVerifiedEvidence(results: Array<Result<DocRecord, LoreError>>) {
  const calls: Array<{ idOrSlug: string; entry: VerifiedEvidenceInput; nowIso: string }> = [];
  const fn = async (
    idOrSlug: string,
    entry: VerifiedEvidenceInput,
    nowIso: string,
  ): Promise<Result<DocRecord, LoreError>> => {
    calls.push({ idOrSlug, entry, nowIso });
    const r = results[calls.length - 1];
    if (r === undefined) throw new Error("recordVerifiedEvidence double called more times than scripted");
    return r;
  };
  return {
    fn,
    calls,
    get callCount(): number {
      return calls.length;
    },
  };
}

const config = { repoRoot: "/repo", defaultTimeoutMs: 300000, claimTtlMinutes: 120 };
const NOW = "2026-07-08T10:00:00.000Z";
const FRESH_CLAIM_AT = "2026-07-08T09:59:00.000Z"; // 1 minute before NOW — well within the 120min TTL

function taskWithFreshClaim(id: string, by = "alice"): DocRecord {
  return makeTask(id, { extra: { claim: { by, at: FRESH_CLAIM_AT } } });
}

// ─── HAPPY ────────────────────────────────────────────────────────────────────

describe("HAPPY — two script-mode ACs both pass, recorded distinctly (AC-VRF-3)", () => {
  it("executes both ACs in order and records each with its OWN command/exit-code/duration (defeats a hardcoded-return stub)", async () => {
    const ac1 = scriptAc("AC-1", "cmd-1");
    const ac2 = scriptAc("AC-2", "cmd-2");
    const spec = makeSpec([ac1, ac2]);
    const plan = makePlan();
    const task = taskWithFreshClaim("task-1");
    const bundle: PlanBundle = { plan, spec, tasks: [task] };

    const { fn: getPlanBundle } = makeGetPlanBundle(bundle);
    const executor = makeExecutor([
      ok({ exitCode: 0, outputTail: "out1", durationMs: 111, timedOut: false }),
      ok({ exitCode: 0, outputTail: "out2", durationMs: 222, timedOut: false }),
    ]);
    const recorder = makeRecordVerifiedEvidence([
      ok(makeTask("task-1", { version: 2 })),
      ok(makeTask("task-1", { version: 3 })),
    ]);

    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, config);
    const result = await service.verifyPlan("plan-1", { by: "runner", nowIso: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.results).toHaveLength(2);
    expect(result.value.results[0]).toMatchObject({
      ac_id: "AC-1",
      result: "pass",
      exit_code: 0,
      duration_ms: 111,
      timed_out: false,
    });
    expect(result.value.results[1]).toMatchObject({
      ac_id: "AC-2",
      result: "pass",
      exit_code: 0,
      duration_ms: 222,
      timed_out: false,
    });
    expect(result.value.skipped).toEqual([]);
    expect(result.value.task).toEqual({ id: "task-1", slug: "task-1" });

    expect(executor.callCount).toBe(2);
    expect(executor.calls[0]?.cmd).toEqual(["sh", "-c", "cmd-1"]);
    expect(executor.calls[1]?.cmd).toEqual(["sh", "-c", "cmd-2"]);

    expect(recorder.callCount).toBe(2);
    expect(recorder.calls[0]?.entry.ac_ref).toBe("AC-1");
    expect(recorder.calls[0]?.entry.attestation).toMatchObject({
      exit_code: 0,
      duration_ms: 111,
      timed_out: false,
    });
    expect(recorder.calls[1]?.entry.ac_ref).toBe("AC-2");
    expect(recorder.calls[1]?.entry.attestation).toMatchObject({
      exit_code: 0,
      duration_ms: 222,
      timed_out: false,
    });
  });
});

// ─── NEGATIVE ─────────────────────────────────────────────────────────────────

describe("NEGATIVE — acIds naming an undeclared AC id rejects before any execution", () => {
  it("err VALIDATION_ERROR field acIds, executor never called", async () => {
    const spec = makeSpec([scriptAc("AC-1")]);
    const plan = makePlan();
    const bundle: PlanBundle = { plan, spec, tasks: [] };
    const { fn: getPlanBundle } = makeGetPlanBundle(bundle);
    const executor = makeExecutor([]);
    const recorder = makeRecordVerifiedEvidence([]);
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, config);

    const result = await service.verifyPlan("plan-1", {
      by: "runner",
      nowIso: NOW,
      acIds: ["AC-DOES-NOT-EXIST"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("acIds");
    expect(executor.callCount).toBe(0);
  });
});

describe("NEGATIVE — plan bundle with no parent spec rejects immediately", () => {
  it("err VALIDATION_ERROR field spec, executor never called", async () => {
    const plan = makePlan();
    const bundle: PlanBundle = { plan, tasks: [] };
    const { fn: getPlanBundle } = makeGetPlanBundle(bundle);
    const executor = makeExecutor([]);
    const recorder = makeRecordVerifiedEvidence([]);
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, config);

    const result = await service.verifyPlan("plan-1", { by: "runner", nowIso: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("spec");
    expect(executor.callCount).toBe(0);
  });
});

describe("NEGATIVE — spec with no declared acceptance_criteria (absent or empty) rejects", () => {
  it("absent acceptance_criteria field -> VALIDATION_ERROR field acceptance_criteria", async () => {
    const spec = makeDoc({ id: "spec-1", type: "spec", title: "Spec", status: "approved", extra: {} });
    const plan = makePlan();
    const bundle: PlanBundle = { plan, spec, tasks: [] };
    const { fn: getPlanBundle } = makeGetPlanBundle(bundle);
    const executor = makeExecutor([]);
    const recorder = makeRecordVerifiedEvidence([]);
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, config);

    const result = await service.verifyPlan("plan-1", { by: "runner", nowIso: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("acceptance_criteria");
    expect(executor.callCount).toBe(0);
  });

  it("an explicitly empty acceptance_criteria array also rejects", async () => {
    const spec = makeSpec([]);
    const plan = makePlan();
    const bundle: PlanBundle = { plan, spec, tasks: [] };
    const { fn: getPlanBundle } = makeGetPlanBundle(bundle);
    const executor = makeExecutor([]);
    const recorder = makeRecordVerifiedEvidence([]);
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, config);

    const result = await service.verifyPlan("plan-1", { by: "runner", nowIso: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("acceptance_criteria");
  });
});

// ─── BOUNDARY ─────────────────────────────────────────────────────────────────

describe("BOUNDARY — all declared criteria are ai/human mode: valid, not an error", () => {
  it("results is empty, skipped lists every AC with its mode, executor never called", async () => {
    const spec = makeSpec([aiAc("AC-AI-1"), humanAc("AC-HUMAN-1")]);
    const plan = makePlan();
    const task = taskWithFreshClaim("task-1");
    const bundle: PlanBundle = { plan, spec, tasks: [task] };
    const { fn: getPlanBundle } = makeGetPlanBundle(bundle);
    const executor = makeExecutor([]);
    const recorder = makeRecordVerifiedEvidence([]);
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, config);

    const result = await service.verifyPlan("plan-1", { by: "runner", nowIso: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.results).toEqual([]);
    expect(result.value.skipped).toEqual([
      { ac_id: "AC-AI-1", mode: "ai" },
      { ac_id: "AC-HUMAN-1", mode: "human" },
    ]);
    expect(executor.callCount).toBe(0);
  });
});

// ─── ERROR ────────────────────────────────────────────────────────────────────

describe("ERROR — executor launch failure on the 2nd of 3 ACs aborts the whole run", () => {
  it("message names the aborting AC id and the one AC already recorded; recorder called once; the 3rd AC's executor never runs", async () => {
    const ac1 = scriptAc("AC-1", "cmd-1");
    const ac2 = scriptAc("AC-2", "cmd-2");
    const ac3 = scriptAc("AC-3", "cmd-3");
    const spec = makeSpec([ac1, ac2, ac3]);
    const plan = makePlan();
    const task = taskWithFreshClaim("task-1");
    const bundle: PlanBundle = { plan, spec, tasks: [task] };
    const { fn: getPlanBundle } = makeGetPlanBundle(bundle);
    const executor = makeExecutor([
      ok({ exitCode: 0, outputTail: "", durationMs: 10, timedOut: false }),
      err({ code: "STORE_ERROR", message: "ENOENT: binary missing" }),
    ]);
    const recorder = makeRecordVerifiedEvidence([ok(makeTask("task-1", { version: 2 }))]);
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, config);

    const result = await service.verifyPlan("plan-1", { by: "runner", nowIso: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("STORE_ERROR");
    if (result.error.code !== "STORE_ERROR") return;
    expect(result.error.message).toContain("AC-2");
    expect(result.error.message).toContain("AC-1");

    expect(recorder.callCount).toBe(1); // only the first (successful) AC was recorded
    expect(executor.callCount).toBe(2); // NOT 3 — proves immediate abort, not "skip and continue"
  });
});

describe("ERROR — resolveTargetTask ambiguity (real core function) propagates verbatim", () => {
  it("two tasks both holding a fresh claim -> VALIDATION_ERROR, executor never called", async () => {
    const spec = makeSpec([scriptAc("AC-1")]);
    const plan = makePlan();
    const taskA = taskWithFreshClaim("task-a", "alice");
    const taskB = taskWithFreshClaim("task-b", "bob");
    const bundle: PlanBundle = { plan, spec, tasks: [taskA, taskB] };
    const { fn: getPlanBundle } = makeGetPlanBundle(bundle);
    const executor = makeExecutor([]);
    const recorder = makeRecordVerifiedEvidence([]);
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, config);

    const result = await service.verifyPlan("plan-1", { by: "runner", nowIso: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("task");
    expect(executor.callCount).toBe(0);
  });

  it("zero tasks with a fresh claim -> VALIDATION_ERROR, executor never called", async () => {
    const spec = makeSpec([scriptAc("AC-1")]);
    const plan = makePlan();
    const task = makeTask("task-a"); // no claim at all
    const bundle: PlanBundle = { plan, spec, tasks: [task] };
    const { fn: getPlanBundle } = makeGetPlanBundle(bundle);
    const executor = makeExecutor([]);
    const recorder = makeRecordVerifiedEvidence([]);
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, config);

    const result = await service.verifyPlan("plan-1", { by: "runner", nowIso: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("task");
    expect(executor.callCount).toBe(0);
  });
});

// ─── STATE ────────────────────────────────────────────────────────────────────

describe("STATE — spec.status advisory warning never gates execution", () => {
  it("draft spec status produces exactly one warning mentioning the status, but the AC still runs", async () => {
    const spec = makeSpec([scriptAc("AC-1")], { status: "draft" });
    const plan = makePlan();
    const task = taskWithFreshClaim("task-1");
    const bundle: PlanBundle = { plan, spec, tasks: [task] };
    const { fn: getPlanBundle } = makeGetPlanBundle(bundle);
    const executor = makeExecutor([ok({ exitCode: 0, outputTail: "", durationMs: 1, timedOut: false })]);
    const recorder = makeRecordVerifiedEvidence([ok(makeTask("task-1", { version: 2 }))]);
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, config);

    const result = await service.verifyPlan("plan-1", { by: "runner", nowIso: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.warnings).toHaveLength(1);
    expect(result.value.warnings[0]).toContain("draft");
    expect(result.value.results).toHaveLength(1); // AC still ran despite the draft status — advisory only
  });

  it("approved spec status produces zero warnings", async () => {
    const spec = makeSpec([scriptAc("AC-1")], { status: "approved" });
    const plan = makePlan();
    const task = taskWithFreshClaim("task-1");
    const bundle: PlanBundle = { plan, spec, tasks: [task] };
    const { fn: getPlanBundle } = makeGetPlanBundle(bundle);
    const executor = makeExecutor([ok({ exitCode: 0, outputTail: "", durationMs: 1, timedOut: false })]);
    const recorder = makeRecordVerifiedEvidence([ok(makeTask("task-1", { version: 2 }))]);
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, config);

    const result = await service.verifyPlan("plan-1", { by: "runner", nowIso: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.warnings).toEqual([]);
  });
});

describe("STATE — explicitTaskIdOrSlug wins over claim-based resolution", () => {
  it("an explicit task override is selected even when a DIFFERENT task holds the sole fresh claim", async () => {
    const spec = makeSpec([scriptAc("AC-1")]);
    const plan = makePlan();
    const claimedTask = taskWithFreshClaim("task-claimed", "alice");
    const explicitTask = makeTask("task-explicit"); // no claim at all
    const bundle: PlanBundle = { plan, spec, tasks: [claimedTask, explicitTask] };
    const { fn: getPlanBundle } = makeGetPlanBundle(bundle);
    const executor = makeExecutor([ok({ exitCode: 0, outputTail: "", durationMs: 1, timedOut: false })]);
    const recorder = makeRecordVerifiedEvidence([ok(makeTask("task-explicit", { version: 2 }))]);
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, config);

    const result = await service.verifyPlan("plan-1", {
      by: "runner",
      nowIso: NOW,
      explicitTaskIdOrSlug: "task-explicit",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.task).toEqual({ id: "task-explicit", slug: "task-explicit" });
    expect(recorder.calls[0]?.idOrSlug).toBe("task-explicit");
  });
});

// ─── REGRESSION ───────────────────────────────────────────────────────────────

describe("REGRESSION — a recordVerifiedEvidence failure aborts the run and propagates verbatim", () => {
  it("STALE_VERSION-shaped error on the first AC's evidence write propagates as-is; the second AC's executor never runs", async () => {
    const ac1 = scriptAc("AC-1", "cmd-1");
    const ac2 = scriptAc("AC-2", "cmd-2");
    const spec = makeSpec([ac1, ac2]);
    const plan = makePlan();
    const task = taskWithFreshClaim("task-1");
    const bundle: PlanBundle = { plan, spec, tasks: [task] };
    const { fn: getPlanBundle } = makeGetPlanBundle(bundle);
    const executor = makeExecutor([
      ok({ exitCode: 0, outputTail: "", durationMs: 1, timedOut: false }),
      ok({ exitCode: 0, outputTail: "", durationMs: 1, timedOut: false }),
    ]);
    const staleError: LoreError = { code: "STALE_VERSION", id: "task-1", expected: 1, actual: 2 };
    const recorder = makeRecordVerifiedEvidence([err(staleError)]);
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, config);

    const result = await service.verifyPlan("plan-1", { by: "runner", nowIso: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual(staleError);

    expect(executor.callCount).toBe(1); // the second AC's executor never runs — abort is immediate
    expect(recorder.callCount).toBe(1);
  });
});
