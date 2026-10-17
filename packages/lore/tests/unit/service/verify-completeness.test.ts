// @layer service-verify-completeness AC-TG-6
/**
 * Six-dimension tests for the SPEC-061 attestation-completeness guard's
 * integration into `VerifyRunnerService` (D3) and its runner-issued-only
 * enforcement on the public `TaskWorkflowService.addEvidence` path (D2/D6).
 *
 * `VerifyRunnerService` cases use the SAME hand-written port-double pattern as
 * `verify-runner-service.test.ts` (this file's sibling) — the guard itself
 * (`countExplicitPathArgs`/`parseExecutedUnits`/`judgeCompleteness`) is real,
 * imported from `@lore/core`, unit-covered on its own in
 * `packages/core/tests/attestation-completeness.test.ts`; only the
 * ORCHESTRATION around its verdict (result downgrade, attestation fields) is
 * under test here. The caller-supplied-inconclusive case uses a REAL
 * `TaskWorkflowService` over `InMemoryStore` (mirrors
 * `task-workflow-service.test.ts`'s SPEC-039 §2 D2 attestation-smuggling
 * precedent) since that guard lives in `_addEvidenceImpl` itself.
 *
 * Dimension mapping:
 *   HAPPY / REPRO (AC-061-4): the exact AC-060-7 shape — a command declaring 3
 *               test-file paths, only 1 of which the runner actually matched
 *               (vitest silently ignored the other two) — records
 *               `result: "inconclusive"`, NEVER `"pass"`, with
 *               `attestation.completeness: "under_match"`
 *   NEGATIVE:   a zero-match run (runner summary reports 0 executed files
 *               despite >=1 declared path) also downgrades to `"inconclusive"`
 *               with `completeness: "zero_match"`
 *   BOUNDARY:   a command declaring ZERO explicit paths (`bun run test`) is
 *               NEVER downgraded even when the runner's summary line can't be
 *               parsed — declaredPaths === 0 is vacuously "complete"
 *   ERROR:      n/a at the orchestration level — the guard is a pure decision
 *               over already-successful (exit 0) executor output, no new
 *               throw/error surface; the runner-issued-only rejection (D2) IS
 *               the "error" dimension for the addEvidence half of this file
 *   STATE:      a non-"test" oracle (e.g. tsc) exiting 0 NEVER runs the guard
 *               at all — no `completeness` field appears on its attestation,
 *               regardless of its command/output shape
 *   REGRESSION (AC-061-5): declared-count === executed-count records `"pass"`
 *               with `completeness: "complete"`; an unrecognised runner
 *               records `"pass"` with `completeness: "unknown_runner"` and no
 *               `executed_files`; NEITHER is downgraded to `"inconclusive"`.
 *               Plus: a caller attempting `result: "inconclusive"` through the
 *               public `addEvidence` path (even via an `as EvidenceInput` cast
 *               bypassing the compile-time exclusion) is rejected
 *               VALIDATION_ERROR — mirrors the pre-existing `attestation`
 *               smuggling guard exactly (AC-061-6).
 *
 * @spec_ref SPEC-061 §Scope D2, D3, D5; §Acceptance Criteria AC-061-4, AC-061-5, AC-061-6
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { ok, err } from "@lore/core";
import type { AcceptanceCriterion, DocRecord, LoreError, PlanBundle, Result } from "@lore/core";
import { VerifyRunnerService } from "../../../src/service/verify-runner-service.js";
import type { VerifySpawnSpec, VerifyExecutionResult } from "../../../src/service/verify-spawn.js";
import type { VerifiedEvidenceInput } from "../../../src/service/task-workflow-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { TaskWorkflowService, type EvidenceInput } from "../../../src/service/task-workflow-service.js";
import { exitCode } from "../../../src/adapters/cli/utils.js";
import type { CreateDocInput } from "@lore/core";

// ─── VerifyRunnerService fixture builders (mirrors verify-runner-service.test.ts) ──

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
 * no `extra.ac_scope`. This file's cases are about the completeness guard, not
 * scope selection (that is `verify-declared-scope.test.ts`), so the fixture task
 * declares a scope covering every AC id used here — the intersection then equals
 * each test's declared criteria exactly.
 * ⛔ Adding a new AC id to a fixture in this file REQUIRES adding it here too.
 */
const FIXTURE_AC_SCOPE = ["AC-1", "AC-060-7"];

function makeTask(id: string, overrides: Partial<DocRecord> = {}): DocRecord {
  return makeDoc({
    id,
    type: "task",
    title: `Task ${id}`,
    slug: id,
    parent_id: "plan-1",
    ...overrides,
    // Merged UNDER any caller-supplied `extra` keys; an explicit override wins.
    extra: { ac_scope: FIXTURE_AC_SCOPE, ...(overrides.extra ?? {}) },
  });
}

function testAc(id: string, command: string): AcceptanceCriterion {
  return { id, statement: `${id} statement`, verify: { mode: "script", oracle: "test", command } };
}

function tscAc(id: string, command: string): AcceptanceCriterion {
  return { id, statement: `${id} statement`, verify: { mode: "script", oracle: "tsc", command } };
}

function makeGetPlanBundle(bundle: PlanBundle) {
  const fn = async (_planIdOrSlug: string): Promise<Result<PlanBundle, LoreError>> => ok(bundle);
  return { fn };
}

function makeExecutor(results: Array<Result<VerifyExecutionResult, LoreError>>) {
  const calls: VerifySpawnSpec[] = [];
  const fn = async (spec: VerifySpawnSpec): Promise<Result<VerifyExecutionResult, LoreError>> => {
    calls.push(spec);
    const r = results[calls.length - 1];
    if (r === undefined) throw new Error("executor double called more times than scripted");
    return r;
  };
  return { fn, calls };
}

function makeRecordVerifiedEvidence() {
  const calls: Array<{ idOrSlug: string; entry: VerifiedEvidenceInput; nowIso: string }> = [];
  const fn = async (
    idOrSlug: string,
    entry: VerifiedEvidenceInput,
    nowIso: string,
  ): Promise<Result<DocRecord, LoreError>> => {
    calls.push({ idOrSlug, entry, nowIso });
    return ok(makeTask("task-1", { version: calls.length + 1 }));
  };
  return { fn, calls };
}

const config = {
  repoRoot: "/repo",
  defaultTimeoutMs: 300000,
  claimTtlMinutes: 120,
  requireCommandApproval: false,
  envAllowlist: [],
  envPassthroughAll: true,
  processEnv: {},
};
/** Every declared path exists: this file tests the completeness guard, not the AC-TG-6 missing-file branch. */
const filesExist = (): boolean => true;
const NOW = "2026-07-21T10:00:00.000Z";
const FRESH_CLAIM_AT = "2026-07-21T09:59:00.000Z";

function taskWithFreshClaim(id: string, by = "alice"): DocRecord {
  return makeTask(id, { extra: { claim: { by, at: FRESH_CLAIM_AT } } });
}

// The literal AC-060-7 three-path command (2 of 3 paths never existed).
const AC_060_7_COMMAND =
  "bun run test:vitest packages/lore/tests/unit/setup-service.test.ts " +
  "packages/lore/tests/unit/assets-ssot.test.ts " +
  "packages/lore/tests/unit/real-setup-ports.test.ts";

// ─── REPRO (AC-061-4) ─────────────────────────────────────────────────────────

describe("REPRO — the exact AC-060-7 three-path-two-missing shape records inconclusive, never pass", () => {
  it("exit 0 + a vitest tail reporting only 1 of 3 declared files ran -> result inconclusive, completeness under_match", async () => {
    const spec = makeSpec([testAc("AC-060-7", AC_060_7_COMMAND)]);
    const plan = makePlan();
    const task = taskWithFreshClaim("task-1");
    const bundle: PlanBundle = { plan, spec, tasks: [task] };
    const { fn: getPlanBundle } = makeGetPlanBundle(bundle);
    // The false-attestation incident: vitest silently ran only the one matching
    // file (assets-ssot.test.ts) and exited 0.
    const executor = makeExecutor([
      ok({ exitCode: 0, outputTail: "...\nTest Files  1 passed (1)\n", durationMs: 639, timedOut: false }),
    ]);
    const recorder = makeRecordVerifiedEvidence();
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, config, undefined, filesExist);

    const result = await service.verifyPlan("plan-1", { by: "runner", nowIso: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.results).toHaveLength(1);
    expect(result.value.results[0]).toMatchObject({
      ac_id: "AC-060-7",
      result: "inconclusive",
      exit_code: 0,
      completeness: "under_match",
      executed_files: 1,
      declared_paths: 3,
    });

    // The evidence actually recorded (what a caller would see via `lore ac list`)
    // must carry "inconclusive", NEVER "pass" — this is the whole point of the guard.
    expect(recorder.calls).toHaveLength(1);
    expect(recorder.calls[0]?.entry.result).toBe("inconclusive");
    expect(recorder.calls[0]?.entry.attestation).toMatchObject({
      exit_code: 0,
      completeness: "under_match",
      executed_files: 1,
    });
  });
});

// ─── NEGATIVE ─────────────────────────────────────────────────────────────────

describe("NEGATIVE — a zero-match run also downgrades to inconclusive", () => {
  it("exit 0 + a runner summary reporting 0 executed files -> result inconclusive, completeness zero_match", async () => {
    const spec = makeSpec([testAc("AC-1", "bunx vitest run packages/core/tests/nope.test.ts")]);
    const plan = makePlan();
    const task = taskWithFreshClaim("task-1");
    const bundle: PlanBundle = { plan, spec, tasks: [task] };
    const { fn: getPlanBundle } = makeGetPlanBundle(bundle);
    const executor = makeExecutor([
      ok({ exitCode: 0, outputTail: "Test Files  0 passed (0)\n", durationMs: 50, timedOut: false }),
    ]);
    const recorder = makeRecordVerifiedEvidence();
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, config, undefined, filesExist);

    const result = await service.verifyPlan("plan-1", { by: "runner", nowIso: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.results[0]).toMatchObject({
      result: "inconclusive",
      completeness: "zero_match",
      executed_files: 0,
      declared_paths: 1,
    });
  });
});

// ─── BOUNDARY ─────────────────────────────────────────────────────────────────

describe("BOUNDARY — a zero-declared-path command is NEVER downgraded, even with unparseable output", () => {
  it("`bun run test` (no path args) + unrecognised stdout -> still pass, completeness unknown_runner", async () => {
    const spec = makeSpec([testAc("AC-1", "bun run test")]);
    const plan = makePlan();
    const task = taskWithFreshClaim("task-1");
    const bundle: PlanBundle = { plan, spec, tasks: [task] };
    const { fn: getPlanBundle } = makeGetPlanBundle(bundle);
    const executor = makeExecutor([
      ok({ exitCode: 0, outputTail: "no recognisable summary here\n", durationMs: 30, timedOut: false }),
    ]);
    const recorder = makeRecordVerifiedEvidence();
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, config, undefined, filesExist);

    const result = await service.verifyPlan("plan-1", { by: "runner", nowIso: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // reason: declaredPaths === 0 for "bun run test" — judgeCompleteness's own
    // vacuous short-circuit means this can NEVER be zero_match/under_match
    // regardless of what the (unparseable) stdout says.
    expect(result.value.results[0]).toMatchObject({
      result: "pass",
      completeness: "unknown_runner",
    });
    expect(result.value.results[0]?.executed_files).toBeUndefined();
  });
});

// ─── STATE ────────────────────────────────────────────────────────────────────

describe("STATE — a non-test oracle never runs the guard at all", () => {
  it("oracle: tsc, exit 0 -> no completeness field on either the result or the recorded attestation", async () => {
    const spec = makeSpec([tscAc("AC-1", "bun run typecheck")]);
    const plan = makePlan();
    const task = taskWithFreshClaim("task-1");
    const bundle: PlanBundle = { plan, spec, tasks: [task] };
    const { fn: getPlanBundle } = makeGetPlanBundle(bundle);
    const executor = makeExecutor([
      ok({ exitCode: 0, outputTail: "", durationMs: 500, timedOut: false }),
    ]);
    const recorder = makeRecordVerifiedEvidence();
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, config, undefined, filesExist);

    const result = await service.verifyPlan("plan-1", { by: "runner", nowIso: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.results[0]?.result).toBe("pass");
    expect(result.value.results[0]?.completeness).toBeUndefined();
    expect(result.value.results[0]?.executed_files).toBeUndefined();
    expect(recorder.calls[0]?.entry.attestation?.completeness).toBeUndefined();
  });
});

// ─── REGRESSION (AC-061-5) ────────────────────────────────────────────────────

describe("REGRESSION — declared count equal to executed count records pass + completeness complete", () => {
  it("2 declared paths, vitest reports 2 files passed -> pass, completeness complete, executed_files 2", async () => {
    const command =
      "bunx vitest run packages/core/tests/a.test.ts packages/core/tests/b.test.ts";
    const spec = makeSpec([testAc("AC-1", command)]);
    const plan = makePlan();
    const task = taskWithFreshClaim("task-1");
    const bundle: PlanBundle = { plan, spec, tasks: [task] };
    const { fn: getPlanBundle } = makeGetPlanBundle(bundle);
    const executor = makeExecutor([
      ok({ exitCode: 0, outputTail: "Test Files  2 passed (2)\n", durationMs: 300, timedOut: false }),
    ]);
    const recorder = makeRecordVerifiedEvidence();
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, config, undefined, filesExist);

    const result = await service.verifyPlan("plan-1", { by: "runner", nowIso: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.results[0]).toMatchObject({
      result: "pass",
      completeness: "complete",
      executed_files: 2,
      declared_paths: 2,
    });
    expect(recorder.calls[0]?.entry.result).toBe("pass");
  });
});

describe("REGRESSION — an unrecognised runner records pass + completeness unknown_runner", () => {
  it("declares 1 path, stdout matches no known runner summary -> pass, completeness unknown_runner, no executed_files", async () => {
    const spec = makeSpec([testAc("AC-1", "bunx some-custom-runner packages/core/tests/a.test.ts")]);
    const plan = makePlan();
    const task = taskWithFreshClaim("task-1");
    const bundle: PlanBundle = { plan, spec, tasks: [task] };
    const { fn: getPlanBundle } = makeGetPlanBundle(bundle);
    const executor = makeExecutor([
      ok({ exitCode: 0, outputTail: "All good, 1 suite ran.\n", durationMs: 40, timedOut: false }),
    ]);
    const recorder = makeRecordVerifiedEvidence();
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, config, undefined, filesExist);

    const result = await service.verifyPlan("plan-1", { by: "runner", nowIso: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.results[0]).toMatchObject({
      result: "pass",
      completeness: "unknown_runner",
    });
    expect(result.value.results[0]?.executed_files).toBeUndefined();
    expect(recorder.calls[0]?.entry.attestation?.executed_files).toBeUndefined();
  });
});

// ─── caller-supplied inconclusive rejected (AC-061-6) ─────────────────────────

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

async function createPlanDoc(cs: CorpusService, title = "Test Plan"): Promise<string> {
  const result = await cs.create({ type: "plan", title, content: "body" } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create plan: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

async function createTaskDoc(cs: CorpusService, planId: string, title = "Test Task"): Promise<string> {
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

describe("REGRESSION — caller-supplied inconclusive result via addEvidence is rejected (SPEC-061 §Scope D2, mirrors the attestation guard)", () => {
  it("VALIDATION_ERROR field result, doc unchanged, exit code 4 (same mapping as the pre-existing attestation-smuggling guard)", async () => {
    const store = new InMemoryStore();
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const taskWorkflowService = new TaskWorkflowService(store, undefined, { claimTtlMinutes: 120 });
    const planId = await createPlanDoc(corpusService);
    const taskId = await createTaskDoc(corpusService, planId);

    // reason: "inconclusive" is excluded from EvidenceInput's `result` type at
    // compile time (Exclude<EvidenceEntry["result"], "inconclusive">) — this
    // `as EvidenceInput` cast on a fresh object literal simulates a caller
    // bypassing that exclusion, the SAME bypass vector the pre-existing
    // `attestation` smuggling test (task-workflow-service.test.ts) exercises.
    const smuggled = { ...evidence(), result: "inconclusive" } as unknown as EvidenceInput;

    const result = await taskWorkflowService.addEvidence(taskId, smuggled);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("result");
    expect(result.error.message).toContain("lore verify");
    expect(result.error.value).toBe("inconclusive");
    expect(exitCode(result.error)).toBe(4);

    // Doc must be completely unchanged — no version bump, no evidence array at all.
    const after = await corpusService.get(taskId);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.doc.version).toBe(1);
    expect(after.value.doc.extra["verification_evidence"]).toBeUndefined();
  });

  it("a legitimate pass/fail addEvidence call is UNAFFECTED by the new guard (REGRESSION)", async () => {
    const store = new InMemoryStore();
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const taskWorkflowService = new TaskWorkflowService(store, undefined, { claimTtlMinutes: 120 });
    const planId = await createPlanDoc(corpusService);
    const taskId = await createTaskDoc(corpusService, planId);

    const result = await taskWorkflowService.addEvidence(
      taskId,
      evidence({ result: "fail", output_tail: "AssertionError: expected 1 to equal 2" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const evidenceArr = result.value.extra["verification_evidence"];
    expect(Array.isArray(evidenceArr)).toBe(true);
  });
});

// ─── Part A — build-freshness precheck (task
// task-verify-trust-extensions-build-freshness-t-case-count-guard) ────────────
//
// `checkBinaryFreshness` is an OPTIONAL 5th constructor argument (a
// `() => BinaryFreshnessVerdict` port, mirrors the `executor`/`getPlanBundle`
// injection pattern) — omitting it (as every OTHER describe block in this
// file does) preserves the pre-Part-A constructor signature exactly, so
// `app.ts`'s existing 4-arg call sites need no change. It is consulted ONLY
// when a script:test AC's command references the compiled `dist/lore` binary
// (`commandReferencesCompiledBinary`) — every other command is completely
// unaffected, and the port itself is never even invoked for them (asserted
// via a throwing spy below).
//
// Dimension mapping:
//   HAPPY / REPRO: a command referencing dist/lore with a "stale" verdict
//               downgrades result to "inconclusive" and appends a warning
//               naming `bun run build`
//   NEGATIVE:   a "missing" verdict also downgrades + warns
//   BOUNDARY:   a "fresh" verdict leaves the result exactly as computed
//               otherwise (pass stays pass)
//   ERROR:      n/a — the port is a total function (`BinaryFreshnessVerdict`
//               has no error state); no new throw surface
//   STATE:      a command that does NOT reference dist/lore never calls the
//               port at all, regardless of its verdict
//   REGRESSION: omitting the 5th constructor arg entirely (the pre-Part-A
//               call shape) leaves a non-binary-referencing command's result
//               byte-identical; a stale-binary verdict combined with an
//               already-"under_match" completeness verdict stays
//               "inconclusive" without duplicating the completeness verdict

function makeFreshnessCheck(verdict: "fresh" | "stale" | "missing") {
  const calls: number[] = [];
  const fn = (): "fresh" | "stale" | "missing" => {
    calls.push(1);
    return verdict;
  };
  return { fn, calls };
}

function makeThrowingFreshnessCheck() {
  return (): "fresh" | "stale" | "missing" => {
    throw new Error("checkBinaryFreshness must never be called for a non-binary command");
  };
}

describe("HAPPY/REPRO — a stale dist/lore-referencing command downgrades to inconclusive", () => {
  it("exit 0 + stale binary verdict -> result inconclusive, warning names 'bun run build'", async () => {
    const spec = makeSpec([tscAc("AC-1", "./dist/lore verify plan-1")]);
    const plan = makePlan();
    const task = taskWithFreshClaim("task-1");
    const bundle: PlanBundle = { plan, spec, tasks: [task] };
    const { fn: getPlanBundle } = makeGetPlanBundle(bundle);
    const executor = makeExecutor([
      ok({ exitCode: 0, outputTail: "verified ok\n", durationMs: 50, timedOut: false }),
    ]);
    const recorder = makeRecordVerifiedEvidence();
    const { fn: checkBinaryFreshness } = makeFreshnessCheck("stale");
    const service = new VerifyRunnerService(
      getPlanBundle,
      recorder.fn,
      executor.fn,
      config,
      checkBinaryFreshness,
      filesExist,
    );

    const result = await service.verifyPlan("plan-1", { by: "runner", nowIso: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.results[0]?.result).toBe("inconclusive");
    expect(result.value.results[0]?.binary_freshness).toBe("stale");
    expect(result.value.warnings.some((w) => w.includes("bun run build"))).toBe(true);
    expect(recorder.calls[0]?.entry.result).toBe("inconclusive");
  });
});

describe("NEGATIVE — a missing binary also downgrades to inconclusive", () => {
  it("exit 0 + missing binary verdict -> result inconclusive, warning present", async () => {
    const spec = makeSpec([tscAc("AC-1", "/repo/dist/lore --version")]);
    const plan = makePlan();
    const task = taskWithFreshClaim("task-1");
    const bundle: PlanBundle = { plan, spec, tasks: [task] };
    const { fn: getPlanBundle } = makeGetPlanBundle(bundle);
    const executor = makeExecutor([
      ok({ exitCode: 0, outputTail: "", durationMs: 10, timedOut: false }),
    ]);
    const recorder = makeRecordVerifiedEvidence();
    const { fn: checkBinaryFreshness } = makeFreshnessCheck("missing");
    const service = new VerifyRunnerService(
      getPlanBundle,
      recorder.fn,
      executor.fn,
      config,
      checkBinaryFreshness,
      filesExist,
    );

    const result = await service.verifyPlan("plan-1", { by: "runner", nowIso: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.results[0]?.result).toBe("inconclusive");
    expect(result.value.results[0]?.binary_freshness).toBe("missing");
    expect(result.value.warnings.some((w) => w.includes("bun run build"))).toBe(true);
  });
});

describe("BOUNDARY — a fresh binary leaves the result exactly as otherwise computed", () => {
  it("exit 0 + fresh verdict -> result stays pass, no freshness warning", async () => {
    const spec = makeSpec([tscAc("AC-1", "./dist/lore verify plan-1")]);
    const plan = makePlan();
    const task = taskWithFreshClaim("task-1");
    const bundle: PlanBundle = { plan, spec, tasks: [task] };
    const { fn: getPlanBundle } = makeGetPlanBundle(bundle);
    const executor = makeExecutor([
      ok({ exitCode: 0, outputTail: "verified ok\n", durationMs: 50, timedOut: false }),
    ]);
    const recorder = makeRecordVerifiedEvidence();
    const { fn: checkBinaryFreshness } = makeFreshnessCheck("fresh");
    const service = new VerifyRunnerService(
      getPlanBundle,
      recorder.fn,
      executor.fn,
      config,
      checkBinaryFreshness,
      filesExist,
    );

    const result = await service.verifyPlan("plan-1", { by: "runner", nowIso: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.results[0]?.result).toBe("pass");
    expect(result.value.results[0]?.binary_freshness).toBe("fresh");
    expect(result.value.warnings.some((w) => w.includes("bun run build"))).toBe(false);
  });
});

describe("STATE — a non-binary-referencing command never invokes checkBinaryFreshness at all", () => {
  it("a plain source-run command completes normally even with a throwing freshness port", async () => {
    const spec = makeSpec([tscAc("AC-1", "bun run typecheck")]);
    const plan = makePlan();
    const task = taskWithFreshClaim("task-1");
    const bundle: PlanBundle = { plan, spec, tasks: [task] };
    const { fn: getPlanBundle } = makeGetPlanBundle(bundle);
    const executor = makeExecutor([
      ok({ exitCode: 0, outputTail: "", durationMs: 500, timedOut: false }),
    ]);
    const recorder = makeRecordVerifiedEvidence();
    const service = new VerifyRunnerService(
      getPlanBundle,
      recorder.fn,
      executor.fn,
      config,
      makeThrowingFreshnessCheck(),
      filesExist,
    );

    const result = await service.verifyPlan("plan-1", { by: "runner", nowIso: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.results[0]?.result).toBe("pass");
    expect(result.value.results[0]?.binary_freshness).toBeUndefined();
  });
});

// ─── M6.2 discovery-refusal guard (task-consume-finddiscoveryrefusal-on-the-
// attested-exit-nonzero, spec-oracle-executability-a-runner-s-discovery-
// refusal-is-not-a §M6.2) ────────────────────────────────────────────────────
//
// Before this task: `VerifyRunnerService` gated its whole completeness block
// on `executedSuccessfully` (exit 0), reasoning "a nonzero exit/timeout is
// already fail, completeness is irrelevant to it". That reasoning is the
// defect — a test-runner discovery refusal (found no matching test file) is a
// ZERO-EXECUTION event that exits nonzero, indistinguishable BY EXIT CODE
// ALONE from a genuine assertion failure. AC-OX-2 pins the fix (a refusal
// downgrades to "inconclusive", never "fail"); AC-OX-3 is the counterweight
// pinning that a GENUINE failure tail is UNAFFECTED — the fail path is
// narrowed, never removed.

describe("AC-OX-2 refusal-inconclusive — a discovery-refusal exit-nonzero tail records inconclusive, never fail", () => {
  it("exit 1 + a vitest discovery-refusal tail ('No test files found, exiting with code 1') -> result inconclusive, NOT fail", async () => {
    const spec = makeSpec([testAc("AC-1", "bunx vitest run packages/core/tests/does-not-exist.test.ts")]);
    const plan = makePlan();
    const task = taskWithFreshClaim("task-1");
    const bundle: PlanBundle = { plan, spec, tasks: [task] };
    const { fn: getPlanBundle } = makeGetPlanBundle(bundle);
    const executor = makeExecutor([
      ok({
        exitCode: 1,
        outputTail: "No test files found, exiting with code 1\n",
        durationMs: 40,
        timedOut: false,
      }),
    ]);
    const recorder = makeRecordVerifiedEvidence();
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, config, undefined, filesExist);

    const result = await service.verifyPlan("plan-1", { by: "runner", nowIso: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.results).toHaveLength(1);
    expect(result.value.results[0]).toMatchObject({
      ac_id: "AC-1",
      result: "inconclusive",
      exit_code: 1,
    });
    expect(result.value.results[0]?.result).not.toBe("fail");

    // The evidence actually recorded (what a caller would see via `lore ac
    // list`) must carry "inconclusive", NEVER "fail" — the whole point of the
    // guard: a mistyped/not-yet-written test path must not mint a permanent,
    // indistinguishable-from-a-real-red "fail".
    expect(recorder.calls).toHaveLength(1);
    expect(recorder.calls[0]?.entry.result).toBe("inconclusive");
    expect(recorder.calls[0]?.entry.attestation?.exit_code).toBe(1);
  });
});

describe("AC-OX-3 genuine-failure-still-fail — REGRESSION: a genuine failure tail still records fail (the fail path is narrowed, never removed)", () => {
  it("exit 1 + a GENUINE vitest failure tail ('Test Files 1 failed (1)') -> result stays fail", async () => {
    const spec = makeSpec([testAc("AC-1", "bunx vitest run packages/core/tests/a.test.ts")]);
    const plan = makePlan();
    const task = taskWithFreshClaim("task-1");
    const bundle: PlanBundle = { plan, spec, tasks: [task] };
    const { fn: getPlanBundle } = makeGetPlanBundle(bundle);
    const executor = makeExecutor([
      ok({
        exitCode: 1,
        outputTail: "FAIL  packages/core/tests/a.test.ts\nTest Files  1 failed (1)\n",
        durationMs: 120,
        timedOut: false,
      }),
    ]);
    const recorder = makeRecordVerifiedEvidence();
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, config, undefined, filesExist);

    const result = await service.verifyPlan("plan-1", { by: "runner", nowIso: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.results[0]).toMatchObject({ ac_id: "AC-1", result: "fail", exit_code: 1 });
    expect(recorder.calls[0]?.entry.result).toBe("fail");
  });
});

describe("REGRESSION — omitting the 5th constructor argument entirely is byte-identical for a non-binary command", () => {
  it("no checkBinaryFreshness passed at all -> unaffected (pre-Part-A call shape)", async () => {
    const spec = makeSpec([testAc("AC-1", "bunx vitest run packages/core/tests/a.test.ts")]);
    const plan = makePlan();
    const task = taskWithFreshClaim("task-1");
    const bundle: PlanBundle = { plan, spec, tasks: [task] };
    const { fn: getPlanBundle } = makeGetPlanBundle(bundle);
    const executor = makeExecutor([
      ok({ exitCode: 0, outputTail: "Test Files  1 passed (1)\n", durationMs: 30, timedOut: false }),
    ]);
    const recorder = makeRecordVerifiedEvidence();
    // reason: the pre-Part-A 4-arg constructor call — proves app.ts's existing
    // wiring needs no change.
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, config, undefined, filesExist);

    const result = await service.verifyPlan("plan-1", { by: "runner", nowIso: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.results[0]).toMatchObject({ result: "pass", completeness: "complete" });
    expect(result.value.results[0]?.binary_freshness).toBeUndefined();
  });

  it("a stale binary combined with an already-under_match completeness verdict stays inconclusive (no duplicated downgrade)", async () => {
    const command = "./dist/lore verify plan-1 packages/core/tests/a.test.ts packages/core/tests/b.test.ts";
    const spec = makeSpec([testAc("AC-1", command)]);
    const plan = makePlan();
    const task = taskWithFreshClaim("task-1");
    const bundle: PlanBundle = { plan, spec, tasks: [task] };
    const { fn: getPlanBundle } = makeGetPlanBundle(bundle);
    // vitest reports only 1 of the 2 declared files ran (under_match) AND the
    // binary is stale — both signals independently demand "inconclusive".
    const executor = makeExecutor([
      ok({ exitCode: 0, outputTail: "Test Files  1 passed (1)\n", durationMs: 30, timedOut: false }),
    ]);
    const recorder = makeRecordVerifiedEvidence();
    const { fn: checkBinaryFreshness } = makeFreshnessCheck("stale");
    const service = new VerifyRunnerService(
      getPlanBundle,
      recorder.fn,
      executor.fn,
      config,
      checkBinaryFreshness,
      filesExist,
    );

    const result = await service.verifyPlan("plan-1", { by: "runner", nowIso: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.results[0]?.result).toBe("inconclusive");
    expect(result.value.results[0]?.completeness).toBe("under_match");
    expect(result.value.results[0]?.binary_freshness).toBe("stale");
  });
});

// ─── AC-TG-6 — a missing oracle file is NOT MEASURED ──────────────────────────

describe("AC-TG-6 — a command naming a missing test file is recorded inconclusive and never spawned", () => {
  it("NEGATIVE: fileExists false -> executor never called, result inconclusive, exit_code -1, tail names the path", async () => {
    const spec = makeSpec([testAc("AC-060-7", "bun test packages/gone/oracle.test.ts")]);
    const task = taskWithFreshClaim("task-1");
    const { fn: getPlanBundle } = makeGetPlanBundle({ plan: makePlan(), spec, tasks: [task] });
    const executor = makeExecutor([]);
    const recorder = makeRecordVerifiedEvidence();
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, config, undefined, () => false);

    const result = await service.verifyPlan("plan-1", { by: "runner", nowIso: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(executor.calls).toHaveLength(0);
    expect(result.value.results[0]?.result).toBe("inconclusive");
    expect(result.value.warnings.some((w) => w.includes("packages/gone/oracle.test.ts"))).toBe(true);
    expect(recorder.calls[0]?.entry.result).toBe("inconclusive");
    expect(recorder.calls[0]?.entry.output_tail).toContain("packages/gone/oracle.test.ts");
    expect(recorder.calls[0]?.entry.attestation?.exit_code).toBe(-1);
  });

  it("BOUNDARY: a command naming no test file is unaffected by fileExists (nothing extractable to check)", async () => {
    const spec = makeSpec([tscAc("AC-1", "bun run typecheck")]);
    const task = taskWithFreshClaim("task-1");
    const { fn: getPlanBundle } = makeGetPlanBundle({ plan: makePlan(), spec, tasks: [task] });
    const executor = makeExecutor([ok({ exitCode: 0, outputTail: "ok\n", durationMs: 5, timedOut: false })]);
    const recorder = makeRecordVerifiedEvidence();
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, executor.fn, config, undefined, () => false);

    const result = await service.verifyPlan("plan-1", { by: "runner", nowIso: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(executor.calls).toHaveLength(1);
    expect(result.value.results[0]?.result).toBe("pass");
  });
});
