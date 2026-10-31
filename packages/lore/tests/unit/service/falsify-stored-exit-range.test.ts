// @spawns-external git builds a throwaway git repository the test runs against
/**
 * AC-EH-5 (a)-(e) (spec-evidence-labels-and-reds-are-honest, BR-1074) — `VerifyRunnerService.verifyFalsifier`
 * refuses a STORED out-of-range falsifier expected exit code BEFORE anything runs: no control run, no evidence
 * row, and an error that names the correcting command (`lore ac set` ... `--falsifier-exit-code`).
 *
 * Fixtures: a recording executor and a recording evidence recorder (pattern: attested-red.test.ts); the stored
 * 0 / 256 sit directly in the in-memory spec document (a legacy value declared before outcomes had to be 1..255).
 * A throwaway `mkdtemp` + `git init` repo backs `repoRoot` — never this repo's working tree.
 *
 * Dimension mapping:
 *   HAPPY:      (e) a stored 1 proceeds: the executor is called at least once (the green control runs)
 *   NEGATIVE:   (a) a stored 0 -> VALIDATION_ERROR naming 'lore ac set' and '--falsifier-exit-code'
 *   BOUNDARY:   (d) a stored 256 (just above the range) is refused the same way; (e) 1 is the inside edge
 *   ERROR:      (a) the refusal is a VALIDATION_ERROR result, never a thrown error or an inconclusive row
 *   STATE:      (b) the executor was called 0 times and (c) the recorder 0 times — nothing ran, nothing written
 *   REGRESSION: (e) the in-range path still reaches the control (the guard does not block valid declarations)
 *
 * RED-first: against current code a stored 0 reaches the green control, so (b) observes >= 1 executor call and
 * (a) observes a non-VALIDATION_ERROR outcome — ASSERTION failures.
 *
 * Note: the AC text says `verifyFalsify`; the service method is `verifyFalsifier`.
 *
 * @spec_ref AC-EH-5 — spec-evidence-labels-and-reds-are-honest; BR-1074
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
  const repoRoot = mkdtempSync(join(tmpdir(), "lore-falsify-stored-range-"));
  execFileSync("git", ["init", "-q"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.name", "Stored Range Test"], { cwd: repoRoot });
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
    created_at: "2026-08-10T00:00:00.000Z",
    updated_at: "2026-08-10T00:00:00.000Z",
    created_by: "alice",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
    ...overrides,
  } as DocRecord;
}

function criterionWithStoredExit(storedExitCode: number): AcceptanceCriterion {
  return {
    id: "AC-FALSIFY-1",
    statement: "target.txt contains MAGIC_MARKER",
    verify: {
      mode: "script",
      oracle: "test",
      command: "grep -q MAGIC_MARKER target.txt && exit 0 || exit 7",
      falsifier: { path: "target.txt", find: "MAGIC_MARKER", replace: "REMOVED", expected_exit_code: storedExitCode },
    },
  } as AcceptanceCriterion;
}

function makeBundle(criterion: AcceptanceCriterion): PlanBundle {
  return {
    plan: makeDoc({ id: "plan-1", type: "plan", title: "Plan" }),
    spec: makeDoc({ id: "spec-1", type: "spec", title: "Spec", extra: { acceptance_criteria: [criterion] } }),
    tasks: [makeDoc({ id: "task-1", type: "task", title: "Task", slug: "task-1", parent_id: "plan-1" })],
  };
}

/** Recording executor: counts calls, always reports a clean exit 0 (the control would pass if it ran). */
function makeRecordingExecutor() {
  const calls: VerifySpawnSpec[] = [];
  const fn = async (spec: VerifySpawnSpec): Promise<Result<VerifyExecutionResult, LoreError>> => {
    calls.push(spec);
    return ok({ exitCode: 0, outputTail: "", durationMs: 1, timedOut: false });
  };
  return { fn, calls };
}

function makeRecorder() {
  const calls: Array<{ idOrSlug: string; entry: VerifiedEvidenceInput }> = [];
  const fn = async (idOrSlug: string, entry: VerifiedEvidenceInput): Promise<Result<DocRecord, LoreError>> => {
    calls.push({ idOrSlug, entry });
    return ok(makeDoc({ id: "task-1", type: "task", title: "Task" }));
  };
  return { fn, calls };
}

async function runFalsify(storedExitCode: number) {
  const repoRoot = makeThrowawayGitRepo();
  const executor = makeRecordingExecutor();
  const recorder = makeRecorder();
  const bundle = makeBundle(criterionWithStoredExit(storedExitCode));
  const service = new VerifyRunnerService(async () => ok(bundle), recorder.fn, executor.fn, { tmpDir: tmpdir(),
    repoRoot,
    defaultTimeoutMs: 15000,
    claimTtlMinutes: 120,
    requireCommandApproval: false,
    envAllowlist: [],
    envPassthroughAll: true,
    processEnv: process.env,
  });
  const result = await service.verifyFalsifier("plan-1", "AC-FALSIFY-1", {
    explicitTaskIdOrSlug: "task-1",
    by: "stored-range-tester",
    nowIso: "2026-08-10T00:00:00.000Z",
  });
  return { result, executor, recorder };
}

function expectCorrectingRefusal(result: Result<unknown, LoreError>): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe("VALIDATION_ERROR");
  if (result.error.code !== "VALIDATION_ERROR") return;
  expect(result.error.message).toContain("lore ac set");
  expect(result.error.message).toContain("--falsifier-exit-code");
}

describe("AC-EH-5 — verifyFalsifier refuses a stored out-of-range falsifier before running", () => {
  it("(a) a stored 0: VALIDATION_ERROR naming 'lore ac set' and '--falsifier-exit-code'", async () => {
    const { result } = await runFalsify(0);
    expectCorrectingRefusal(result);
  });

  it("(b) a stored 0: the executor was called 0 times (nothing ran)", async () => {
    const { executor } = await runFalsify(0);
    expect(executor.calls).toHaveLength(0);
  });

  it("(c) a stored 0: the evidence recorder was called 0 times (no row written)", async () => {
    const { recorder } = await runFalsify(0);
    expect(recorder.calls).toHaveLength(0);
  });

  it("(d) a stored 256: the same refusal, executor 0 calls, recorder 0 calls", async () => {
    const { result, executor, recorder } = await runFalsify(256);
    expectCorrectingRefusal(result);
    expect(executor.calls).toHaveLength(0);
    expect(recorder.calls).toHaveLength(0);
  });

  it("(e) a stored 1 proceeds: the executor runs the control at least once", async () => {
    const { executor } = await runFalsify(1);
    expect(executor.calls.length).toBeGreaterThanOrEqual(1);
  });
});
