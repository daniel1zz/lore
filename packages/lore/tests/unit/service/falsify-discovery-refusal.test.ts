/**
 * Falsify path refuses non-reds — AC-EH-10
 * (spec-evidence-labels-and-reds-are-honest; BR-1075, BR-189; issue #53).
 *
 * `VerifyRunnerService.verifyFalsifier` is driven with a SCRIPTED executor
 * (never a real spawn): call 1 is the unmutated green control and always
 * exits 0; call 2 is the mutated run and returns the scripted exit code and
 * output. Only the git scratch-worktree mechanics are real (a throwaway
 * `mkdtemp` + `git init` repo — never this repo's own tree).
 *
 * Dimension mapping:
 *   HAPPY / REGRESSION: (d) a mutated run printing vitest's
 *     `Tests  1 failed (1)` summary with exit 1 still records
 *     expected-fail WITH an attestation (the genuine-red control; it passes
 *     on current main by design — it pins the behaviour the refusal must not
 *     break).
 *   NEGATIVE: (a) vitest "No test files found" at exit 1 == declared 1, (c)
 *     bun "did not match any test files" at exit 1 == declared 1 — a runner
 *     that found no tests is not a red.
 *   STATE: (b) no row with result "expected-fail" is written in (a).
 *   BOUNDARY: (e)/(e2) the mutated exit code EQUALS the declared code but is
 *     127 / 126 (not runnable / not found) — equality with the declaration
 *     must not rescue it.
 *
 * Every non-red case must record exactly one row: result "inconclusive",
 * capture_source "runner-unattested", no attestation, and the service result
 * "inconclusive" (the CLI maps that to outcome code 3).
 *
 * RED reason on current main: the falsify path matches exit code against the
 * declared value only, so each of (a), (c), (e), (e2) records
 * "expected-fail" / capture_source "runner" with an attestation — assertion
 * failures, not harness errors. No not-yet-existing export is imported.
 *
 * @spec_ref AC-EH-10
 */

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok } from "@lore/core";
import type { AcceptanceCriterion, DocRecord, LoreError, PlanBundle, Result } from "@lore/core";
import { VerifyRunnerService } from "../../../src/service/verify-runner-service.js";
import type { VerifySpawnSpec, VerifyExecutionResult } from "../../../src/service/verify-spawn.js";
import type { VerifiedEvidenceInput } from "../../../src/service/task-workflow-service.js";

const createdRepos: string[] = [];

function makeThrowawayGitRepo(): string {
  const repoRoot = mkdtempSync(join(tmpdir(), "lore-falsify-discovery-fixture-"));
  execFileSync("git", ["init", "-q"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.name", "Falsify Discovery Test"], { cwd: repoRoot });
  writeFileSync(join(repoRoot, "target.txt"), "MAGIC_MARKER present\n", "utf8");
  execFileSync("git", ["add", "-A"], { cwd: repoRoot });
  execFileSync("git", ["commit", "-q", "-m", "seed target.txt"], { cwd: repoRoot });
  createdRepos.push(repoRoot);
  return repoRoot;
}

afterEach(() => {
  while (createdRepos.length > 0) {
    const repoRoot = createdRepos.pop();
    if (repoRoot === undefined) continue;
    try {
      rmSync(repoRoot, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup of a throwaway fixture */
    }
  }
});

function makeDoc(overrides: Partial<DocRecord> & Pick<DocRecord, "id" | "type" | "title">): DocRecord {
  return {
    slug: overrides.id,
    role: "plan",
    status: "approved",
    priority: "medium",
    content: "body",
    parent_id: null,
    created_at: "2026-10-12T00:00:00.000Z",
    updated_at: "2026-10-12T00:00:00.000Z",
    created_by: "alice",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
    ...overrides,
  } as DocRecord;
}

function makeCriterion(expectedExitCode: number): AcceptanceCriterion {
  return {
    id: "AC-DISC-1",
    statement: "the test run for target.txt is green",
    verify: {
      mode: "script",
      oracle: "test",
      command: "bunx vitest run tests/target.test.ts",
      falsifier: { path: "target.txt", find: "MAGIC_MARKER", replace: "", expected_exit_code: expectedExitCode },
    },
  };
}

interface Scripted {
  readonly exitCode: number;
  readonly outputTail: string;
}

/** Call 1 (green control) exits 0; call 2 (mutated run) returns `mutated`. */
function makeScriptedExecutor(mutated: Scripted) {
  let calls = 0;
  return async (_spec: VerifySpawnSpec): Promise<Result<VerifyExecutionResult, LoreError>> => {
    calls += 1;
    if (calls === 1) {
      return ok({ exitCode: 0, outputTail: "Tests  1 passed (1)\n", durationMs: 1, timedOut: false });
    }
    return ok({ exitCode: mutated.exitCode, outputTail: mutated.outputTail, durationMs: 1, timedOut: false });
  };
}

async function runFalsify(declared: number, mutated: Scripted) {
  const repoRoot = makeThrowawayGitRepo();
  const criterion = makeCriterion(declared);
  const plan = makeDoc({ id: "plan-1", type: "plan", title: "Plan" });
  const spec = makeDoc({
    id: "spec-1",
    type: "spec",
    title: "Spec",
    extra: { acceptance_criteria: [criterion] },
  });
  const task = makeDoc({ id: "task-1", type: "task", title: "Task", slug: "task-1", parent_id: "plan-1" });
  const bundle: PlanBundle = { plan, spec, tasks: [task] };

  const calls: Array<{ idOrSlug: string; entry: VerifiedEvidenceInput }> = [];
  const recordVerifiedEvidence = async (
    idOrSlug: string,
    entry: VerifiedEvidenceInput,
  ): Promise<Result<DocRecord, LoreError>> => {
    calls.push({ idOrSlug, entry });
    return ok(task);
  };
  const service = new VerifyRunnerService(
    async () => ok(bundle),
    recordVerifiedEvidence,
    makeScriptedExecutor(mutated),
    { tmpDir: tmpdir(),
      repoRoot,
      defaultTimeoutMs: 15000,
      claimTtlMinutes: 120,
      requireCommandApproval: false,
      envAllowlist: [],
      envPassthroughAll: true,
      processEnv: process.env,
    },
  );
  const result = await service.verifyFalsifier(plan.id, criterion.id, {
    explicitTaskIdOrSlug: task.id,
    by: "falsify-discovery-tester",
    nowIso: "2026-10-12T00:00:00.000Z",
  });
  return { result, calls };
}

/** The shared contract of every non-red case: one inconclusive, runner-unattested, attestation-free row. */
function expectOneInconclusiveUnattestedRow(
  outcome: Awaited<ReturnType<typeof runFalsify>>,
  declared: number,
): void {
  expect(outcome.result.ok).toBe(true);
  if (!outcome.result.ok) return;
  expect(outcome.result.value.result).toBe("inconclusive");
  expect(outcome.result.value.expected_exit_code).toBe(declared);
  expect(outcome.calls).toHaveLength(1);
  const entry = outcome.calls[0]!.entry;
  expect(entry.result).toBe("inconclusive");
  expect(entry.capture_source).toBe("runner-unattested");
  expect(entry.attestation).toBeUndefined();
  expect(entry.ac_ref).toBe("AC-DISC-1");
}

describe("AC-EH-10 — falsify path refuses non-reds", () => {
  it("(a) vitest 'No test files found' at exit 1 with declared 1 records inconclusive runner-unattested, never a red", async () => {
    const outcome = await runFalsify(1, {
      exitCode: 1,
      outputTail: "No test files found, exiting with code 1\n",
    });
    expectOneInconclusiveUnattestedRow(outcome, 1);
  });

  it("(b) no expected-fail row is written when the mutated run found no tests", async () => {
    const outcome = await runFalsify(1, {
      exitCode: 1,
      outputTail: "No test files found, exiting with code 1\n",
    });
    expect(outcome.result.ok).toBe(true);
    if (!outcome.result.ok) return;
    expect(outcome.result.value.result).not.toBe("expected-fail");
    expect(outcome.calls.filter((c) => c.entry.result === "expected-fail")).toHaveLength(0);
  });

  it("(c) bun 'did not match any test files' at exit 1 with declared 1 records inconclusive runner-unattested", async () => {
    const outcome = await runFalsify(1, {
      exitCode: 1,
      outputTail: "error: The following filters did not match any test files:\n  tests/target.test.ts\n",
    });
    expectOneInconclusiveUnattestedRow(outcome, 1);
  });

  it("(d) control: a mutated run with a vitest 'Tests  1 failed (1)' summary at exit 1 still records expected-fail with an attestation", async () => {
    const outcome = await runFalsify(1, {
      exitCode: 1,
      outputTail: " FAIL  tests/target.test.ts > target\n\n Test Files  1 failed (1)\n      Tests  1 failed (1)\n",
    });
    expect(outcome.result.ok).toBe(true);
    if (!outcome.result.ok) return;
    expect(outcome.result.value.result).toBe("expected-fail");
    expect(outcome.calls).toHaveLength(1);
    const entry = outcome.calls[0]!.entry;
    expect(entry.result).toBe("expected-fail");
    expect(entry.attestation).toBeDefined();
    expect(entry.capture_source).not.toBe("runner-unattested");
  });

  it("(e) a mutated run exiting 127 with declared 127 records inconclusive runner-unattested, equality with the declaration does not rescue it", async () => {
    const outcome = await runFalsify(127, {
      exitCode: 127,
      outputTail: "sh: bunx: command not found\n",
    });
    expectOneInconclusiveUnattestedRow(outcome, 127);
  });

  it("(e2) a mutated run exiting 126 with declared 126 records inconclusive runner-unattested", async () => {
    const outcome = await runFalsify(126, {
      exitCode: 126,
      outputTail: "sh: ./run-tests: Permission denied\n",
    });
    expectOneInconclusiveUnattestedRow(outcome, 126);
  });
});
