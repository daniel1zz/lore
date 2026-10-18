/**
 * Six-dimension tests for `lore verify`'s DECLARED-SCOPE selection (D3) and its
 * pre-flight refusal paths (D2/D3) — spec-declared-scope-attestation-contract-
 * task-owned-ac-scope, AC-VS-1 … AC-VS-5.
 *
 * Every case drives the REAL `VerifyRunnerService` through the SAME hand-written
 * port-double pattern its sibling suites use (`verify-runner-service.test.ts`,
 * `verify-completeness.test.ts`) — no store, no compiled binary. The refusal
 * paths are asserted through the EXISTING injected `recordVerifiedEvidence`
 * seam: a refusal is proven by NON-INVOCATION of that recorder AND of the
 * executor, never by parsing stdout (the spec's own testability claim, ADR
 * §Consequences).
 *
 * Every assertion on a refusal ALSO asserts `exitCode(error) === 4` via the real
 * CLI mapping — the spec pins the exit code, not just the error code, and a
 * `VALIDATION_ERROR` that stopped mapping to 4 would be a silent contract break.
 *
 * Dimension mapping:
 *   HAPPY (AC-VS-1):      a default run against a 2-of-3 declared scope attests
 *                         exactly those 2 ac_refs, measured as the RECORDED set
 *   HAPPY control (AC-VS-2): the SAME 3-criterion spec with an all-3 scope
 *                         attests 3 — both runs measured in ONE test so the
 *                         2-vs-3 difference is proven, not assumed (a runner
 *                         that executes nothing yields 0 === 0 and fails here)
 *   NEGATIVE (AC-VS-3):   absent `ac_scope` + no `--ac` → exit 4 naming
 *                         `lore scope add`, zero executions, zero recordings
 *   NEGATIVE (AC-VS-4):   an `--ac` id outside the declared scope → exit 4
 *                         pre-flight naming the offending id AND the whole
 *                         declared set
 *   BOUNDARY (AC-VS-5):   an EMPTY `ac_scope` array → exit 4 carrying
 *                         `declares no acceptance criterion`, a literal the
 *                         absent-case message must NOT carry (empty and absent
 *                         are two states, not one collapsed path)
 *   BOUNDARY (extra):     duplicate ids inside `ac_scope` never double-execute
 *                         nor double-record an AC
 *   ERROR:                a MALFORMED `ac_scope` (not a string array) is read as
 *                         absent — refused, never silently promoted to a scope
 *   STATE:                absent scope + an explicit `--ac` RUNS (D2's stated
 *                         escape hatch); and a scope naming an `ai`-mode
 *                         criterion reports it in `skipped` while still
 *                         executing the script-mode one
 *   REGRESSION:           a scope whose every id names nothing on the spec
 *                         REFUSES instead of executing zero ACs and exiting 0
 *                         (the vacuous-pass shape this whole contract exists to
 *                         remove); and an explicit `--ac` still narrows WITHIN a
 *                         wider declared scope
 *
 * @spec_ref spec-declared-scope-attestation-contract-task-owned-ac-scope
 *   AC-VS-1, AC-VS-2, AC-VS-3, AC-VS-4, AC-VS-5; D1, D2, D3
 */

import { tmpdir } from "node:os";
import { describe, it, expect } from "vitest";
import { ok } from "@lore/core";
import type { AcceptanceCriterion, DocRecord, LoreError, PlanBundle, Result } from "@lore/core";
import { VerifyRunnerService } from "../../../src/service/verify-runner-service.js";
import type { VerifySpawnSpec, VerifyExecutionResult } from "../../../src/service/verify-spawn.js";
import type { VerifiedEvidenceInput } from "../../../src/service/task-workflow-service.js";
import { exitCode } from "../../../src/adapters/cli/utils.js";

// ─── Fixture builders (mirrors verify-runner-service.test.ts) ──────────────────

function makeDoc(
  overrides: Partial<DocRecord> & Pick<DocRecord, "id" | "type" | "title">,
): DocRecord {
  return {
    slug: overrides.id,
    role: "plan",
    status: "approved",
    priority: "medium",
    content: "body",
    parent_id: null,
    created_at: "2026-07-31T00:00:00.000Z",
    updated_at: "2026-07-31T00:00:00.000Z",
    created_by: "alice",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
    ...overrides,
  } as DocRecord;
}

function makePlan(): DocRecord {
  return makeDoc({ id: "plan-1", type: "plan", title: "Plan" });
}

function makeSpec(acceptanceCriteria: AcceptanceCriterion[]): DocRecord {
  return makeDoc({
    id: "spec-1",
    type: "spec",
    title: "Spec",
    status: "approved",
    extra: { acceptance_criteria: acceptanceCriteria },
  });
}

function scriptAc(id: string, command: string): AcceptanceCriterion {
  return { id, statement: `${id} statement`, verify: { mode: "script", oracle: "test", command } };
}

function aiAc(id: string): AcceptanceCriterion {
  return { id, statement: `${id} statement`, verify: { mode: "ai", rubric: "rubric" } };
}

const NOW = "2026-07-31T10:00:00.000Z";
const FRESH_CLAIM_AT = "2026-07-31T09:59:00.000Z";

/**
 * The shared AC-VS-1/AC-VS-2 fixture: a spec declaring EXACTLY 3 script-mode
 * criteria, each with its OWN command (so an executor call can be attributed to
 * exactly one criterion — a stub returning a constant cannot fake the selection).
 */
const AC_A = scriptAc("AC-VS-A", "cmd-a");
const AC_B = scriptAc("AC-VS-B", "cmd-b");
const AC_C = scriptAc("AC-VS-C", "cmd-c");
const THREE_CRITERION_SPEC = (): DocRecord => makeSpec([AC_A, AC_B, AC_C]);

/**
 * A fresh-claimed target task. `scope` is written to `extra.ac_scope` VERBATIM —
 * `undefined` leaves the key ABSENT (the AC-VS-3 state), `[]` writes an empty
 * array (the distinct AC-VS-5 state).
 */
function taskWithScope(scope: readonly string[] | undefined | unknown): DocRecord {
  return makeDoc({
    id: "task-1",
    type: "task",
    title: "Task task-1",
    slug: "task-1",
    parent_id: "plan-1",
    extra: {
      claim: { by: "alice", at: FRESH_CLAIM_AT },
      ...(scope === undefined ? {} : { ac_scope: scope }),
    },
  });
}

// ─── Port doubles ─────────────────────────────────────────────────────────────

function makeGetPlanBundle(bundle: PlanBundle) {
  return async (_planIdOrSlug: string): Promise<Result<PlanBundle, LoreError>> => ok(bundle);
}

/** Executor double: answers every call with exit 0, recording the spec it was handed. */
function makeExecutor() {
  const calls: VerifySpawnSpec[] = [];
  const fn = async (spec: VerifySpawnSpec): Promise<Result<VerifyExecutionResult, LoreError>> => {
    calls.push(spec);
    return ok({ exitCode: 0, outputTail: "", durationMs: 1, timedOut: false });
  };
  return {
    fn,
    calls,
    get callCount(): number {
      return calls.length;
    },
    /**
     * The AC command each executor call carried. `VerifySpawnSpec.cmd` is
     * always `["sh", "-c", <command>]`, so index 2 IS the criterion's command
     * (`verify-spawn.ts::buildVerifySpawnSpec`) — the per-criterion identity
     * that makes "which ACs actually ran" measurable.
     */
    get commands(): Array<string | undefined> {
      return calls.map((c) => c.cmd[2]);
    },
  };
}

function makeRecorder() {
  const calls: Array<{ idOrSlug: string; entry: VerifiedEvidenceInput; nowIso: string }> = [];
  const fn = async (
    idOrSlug: string,
    entry: VerifiedEvidenceInput,
    nowIso: string,
  ): Promise<Result<DocRecord, LoreError>> => {
    calls.push({ idOrSlug, entry, nowIso });
    return ok(makeDoc({ id: "task-1", type: "task", title: "Task task-1", version: calls.length + 1 }));
  };
  return {
    fn,
    calls,
    get callCount(): number {
      return calls.length;
    },
    /** The set of `ac_ref`s actually ATTESTED — AC-VS-1's measurement surface. */
    get attestedAcRefs(): Array<string | undefined> {
      return calls.map((c) => c.entry.ac_ref);
    },
  };
}

const config = {
  repoRoot: "/repo",
  defaultTimeoutMs: 300000,
  claimTtlMinutes: 120,
  // The command-provenance gate (SPEC-039 §M2) is a DIFFERENT refusal from the
  // scope refusals under test; disabled so no fixture command is rejected as
  // "new/changed" before scope selection is even reached.
  requireCommandApproval: false,
  envAllowlist: [],
  envPassthroughAll: true,
  processEnv: {},
  tmpDir: tmpdir(),
};

/**
 * Runs one scope scenario end-to-end and returns the run's Result plus both
 * doubles, so every case can assert on the RECORDED set and on non-invocation.
 */
async function runScope(
  spec: DocRecord,
  task: DocRecord,
  opts: { acIds?: string[] } = {},
): Promise<{
  result: Awaited<ReturnType<VerifyRunnerService["verifyPlan"]>>;
  executor: ReturnType<typeof makeExecutor>;
  recorder: ReturnType<typeof makeRecorder>;
}> {
  const bundle: PlanBundle = { plan: makePlan(), spec, tasks: [task] };
  const executor = makeExecutor();
  const recorder = makeRecorder();
  const service = new VerifyRunnerService(
    makeGetPlanBundle(bundle),
    recorder.fn,
    executor.fn,
    config,
  );
  const result = await service.verifyPlan("plan-1", {
    by: "runner",
    nowIso: NOW,
    ...(opts.acIds !== undefined ? { acIds: opts.acIds } : {}),
  });
  return { result, executor, recorder };
}

/** Narrows a refusal Result to its LoreError, failing the test if it succeeded. */
function expectRefusal(
  result: Awaited<ReturnType<VerifyRunnerService["verifyPlan"]>>,
): LoreError & { code: "VALIDATION_ERROR"; message: string } {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected a refusal, got ok()");
  expect(result.error.code).toBe("VALIDATION_ERROR");
  if (result.error.code !== "VALIDATION_ERROR") throw new Error("expected VALIDATION_ERROR");
  // The spec pins the EXIT CODE (4), not only the error code.
  expect(exitCode(result.error)).toBe(4);
  return result.error;
}

// ─── HAPPY — AC-VS-1 ──────────────────────────────────────────────────────────

describe("AC-VS-1 — a default run selects the declared-scope intersection by default", () => {
  it("intersection by default: a 2-of-3 declared scope attests exactly those 2 ac_refs", async () => {
    const task = taskWithScope(["AC-VS-A", "AC-VS-C"]);
    const { result, executor, recorder } = await runScope(THREE_CRITERION_SPEC(), task);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // MEASURED AS THE RECORDED SET (not stdout): exactly the 2 declared ids.
    expect(recorder.attestedAcRefs).toEqual(["AC-VS-A", "AC-VS-C"]);
    expect(recorder.callCount).toBe(2);
    // The out-of-scope criterion was never even executed — each command is
    // criterion-unique, so this cannot be satisfied by a constant-returning stub.
    expect(executor.commands).toEqual(["cmd-a", "cmd-c"]);
    expect(executor.callCount).toBe(2);
    expect(result.value.results.map((r) => r.ac_id)).toEqual(["AC-VS-A", "AC-VS-C"]);
  });
});

// ─── HAPPY control — AC-VS-2 ──────────────────────────────────────────────────

describe("AC-VS-2 — the control: a WIDER declared scope executes strictly more", () => {
  it("wider scope executes more: the same spec yields 2 for a 2-id scope and 3 for a 3-id scope", async () => {
    const narrow = await runScope(THREE_CRITERION_SPEC(), taskWithScope(["AC-VS-A", "AC-VS-C"]));
    const wide = await runScope(
      THREE_CRITERION_SPEC(),
      taskWithScope(["AC-VS-A", "AC-VS-B", "AC-VS-C"]),
    );

    expect(narrow.result.ok).toBe(true);
    expect(wide.result.ok).toBe(true);

    const narrowRefs = narrow.recorder.attestedAcRefs;
    const wideRefs = wide.recorder.attestedAcRefs;

    expect(narrowRefs).toEqual(["AC-VS-A", "AC-VS-C"]);
    expect(wideRefs).toEqual(["AC-VS-A", "AC-VS-B", "AC-VS-C"]);
    // The discrimination this control exists for: two declared scopes over ONE
    // spec MUST yield two different counts. A runner that executed nothing (or
    // everything) would make these equal.
    expect(narrowRefs).toHaveLength(2);
    expect(wideRefs).toHaveLength(3);
    expect(narrowRefs.length).not.toBe(wideRefs.length);
    // Strict superset, not merely a bigger number.
    for (const ref of narrowRefs) expect(wideRefs).toContain(ref);
    expect(wideRefs).toContain("AC-VS-B");
    expect(narrowRefs).not.toContain("AC-VS-B");
    // And the executions match the attestations one-for-one in both runs.
    expect(narrow.executor.commands).toEqual(["cmd-a", "cmd-c"]);
    expect(wide.executor.commands).toEqual(["cmd-a", "cmd-b", "cmd-c"]);
  });
});

// ─── NEGATIVE — AC-VS-3 ───────────────────────────────────────────────────────

describe("AC-VS-3 — an UNKNOWN (absent) scope refuses pre-flight", () => {
  it("unknown scope refuses: no ac_scope and no --ac exits 4 naming 'lore scope add', recorder never invoked", async () => {
    const { result, executor, recorder } = await runScope(
      THREE_CRITERION_SPEC(),
      taskWithScope(undefined),
    );

    const error = expectRefusal(result);
    expect(error.message).toContain("lore scope add");
    // The absent-case message must NOT carry the EMPTY-case literal — AC-VS-5's
    // "empty is a different state" contract, asserted from this side too.
    expect(error.message).not.toContain("declares no acceptance criterion");
    // Refusal is PRE-FLIGHT: nothing ran, nothing was attested.
    expect(executor.callCount).toBe(0);
    expect(recorder.callCount).toBe(0);
  });
});

// ─── NEGATIVE — AC-VS-4 ───────────────────────────────────────────────────────

describe("AC-VS-4 — an explicit --ac outside the declared scope refuses pre-flight", () => {
  it("out of scope ac refuses preflight: zero executions, zero entries, stderr names the offender AND the whole declared set", async () => {
    const task = taskWithScope(["AC-VS-A", "AC-VS-B"]);
    const { result, executor, recorder } = await runScope(THREE_CRITERION_SPEC(), task, {
      // AC-VS-C IS declared on the spec (so the pre-existing unknown-id check
      // passes) but is NOT in this task's declared scope.
      acIds: ["AC-VS-C"],
    });

    const error = expectRefusal(result);
    // The offending id …
    expect(error.message).toContain("AC-VS-C");
    // … AND every id of the task's declared set.
    expect(error.message).toContain("AC-VS-A");
    expect(error.message).toContain("AC-VS-B");
    expect(executor.callCount).toBe(0);
    expect(recorder.callCount).toBe(0);
  });
});

// ─── BOUNDARY — AC-VS-5 ───────────────────────────────────────────────────────

describe("AC-VS-5 — an EMPTY scope array is a distinct state from an ABSENT field", () => {
  it("empty scope distinct from absent: [] exits 4 with 'declares no acceptance criterion', a literal absent from the absent-case message", async () => {
    const empty = await runScope(THREE_CRITERION_SPEC(), taskWithScope([]));
    const emptyError = expectRefusal(empty.result);
    expect(emptyError.message).toContain("declares no acceptance criterion");
    expect(empty.executor.callCount).toBe(0);
    expect(empty.recorder.callCount).toBe(0);

    // The same fixture with the field ABSENT must refuse with a DIFFERENT
    // message — one collapsed code path with a cosmetic difference would fail
    // one of these two conditions.
    const absent = await runScope(THREE_CRITERION_SPEC(), taskWithScope(undefined));
    const absentError = expectRefusal(absent.result);
    expect(absentError.message).not.toContain("declares no acceptance criterion");
    expect(absentError.message).not.toBe(emptyError.message);
  });
});

describe("BOUNDARY — an EMPTY scope refuses even WITH an explicit --ac", () => {
  it("ac_scope [] + --ac AC-VS-A still exits 4 with the empty-scope literal (an un-declaration claims nothing)", async () => {
    const { result, executor, recorder } = await runScope(
      THREE_CRITERION_SPEC(),
      taskWithScope([]),
      { acIds: ["AC-VS-A"] },
    );
    const error = expectRefusal(result);
    expect(error.message).toContain("declares no acceptance criterion");
    expect(executor.callCount).toBe(0);
    expect(recorder.callCount).toBe(0);
  });
});

// ─── BOUNDARY (extra) ─────────────────────────────────────────────────────────

describe("BOUNDARY — duplicate ids inside a declared scope never double-run an AC", () => {
  it("ac_scope ['AC-VS-A','AC-VS-A'] executes and attests AC-VS-A exactly once", async () => {
    const { result, executor, recorder } = await runScope(
      THREE_CRITERION_SPEC(),
      taskWithScope(["AC-VS-A", "AC-VS-A"]),
    );
    expect(result.ok).toBe(true);
    expect(recorder.attestedAcRefs).toEqual(["AC-VS-A"]);
    expect(executor.commands).toEqual(["cmd-a"]);
  });
});

// ─── ERROR ────────────────────────────────────────────────────────────────────

describe("ERROR — a MALFORMED ac_scope is read as absent, never promoted to a scope", () => {
  it("ac_scope: 'AC-VS-A' (a bare string, not an array) refuses like an absent field", async () => {
    const { result, executor, recorder } = await runScope(
      THREE_CRITERION_SPEC(),
      taskWithScope("AC-VS-A"),
    );
    const error = expectRefusal(result);
    expect(error.message).toContain("lore scope add");
    expect(executor.callCount).toBe(0);
    expect(recorder.callCount).toBe(0);
  });

  it("ac_scope: [42] (array of non-strings) refuses like an absent field", async () => {
    const { result, executor, recorder } = await runScope(
      THREE_CRITERION_SPEC(),
      taskWithScope([42]),
    );
    const error = expectRefusal(result);
    expect(error.message).toContain("lore scope add");
    expect(executor.callCount).toBe(0);
    expect(recorder.callCount).toBe(0);
  });
});

// ─── STATE ────────────────────────────────────────────────────────────────────

describe("STATE — an absent scope is verifiable ONLY through an explicit --ac (D2)", () => {
  it("absent ac_scope + --ac AC-VS-B runs exactly that one AC", async () => {
    const { result, executor, recorder } = await runScope(
      THREE_CRITERION_SPEC(),
      taskWithScope(undefined),
      { acIds: ["AC-VS-B"] },
    );
    expect(result.ok).toBe(true);
    expect(recorder.attestedAcRefs).toEqual(["AC-VS-B"]);
    expect(executor.commands).toEqual(["cmd-b"]);
  });
});

describe("STATE — a scope naming a non-script criterion reports it as skipped, not executed", () => {
  it("scope ['AC-VS-A','AC-VS-AI'] executes the script AC and reports the ai AC in skipped", async () => {
    const spec = makeSpec([AC_A, aiAc("AC-VS-AI")]);
    const { result, executor, recorder } = await runScope(
      spec,
      taskWithScope(["AC-VS-A", "AC-VS-AI"]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(recorder.attestedAcRefs).toEqual(["AC-VS-A"]);
    expect(executor.commands).toEqual(["cmd-a"]);
    expect(result.value.skipped).toEqual([{ ac_id: "AC-VS-AI", mode: "ai" }]);
  });
});

// ─── REGRESSION ───────────────────────────────────────────────────────────────

describe("REGRESSION — a scope that names nothing on the spec refuses instead of passing vacuously", () => {
  it("every declared scope id unknown to the spec → exit 4, zero executions (never an exit-0 run of zero ACs)", async () => {
    const { result, executor, recorder } = await runScope(
      THREE_CRITERION_SPEC(),
      taskWithScope(["AC-VS-GONE"]),
    );
    const error = expectRefusal(result);
    expect(error.message).toContain("AC-VS-GONE");
    expect(executor.callCount).toBe(0);
    expect(recorder.callCount).toBe(0);
  });
});

describe("REGRESSION — an explicit --ac still narrows WITHIN a wider declared scope", () => {
  it("scope of all 3 + --ac AC-VS-B attests only AC-VS-B", async () => {
    const { result, executor, recorder } = await runScope(
      THREE_CRITERION_SPEC(),
      taskWithScope(["AC-VS-A", "AC-VS-B", "AC-VS-C"]),
      { acIds: ["AC-VS-B"] },
    );
    expect(result.ok).toBe(true);
    expect(recorder.attestedAcRefs).toEqual(["AC-VS-B"]);
    expect(executor.commands).toEqual(["cmd-b"]);
  });
});

describe("REGRESSION — the pre-existing unknown-AC-id refusal still fires first", () => {
  it("--ac naming an id declared on NO spec criterion refuses on field acIds, before any scope check", async () => {
    const { result, executor, recorder } = await runScope(
      THREE_CRITERION_SPEC(),
      taskWithScope(["AC-VS-A"]),
      { acIds: ["AC-VS-NOPE"] },
    );
    const error = expectRefusal(result);
    expect(error.field).toBe("acIds");
    expect(error.message).toContain("not declared on spec");
    expect(executor.callCount).toBe(0);
    expect(recorder.callCount).toBe(0);
  });
});
