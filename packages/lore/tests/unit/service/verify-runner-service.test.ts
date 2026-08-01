/**
 * Six-dimension tests for VerifyRunnerService (SPEC-039 §2 D2, D3, D4, D6, D9; §M2
 * trust-hardening: command-provenance approval gate + env-allowlist threading +
 * first_seen annotation).
 *
 * SPEC-069 ad-hoc-task runner path (task-the-ad-hoc-task-channel-has-no-attested-
 * evidence-path-lore) — `verifyAdhocTask`'s own describe blocks live at the END of
 * this file (search "ad-hoc"). Dimension mapping for that addition:
 *   REGRESSION: `verifyPlan` given a non-plan id STILL refuses with the exact
 *               pre-existing leaky message (RED pin, unchanged by this fix) —
 *               documents the defect this task measured before fixing it
 *   HAPPY:      one ad-hoc task + two candidate specs (one matching, one not) →
 *               resolves the governing spec unambiguously, executes, records
 *               GENUINELY attested evidence (real attestation.runner "lore-cli"
 *               / exit_code / duration_ms) — `ac_ref` is intentionally OMITTED
 *               (a NAMED, measured remaining gap; see `recordAcRef`'s JSDoc on
 *               `VerifyRunnerService._runVerification`), never silently faked
 *   NEGATIVE:   not type "task"; not ad-hoc; ac_scope absent; ac_scope empty;
 *               zero matching specs; unknown --ac id against the resolved spec
 *   ERROR:      ac_scope matching MULTIPLE candidate specs — ambiguous, refused,
 *               names every matched spec slug
 *   STATE:      the M2 command-provenance approval gate still applies to the
 *               ad-hoc path (proves real delegation to the shared `_runVerification`
 *               tail, not a re-implementation)
 *   BOUNDARY:   an ad-hoc task's ac_scope matching a spec whose declared criteria
 *               are a STRICT SUPERSET of the scope (the spec also declares AC ids
 *               the task does NOT claim) still resolves — coverage is "spec
 *               declares every scoped id", not "scope equals spec's full set"
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
 * service relies on. `isApprovedVerifyCommand` (§M2) is likewise real — its own
 * unit coverage lives in `packages/core/src/task-workflow.test.ts`; here only the
 * ORCHESTRATION around its result (gate/prompt/allow/reject/annotate) is under test.
 *
 * Dimension mapping:
 *   HAPPY:      two script-mode ACs both pass, distinct commands/exit-codes
 *               recorded individually (defeats a hardcoded-return stub); §M2 —
 *               a brand-new command approved via `allowNewCommands: true` runs and
 *               its evidence carries `attestation.first_seen: true`
 *   NEGATIVE:   undeclared acIds; plan bundle with no parent spec; spec with no
 *               (or empty) acceptance_criteria — executor never called in any case;
 *               §M2 — a brand-new command with `allowNewCommands` unset and no
 *               `confirmUnapprovedCommand` callback is rejected NEEDS_APPROVAL
 *               non-interactively, executor never called
 *   BOUNDARY:   a spec whose declared criteria are ALL ai/human mode is valid
 *               (not an error) — ok() with empty results, full skipped list
 *   ERROR:      executor launch-failure on the 2nd of 3 ACs aborts immediately
 *               (message names both the aborting AC and the one already
 *               recorded); resolveTargetTask ambiguity (0 or >1 fresh claims)
 *               propagates verbatim; §M2 — `confirmUnapprovedCommand` resolving
 *               `false` aborts with NEEDS_APPROVAL naming the AC/command
 *   STATE:      spec.status advisory warning (draft vs approved) never gates
 *               execution; explicitTaskIdOrSlug wins over claim-based resolution;
 *               §M2 — a command ALREADY in the task's evidence history runs WITHOUT
 *               approval (no prompt, no first_seen) even though the gate is
 *               enabled — REGRESSION-critical: don't re-prompt for known commands;
 *               §M2 — the resolved env (via resolveVerifyEnv) is threaded onto every
 *               executor call's spawn spec, computed exactly once per run
 *   REGRESSION: a recordVerifiedEvidence failure (STALE_VERSION-shaped) on the
 *               first AC propagates verbatim and aborts before the second AC's
 *               executor runs — same abort-on-write-failure semantics as
 *               abort-on-launch-failure; §M2 — `requireCommandApproval: false`
 *               disables the gate entirely (a brand-new command runs with zero
 *               prompt/callback and no first_seen annotation)
 *
 * @spec_ref AC-VRF-3; SPEC-039 §M2
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

/**
 * reason: post-`spec-declared-scope-attestation-contract-task-owned-ac-scope`
 * (AC-VS-1/AC-VS-3), a DEFAULT `lore verify` run REFUSES a target task carrying
 * no `extra.ac_scope`. Every case in this file exercises execution/attestation
 * orchestration over the spec's FULL declared set, so the fixture task declares a
 * scope covering every AC id used in this file — the declared-scope intersection
 * then equals each test's declared criteria exactly, preserving the selection
 * these tests were written against. Scope selection itself is covered in
 * `verify-declared-scope.test.ts`, not here.
 * ⛔ Adding a new AC id to a fixture in this file REQUIRES adding it here too:
 * an id missing from this list is out of scope (a scope matching NO criterion
 * refuses loudly; a partially-matching one silently drops the new id).
 */
const FIXTURE_AC_SCOPE = ["AC-1", "AC-2", "AC-3", "AC-AI-1", "AC-HUMAN-1"];

function makeTask(id: string, overrides: Partial<DocRecord> = {}): DocRecord {
  return makeDoc({
    id,
    type: "task",
    title: `Task ${id}`,
    slug: id,
    parent_id: "plan-1",
    ...overrides,
    // The declared scope is merged UNDER any caller-supplied `extra` keys
    // (claim/verification_evidence), and an explicit `ac_scope` override still wins.
    extra: { ac_scope: FIXTURE_AC_SCOPE, ...(overrides.extra ?? {}) },
  });
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

const config = {
  repoRoot: "/repo",
  defaultTimeoutMs: 300000,
  claimTtlMinutes: 120,
  // SPEC-039 §M2 — the gate is OFF for the pre-existing test suite above (it predates
  // the approval gate and every fixture task carries no evidence history, which would
  // make every command "new" under the hardened default and break every existing
  // assertion that expects the executor to run unconditionally). New §M2-specific
  // describe blocks below construct their OWN config with requireCommandApproval: true.
  requireCommandApproval: false,
  envAllowlist: [],
  envPassthroughAll: true,
  processEnv: {},
};
const NOW = "2026-07-08T10:00:00.000Z";
const FRESH_CLAIM_AT = "2026-07-08T09:59:00.000Z"; // 1 minute before NOW — well within the 120min TTL

function taskWithFreshClaim(id: string, by = "alice"): DocRecord {
  return makeTask(id, { extra: { claim: { by, at: FRESH_CLAIM_AT } } });
}

/** SPEC-039 §M2 — a fresh-claimed task whose evidence history already contains `command`. */
function taskWithFreshClaimAndEvidence(id: string, command: string, by = "alice"): DocRecord {
  return makeTask(id, {
    extra: {
      claim: { by, at: FRESH_CLAIM_AT },
      verification_evidence: [
        {
          oracle: "test",
          command,
          result: "pass",
          recorded_at: FRESH_CLAIM_AT,
          recorded_by: by,
        },
      ],
    },
  });
}

/** SPEC-039 §M2 — config with the command-provenance approval gate ENABLED. */
const gatedConfig = { ...config, requireCommandApproval: true, envPassthroughAll: true };

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

// ─── SPEC-039 §M2 — command-provenance approval gate ──────────────────────────

describe("§M2 NEGATIVE — a brand-new command is rejected non-interactively (no flag, no callback)", () => {
  it("err NEEDS_APPROVAL naming the AC id and command; executor and recorder never called", async () => {
    const spec = makeSpec([scriptAc("AC-1", "bun test")]);
    const plan = makePlan();
    const task = taskWithFreshClaim("task-1"); // zero evidence — every command is "new"
    const bundle: PlanBundle = { plan, spec, tasks: [task] };
    const { fn: getPlanBundle } = makeGetPlanBundle(bundle);
    const executor = makeExecutor([]);
    const recorder = makeRecordVerifiedEvidence([]);
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, gatedConfig);

    const result = await service.verifyPlan("plan-1", { by: "runner", nowIso: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NEEDS_APPROVAL");
    if (result.error.code !== "NEEDS_APPROVAL") return;
    expect(result.error.ac_id).toBe("AC-1");
    expect(result.error.command).toBe("bun test");
    expect(executor.callCount).toBe(0);
    expect(recorder.callCount).toBe(0);
  });
});

describe("§M2 HAPPY — allowNewCommands: true approves a brand-new command automatically", () => {
  it("executes the command, records evidence with attestation.first_seen: true, and the top-level result carries first_seen too", async () => {
    const spec = makeSpec([scriptAc("AC-1", "bun test")]);
    const plan = makePlan();
    const task = taskWithFreshClaim("task-1"); // zero evidence
    const bundle: PlanBundle = { plan, spec, tasks: [task] };
    const { fn: getPlanBundle } = makeGetPlanBundle(bundle);
    const executor = makeExecutor([ok({ exitCode: 0, outputTail: "", durationMs: 5, timedOut: false })]);
    const recorder = makeRecordVerifiedEvidence([ok(makeTask("task-1", { version: 2 }))]);
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, gatedConfig);

    const result = await service.verifyPlan("plan-1", {
      by: "runner",
      nowIso: NOW,
      allowNewCommands: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(executor.callCount).toBe(1);
    expect(recorder.callCount).toBe(1);
    expect(recorder.calls[0]?.entry.attestation?.first_seen).toBe(true);
    expect(result.value.results[0]?.first_seen).toBe(true);
  });
});

describe("§M2 REGRESSION — a command already in the task's evidence history runs WITHOUT approval", () => {
  it("no prompt/callback invoked, executor runs immediately, no first_seen annotation", async () => {
    const spec = makeSpec([scriptAc("AC-1", "bun test")]);
    const plan = makePlan();
    const task = taskWithFreshClaimAndEvidence("task-1", "bun test"); // ALREADY seen
    const bundle: PlanBundle = { plan, spec, tasks: [task] };
    const { fn: getPlanBundle } = makeGetPlanBundle(bundle);
    const executor = makeExecutor([ok({ exitCode: 0, outputTail: "", durationMs: 5, timedOut: false })]);
    const recorder = makeRecordVerifiedEvidence([ok(makeTask("task-1", { version: 2 }))]);
    let confirmCallCount = 0;
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, gatedConfig);

    const result = await service.verifyPlan("plan-1", {
      by: "runner",
      nowIso: NOW,
      confirmUnapprovedCommand: async () => {
        confirmCallCount += 1;
        return true;
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(confirmCallCount).toBe(0); // never prompted — the command was already known
    expect(executor.callCount).toBe(1);
    expect(recorder.calls[0]?.entry.attestation?.first_seen).toBeUndefined();
    expect(result.value.results[0]?.first_seen).toBeUndefined();
  });
});

describe("§M2 ERROR — confirmUnapprovedCommand resolving false aborts with NEEDS_APPROVAL", () => {
  it("the callback is invoked with the exact ac_id/command; abort names them; executor never called", async () => {
    const spec = makeSpec([scriptAc("AC-1", "rm -rf /tmp/whatever")]);
    const plan = makePlan();
    const task = taskWithFreshClaim("task-1"); // zero evidence
    const bundle: PlanBundle = { plan, spec, tasks: [task] };
    const { fn: getPlanBundle } = makeGetPlanBundle(bundle);
    const executor = makeExecutor([]);
    const recorder = makeRecordVerifiedEvidence([]);
    const calls: Array<{ ac_id: string; command: string }> = [];
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, gatedConfig);

    const result = await service.verifyPlan("plan-1", {
      by: "runner",
      nowIso: NOW,
      confirmUnapprovedCommand: async (info) => {
        calls.push(info);
        return false;
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NEEDS_APPROVAL");
    if (result.error.code !== "NEEDS_APPROVAL") return;
    expect(calls).toEqual([{ ac_id: "AC-1", command: "rm -rf /tmp/whatever" }]);
    expect(result.error.ac_id).toBe("AC-1");
    expect(result.error.command).toBe("rm -rf /tmp/whatever");
    expect(executor.callCount).toBe(0);
  });

  it("confirmUnapprovedCommand resolving true executes the command and marks first_seen", async () => {
    const spec = makeSpec([scriptAc("AC-1", "bun test")]);
    const plan = makePlan();
    const task = taskWithFreshClaim("task-1");
    const bundle: PlanBundle = { plan, spec, tasks: [task] };
    const { fn: getPlanBundle } = makeGetPlanBundle(bundle);
    const executor = makeExecutor([ok({ exitCode: 0, outputTail: "", durationMs: 5, timedOut: false })]);
    const recorder = makeRecordVerifiedEvidence([ok(makeTask("task-1", { version: 2 }))]);
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, gatedConfig);

    const result = await service.verifyPlan("plan-1", {
      by: "runner",
      nowIso: NOW,
      confirmUnapprovedCommand: async () => true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(executor.callCount).toBe(1);
    expect(recorder.calls[0]?.entry.attestation?.first_seen).toBe(true);
  });
});

describe("§M2 ESCAPE — requireCommandApproval: false disables the gate entirely", () => {
  it("a brand-new command runs with zero prompt/callback and no first_seen annotation", async () => {
    const spec = makeSpec([scriptAc("AC-1", "bun test")]);
    const plan = makePlan();
    const task = taskWithFreshClaim("task-1"); // zero evidence — would be "new" if gate were on
    const bundle: PlanBundle = { plan, spec, tasks: [task] };
    const { fn: getPlanBundle } = makeGetPlanBundle(bundle);
    const executor = makeExecutor([ok({ exitCode: 0, outputTail: "", durationMs: 5, timedOut: false })]);
    const recorder = makeRecordVerifiedEvidence([ok(makeTask("task-1", { version: 2 }))]);
    const ungatedConfig = { ...gatedConfig, requireCommandApproval: false };
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, ungatedConfig);

    const result = await service.verifyPlan("plan-1", { by: "runner", nowIso: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(executor.callCount).toBe(1);
    // reason: first_seen is computed independently of the gate (SPEC-039 §M2
    // annotation is always accurate), so it's still true here even with the gate
    // disabled — the gate being off only means no approval was REQUIRED to run it.
    expect(recorder.calls[0]?.entry.attestation?.first_seen).toBe(true);
  });
});

// ─── SPEC-039 §M2 — env-allowlist threading ────────────────────────────────────

describe("§M2 STATE — resolved env is threaded onto every executor call's spawn spec", () => {
  it("computed once per run via resolveVerifyEnv, applied identically across multiple ACs", async () => {
    const ac1 = scriptAc("AC-1", "cmd-1");
    const ac2 = scriptAc("AC-2", "cmd-2");
    const spec = makeSpec([ac1, ac2]);
    const plan = makePlan();
    const task = taskWithFreshClaimAndEvidence("task-1", "cmd-1"); // cmd-1 known, cmd-2 new
    const bundle: PlanBundle = { plan, spec, tasks: [task] };
    const { fn: getPlanBundle } = makeGetPlanBundle(bundle);
    const executor = makeExecutor([
      ok({ exitCode: 0, outputTail: "", durationMs: 1, timedOut: false }),
      ok({ exitCode: 0, outputTail: "", durationMs: 1, timedOut: false }),
    ]);
    const recorder = makeRecordVerifiedEvidence([
      ok(makeTask("task-1", { version: 2 })),
      ok(makeTask("task-1", { version: 3 })),
    ]);
    const envConfig = {
      ...config,
      requireCommandApproval: true,
      envAllowlist: ["CI_TOKEN"],
      envPassthroughAll: false,
      processEnv: { PATH: "/bin", CI_TOKEN: "abc", LORE_SYNC_TOKEN: "secret" },
    };
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, envConfig);

    const result = await service.verifyPlan("plan-1", { by: "runner", nowIso: NOW, allowNewCommands: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(executor.callCount).toBe(2);
    const expectedEnv = { PATH: "/bin", CI_TOKEN: "abc" };
    expect(executor.calls[0]?.env).toEqual(expectedEnv);
    expect(executor.calls[1]?.env).toEqual(expectedEnv);
    // LORE_SYNC_TOKEN never reaches either spawn spec.
    expect(executor.calls[0]?.env?.["LORE_SYNC_TOKEN"]).toBeUndefined();
  });

  it("passthroughAll: true omits the env key entirely on every spawn spec (full inherit)", async () => {
    const spec = makeSpec([scriptAc("AC-1", "cmd-1")]);
    const plan = makePlan();
    const task = taskWithFreshClaim("task-1");
    const bundle: PlanBundle = { plan, spec, tasks: [task] };
    const { fn: getPlanBundle } = makeGetPlanBundle(bundle);
    const executor = makeExecutor([ok({ exitCode: 0, outputTail: "", durationMs: 1, timedOut: false })]);
    const recorder = makeRecordVerifiedEvidence([ok(makeTask("task-1", { version: 2 }))]);
    const passthroughConfig = {
      ...config,
      requireCommandApproval: false,
      envPassthroughAll: true,
      processEnv: { PATH: "/bin", LORE_SYNC_TOKEN: "secret" },
    };
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, passthroughConfig);

    const result = await service.verifyPlan("plan-1", { by: "runner", nowIso: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(executor.calls[0]?.env).toBeUndefined();
  });
});

// ─── SPEC-069 ad-hoc-task runner path ──────────────────────────────────────────
// task-the-ad-hoc-task-channel-has-no-attested-evidence-path-lore

/** An ad-hoc task (SPEC-069 §Design Decisions D2) — no plan_id, parented to a PRD. */
function makeAdhocTask(id: string, overrides: Partial<DocRecord> = {}): DocRecord {
  return makeDoc({
    id,
    type: "task",
    title: `Ad-hoc Task ${id}`,
    slug: id,
    parent_id: "prd-root",
    ...overrides,
    extra: { adhoc: true, ...(overrides.extra ?? {}) },
  });
}

describe("REGRESSION — verifyPlan given a non-plan id still refuses with the pre-existing leaky message (RED pin)", () => {
  it("propagates getPlanBundle's exact 'Expected a plan document' message verbatim, unchanged by the SPEC-069 fix", async () => {
    // reason: this is what `lore verify <adhoc-task-id>` (passing a non-plan id
    // as the PLAN positional — the ONLY way to reach VerifyRunnerService before
    // this task's fix) actually produced, and STILL produces: `getPlanBundle`
    // structurally cannot resolve an ad-hoc task (or its PRD parent) as a plan.
    // This test measures that the OLD, unsupported invocation shape is
    // deliberately left alone — the NEW supported shape is `verifyAdhocTask`
    // below, reached via a DIFFERENT CLI invocation (no PLAN positional).
    const failingGetPlanBundle = async (
      _planIdOrSlug: string,
    ): Promise<Result<PlanBundle, LoreError>> =>
      err({
        code: "VALIDATION_ERROR",
        field: "type",
        message: "Expected a plan document; got type 'task'",
        value: "task",
      });
    const executor = makeExecutor([]);
    const recorder = makeRecordVerifiedEvidence([]);
    const service = new VerifyRunnerService(failingGetPlanBundle, recorder.fn, executor.fn, config);

    const result = await service.verifyPlan("adhoc-task-1", { by: "runner", nowIso: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.message).toBe("Expected a plan document; got type 'task'");
    expect(executor.callCount).toBe(0);
  });
});

describe("HAPPY — verifyAdhocTask resolves the unique matching spec and attests (AC-VRF-adhoc)", () => {
  it("two candidate specs, only one fully declares the task's ac_scope — executes and records GENUINE attestation (ac_ref intentionally omitted, see recordAcRef JSDoc)", async () => {
    const matchingSpec = makeSpec([scriptAc("AC-1", "cmd-1"), scriptAc("AC-2", "cmd-2")], {
      id: "spec-match",
      slug: "spec-match",
    });
    const otherSpec = makeSpec([scriptAc("AC-OTHER-1", "cmd-x")], { id: "spec-other", slug: "spec-other" });
    const task = makeAdhocTask("adhoc-1", { extra: { adhoc: true, ac_scope: ["AC-1"] } });

    const executor = makeExecutor([ok({ exitCode: 0, outputTail: "out", durationMs: 10, timedOut: false })]);
    const recorder = makeRecordVerifiedEvidence([ok(makeTask("adhoc-1", { version: 2 }))]);
    const { fn: getPlanBundle } = makeGetPlanBundle({ plan: makePlan(), spec: undefined, tasks: [] });
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, config);

    const result = await service.verifyAdhocTask(task, [otherSpec, matchingSpec], {
      by: "runner",
      nowIso: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.task).toEqual({ id: "adhoc-1", slug: "adhoc-1" });
    expect(result.value.results).toHaveLength(1);
    expect(result.value.results[0]).toMatchObject({ ac_id: "AC-1", result: "pass", exit_code: 0 });
    expect(executor.callCount).toBe(1);
    expect(recorder.callCount).toBe(1);
    // reason: MEASURED gap (recordAcRef: false for the ad-hoc path, see
    // _runVerification's JSDoc) — TaskWorkflowService.appendEvidenceEntry's
    // cross-entity ac_ref check requires task.parent_id to resolve to a plan,
    // structurally impossible for an ad-hoc task (its parent is the root PRD).
    // The evidence is still GENUINELY attested — real exit_code/duration/runner —
    // just not (yet) AC-coverage-linkable. Fixing that needs task-workflow-
    // service.ts/corpus-service.ts, outside this task's file anchors.
    expect(recorder.calls[0]?.entry.ac_ref).toBeUndefined();
    expect(recorder.calls[0]?.entry.attestation?.runner).toBe("lore-cli");
    expect(recorder.calls[0]?.entry.attestation?.exit_code).toBe(0);
    expect(recorder.calls[0]?.entry.attestation?.duration_ms).toBe(10);
  });

  it("BOUNDARY — a matching spec whose declared criteria are a strict superset of ac_scope still resolves", async () => {
    // reason: coverage is "spec declares every scoped id", never "scope equals
    // the spec's full declared set" — a spec that ALSO declares unrelated ACs
    // the ad-hoc task does not claim is still a valid, unambiguous match.
    const spec = makeSpec([scriptAc("AC-1", "cmd-1"), scriptAc("AC-UNRELATED", "cmd-y")], {
      id: "spec-super",
      slug: "spec-super",
    });
    const task = makeAdhocTask("adhoc-2", { extra: { adhoc: true, ac_scope: ["AC-1"] } });
    const executor = makeExecutor([ok({ exitCode: 0, outputTail: "", durationMs: 1, timedOut: false })]);
    const recorder = makeRecordVerifiedEvidence([ok(makeTask("adhoc-2", { version: 2 }))]);
    const { fn: getPlanBundle } = makeGetPlanBundle({ plan: makePlan(), spec: undefined, tasks: [] });
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, config);

    const result = await service.verifyAdhocTask(task, [spec], { by: "runner", nowIso: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.results).toHaveLength(1);
    expect(result.value.results[0]?.ac_id).toBe("AC-1");
  });

  it("STATE — the M2 command-provenance approval gate still applies (proves real delegation to the shared execution tail)", async () => {
    const spec = makeSpec([scriptAc("AC-1", "cmd-1")], { id: "spec-gated", slug: "spec-gated" });
    const task = makeAdhocTask("adhoc-3", { extra: { adhoc: true, ac_scope: ["AC-1"] } });
    const executor = makeExecutor([]);
    const recorder = makeRecordVerifiedEvidence([]);
    const { fn: getPlanBundle } = makeGetPlanBundle({ plan: makePlan(), spec: undefined, tasks: [] });
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, gatedConfig);

    const result = await service.verifyAdhocTask(task, [spec], { by: "runner", nowIso: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NEEDS_APPROVAL");
    expect(executor.callCount).toBe(0);
  });
});

describe("NEGATIVE — verifyAdhocTask refuses structurally-invalid inputs before any execution", () => {
  const { fn: getPlanBundle } = makeGetPlanBundle({ plan: makePlan(), spec: undefined, tasks: [] });

  it("target is not type 'task' — VALIDATION_ERROR field 'type'", async () => {
    const executor = makeExecutor([]);
    const recorder = makeRecordVerifiedEvidence([]);
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, config);
    const notATask = makeDoc({ id: "spec-1", type: "spec", title: "Spec", slug: "spec-1" });

    const result = await service.verifyAdhocTask(notATask, [], { by: "runner", nowIso: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("type");
    expect(executor.callCount).toBe(0);
  });

  it("task is not ad-hoc (extra.adhoc !== true) — VALIDATION_ERROR field 'adhoc'", async () => {
    const executor = makeExecutor([]);
    const recorder = makeRecordVerifiedEvidence([]);
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, config);
    const planOwnedTask = makeTask("task-1"); // extra.ac_scope set, but extra.adhoc absent

    const result = await service.verifyAdhocTask(planOwnedTask, [], { by: "runner", nowIso: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("adhoc");
    expect(result.error.message).toContain("not ad-hoc");
    expect(executor.callCount).toBe(0);
  });

  it("ac_scope absent — VALIDATION_ERROR field 'ac_scope', names lore scope add", async () => {
    const executor = makeExecutor([]);
    const recorder = makeRecordVerifiedEvidence([]);
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, config);
    const task = makeAdhocTask("adhoc-4"); // no ac_scope key at all

    const result = await service.verifyAdhocTask(task, [], { by: "runner", nowIso: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("ac_scope");
    expect(result.error.message).toContain("no declared ac_scope");
    expect(result.error.message).toContain("lore scope add");
    expect(executor.callCount).toBe(0);
  });

  it("ac_scope empty array — VALIDATION_ERROR field 'ac_scope', EMPTY_SCOPE_LITERAL", async () => {
    const executor = makeExecutor([]);
    const recorder = makeRecordVerifiedEvidence([]);
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, config);
    const task = makeAdhocTask("adhoc-5", { extra: { adhoc: true, ac_scope: [] } });

    const result = await service.verifyAdhocTask(task, [], { by: "runner", nowIso: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("ac_scope");
    expect(result.error.message).toContain("declares no acceptance criterion");
    expect(executor.callCount).toBe(0);
  });

  it("zero candidate specs declare the scope in full — VALIDATION_ERROR field 'ac_scope', 'matches no'", async () => {
    const executor = makeExecutor([]);
    const recorder = makeRecordVerifiedEvidence([]);
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, config);
    const task = makeAdhocTask("adhoc-6", { extra: { adhoc: true, ac_scope: ["AC-NOWHERE"] } });
    const unrelatedSpec = makeSpec([scriptAc("AC-1", "cmd-1")], { id: "spec-1", slug: "spec-1" });

    const result = await service.verifyAdhocTask(task, [unrelatedSpec], { by: "runner", nowIso: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("ac_scope");
    expect(result.error.message).toContain("matches no");
    expect(executor.callCount).toBe(0);
  });

  it("unknown --ac id against the resolved spec — VALIDATION_ERROR field 'acIds'", async () => {
    const executor = makeExecutor([]);
    const recorder = makeRecordVerifiedEvidence([]);
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, config);
    const spec = makeSpec([scriptAc("AC-1", "cmd-1")], { id: "spec-1", slug: "spec-1" });
    const task = makeAdhocTask("adhoc-7", { extra: { adhoc: true, ac_scope: ["AC-1"] } });

    const result = await service.verifyAdhocTask(task, [spec], {
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

describe("ERROR — ac_scope matching MULTIPLE candidate specs is ambiguous and refused", () => {
  it("VALIDATION_ERROR field 'ac_scope', message names every matched spec slug, never guesses", async () => {
    const { fn: getPlanBundle } = makeGetPlanBundle({ plan: makePlan(), spec: undefined, tasks: [] });
    const executor = makeExecutor([]);
    const recorder = makeRecordVerifiedEvidence([]);
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, config);

    // reason: AC-* ids are unique only WITHIN one spec's declared criteria
    // (never enforced globally) — two independent specs each declaring an
    // "AC-SHARED-1" is a legitimate corpus state this method must handle by
    // refusing, never by picking one arbitrarily.
    const specA = makeSpec([scriptAc("AC-SHARED-1", "cmd-a")], { id: "spec-a", slug: "spec-a" });
    const specB = makeSpec([scriptAc("AC-SHARED-1", "cmd-b")], { id: "spec-b", slug: "spec-b" });
    const task = makeAdhocTask("adhoc-8", { extra: { adhoc: true, ac_scope: ["AC-SHARED-1"] } });

    const result = await service.verifyAdhocTask(task, [specA, specB], { by: "runner", nowIso: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("ac_scope");
    expect(result.error.message).toContain("ambiguous");
    expect(result.error.message).toContain("spec-a");
    expect(result.error.message).toContain("spec-b");
    expect(executor.callCount).toBe(0);
  });
});
