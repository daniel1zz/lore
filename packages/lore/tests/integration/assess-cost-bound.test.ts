/**
 * @spec_ref spec-a-plan-s-tests-and-criteria-are-measured-once-at-its (AC-AO-5, BR-1497)
 *
 * Assessment cost bound end to end: a throwaway git repo whose main carries a plan's landings, the real
 * `SuiteResultService` over the in-memory store, the real git history and file-existence readers, the real
 * `regressionAtHead` and `measureCriteriaAtHead`; only the processes are counted fakes (the runner and the criteria runner)
 * and the selector (named by `selectTests`). The composition below is the one `lore assess` makes since
 * `spec-a-plan-s-close-runs-only-the-tests-its-changes-can-reach`: the head-bound criteria in a worktree of head, then
 * regression on the selection at the commit of the last landing. NO full suite runs on any path, so the "exactly one suite
 * run" claim of AC-AO-5's statement is retired: this file asserts zero (the statement awaits a supersede).
 *
 * Dimensions: HAPPY (green head: zero suite runs, one batched run at L, one run per script criterion), STATE (stored
 * results at L: no test runs, criteria in a worktree of their own), BOUNDARY (one red file with its transition among 8
 * commits: at most 3 bisection runs and 4 confirmation runs plus the batches), REGRESSION (per-landing measurement would
 * run at five commits and fail the exact-run assertion).
 */

import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok, type LoreError, type Result } from "@lore/core";
import { InMemoryStore } from "../../src/store/in-memory-store.js";
import {
  SuiteResultService,
  type CommitSuiteRunnerPort,
  type FileRunOutcome,
} from "../../src/service/suite-result-service.js";
import type { SuiteRun } from "../../src/service/milestone-review-inputs.js";
import { regressionAtHead, regressionBisectionBudget, type RegressionLandingInput } from "../../src/service/regression-at-head.js";
import { measureCriteriaAtHead, type AttestationRow, type CriterionScope, type HeadCriteriaRunnerPort } from "../../src/service/milestone-attestation-facts.js";
import { createGitFileExistsAt, createGitFirstParentCommitContaining, createGitFirstParentHistory } from "../../src/adapters/cli/assess-regression-git.js";

const RED_FILE = "tests/red.test.ts";
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** A throwaway repo whose main has `commits` commits; each commit writes `RED_FILE` per `contentAt(index)`. */
function repoWithHistory(commits: number, contentAt: (index: number) => string | undefined): { cwd: string; shas: string[] } {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "assess-cost-")));
  dirs.push(cwd);
  git(cwd, ["init", "-q", "-b", "main"]);
  git(cwd, ["config", "user.email", "t@example.invalid"]);
  git(cwd, ["config", "user.name", "T"]);
  git(cwd, ["config", "commit.gpgsign", "false"]);
  mkdirSync(join(cwd, "tests"));
  const shas: string[] = [];
  for (let index = 0; index < commits; index++) {
    writeFileSync(join(cwd, "step.txt"), `${String(index)}\n`);
    const content = contentAt(index);
    if (content !== undefined) writeFileSync(join(cwd, RED_FILE), `${content}\n`);
    git(cwd, ["add", "-A"]);
    git(cwd, ["commit", "-q", "-m", `c${String(index)}`]);
    shas.push(git(cwd, ["rev-parse", "HEAD"]));
  }
  return { cwd, shas };
}

const stateAt = (cwd: string, commit: string): "red" | "green" | "absent" => {
  try {
    return git(cwd, ["show", `${commit}:${RED_FILE}`]) === "red" ? "red" : "green";
  } catch {
    return "absent";
  }
};

interface World {
  readonly service: SuiteResultService;
  readonly suiteRuns: string[];
  readonly fileRuns: { commit: string; file: string }[];
  readonly criteriaRuns: { commit: string; ac: string; worktree: "suite" | "own" }[];
  readonly ownWorktrees: string[];
  readonly store: InMemoryStore;
  readonly suiteRunner: CommitSuiteRunnerPort;
  readonly criteriaRunner: HeadCriteriaRunnerPort;
  readonly rows: AttestationRow[];
}

function world(cwd: string, shared?: InMemoryStore): World {
  const store = shared ?? new InMemoryStore();
  let n = 0;
  const service = new SuiteResultService({ store, now: () => `2026-10-29T10:00:00.${String(++n).padStart(3, "0")}Z`, newId: () => `suite-cost-${String(++n)}`, clockMs: () => n * 10 });
  const suiteRuns: string[] = [];
  const fileRuns: World["fileRuns"] = [];
  const criteriaRuns: World["criteriaRuns"] = [];
  const ownWorktrees: string[] = [];
  const rows: AttestationRow[] = [];
  const suiteRunner: CommitSuiteRunnerPort = {
    resolveCommit: async (ref) => ok({ commit: git(cwd, ["rev-parse", ref === "main" ? "main" : ref]), tree: git(cwd, ["rev-parse", `${ref === "main" ? "main" : ref}^{tree}`]) }),
    runSuite: async (commit, inWorktree): Promise<Result<SuiteRun, LoreError>> => {
      suiteRuns.push(commit);
      const red = stateAt(cwd, commit) === "red";
      if (inWorktree !== undefined) await inWorktree("/fake/suite-worktree", commit);
      return ok({
        status: "measured",
        commit,
        commands: [{ command: "bun run test", exit_code: red ? 1 : 0, output_tail: "" }],
        skipped: [],
        failing_test_files: red ? [{ file: RED_FILE, imports: [] }] : [],
      });
    },
    runFiles: async (commit, files) => {
      for (const file of files) fileRuns.push({ commit, file });
      return ok(files.map((file): FileRunOutcome => ({ file, exit_code: stateAt(cwd, commit) === "red" ? 1 : 0, output_tail: "", duration_ms: 1 })));
    },
    // reason: the batched search runs files together (spec-a-plan-s-regression-reuses-a-stored-suite-that-contains); one file is one run here either way.
    runFilesTogether: async (commit, files) => {
      for (const file of files) fileRuns.push({ commit, file });
      return ok(files.map((file): FileRunOutcome => ({ file, exit_code: stateAt(cwd, commit) === "red" ? 1 : 0, output_tail: "", duration_ms: 1 })));
    },
    withWorktree: async (commit, work) => {
      ownWorktrees.push(commit);
      await work("/fake/own-worktree");
      return ok(undefined);
    },
  };
  const criteriaRunner: HeadCriteriaRunnerPort = {
    attestAtHead: async (request) => {
      const where: "suite" | "own" = request.worktreeRoot === "/fake/suite-worktree" ? "suite" : "own";
      for (const c of request.criteria) {
        criteriaRuns.push({ commit: request.commit, ac: c.ac_id, worktree: where });
        const at = `2026-10-29T11:00:${String(rows.length).padStart(2, "0")}.000Z`;
        rows.push({ id: `task@${at}`, doc_slug: c.doc_slug, ac_id: c.ac_id, result: "pass", head_sha: request.commit, recorded_at: at });
      }
      return ok(request.criteria.map((c) => ({ ...c, ran: true as const })));
    },
  };
  return { service, suiteRuns, fileRuns, criteriaRuns, ownWorktrees, store, suiteRunner, criteriaRunner, rows };
}

const scopes: CriterionScope[] = ["AC-1", "AC-2"].map((ac) => ({ doc_slug: "spec-one", ac_id: ac, mode: "script", command: `bun run test:file tests/${ac}.test.ts`, holders: [{ task_slug: "task-one" }] }));

/** One assessment, composed as `lore assess` composes it: the head-bound criteria in a worktree of head, then regression on the selection at L. */
async function assess(cwd: string, w: World, landings: RegressionLandingInput[]) {
  const head = git(cwd, ["rev-parse", "main"]);
  const worked = await w.suiteRunner.withWorktree!(head, async (root) => {
    await measureCriteriaAtHead({ scopes, headCommit: head, runner: w.criteriaRunner, worktreeRoot: root, readRows: async () => ok(w.rows) });
  });
  if (!worked.ok) throw new Error(`withWorktree failed: ${worked.error.code}`);
  const regression = await regressionAtHead(landings, [], {
    suites: w.service,
    runner: w.suiteRunner,
    // reason: the selector is faked (its own tests are scripts/tests/changed-tests-commit-mode.test.ts); it names the one test file at the commit.
    selectTests: async ({ commit }) =>
      ok({ commit, selected: [{ path: RED_FILE, needsCompiledBinary: false }], totalTestFiles: 1, unparseable: [], removedTests: [], accounting: `commit: ${commit}` }),
    headRef: head,
    firstParentHistory: createGitFirstParentHistory(cwd, process.env),
    fileExistsAt: createGitFileExistsAt(cwd, process.env),
    firstParentCommitContaining: createGitFirstParentCommitContaining(cwd, process.env),
  });
  if (!regression.ok) throw new Error(`regressionAtHead failed: ${regression.error.code}`);
  return { regression: regression.value };
}

const landingsAt = (shas: string[], indexes: number[]): RegressionLandingInput[] =>
  indexes.map((i) => ({ landing_commit: shas[i]!, main_before: shas[i - 1]!, task_slugs: [`task-${String(i)}`] }));

describe("AC-AO-5 assessment cost is bounded end to end", () => {
  it("AC-AO-5 HAPPY: a plan with five landings and a green head runs no full suite, one batched run of the selection at the last landing, one run per script criterion", async () => {
    const { cwd, shas } = repoWithHistory(8, () => "green");
    const w = world(cwd);
    const { regression } = await assess(cwd, w, landingsAt(shas, [2, 3, 4, 5, 6]));
    expect(regression.charged).toEqual([]);
    // false green guarded: per-landing measurement would run at each of the five landings; the selection runs once, at L (the last landing)
    expect(w.suiteRuns).toEqual([]);
    expect(w.fileRuns).toEqual([{ commit: shas[6], file: RED_FILE }]);
    expect(w.criteriaRuns.map((r) => r.ac)).toEqual(["AC-1", "AC-2"]);
    expect(w.criteriaRuns.every((r) => r.commit === shas[7] && r.worktree === "own")).toBe(true);
    expect(w.ownWorktrees).toEqual([shas[7]]);
  });

  it("AC-AO-5 STATE: when the selection's results at L are stored a second review runs no test; the head-bound criteria run again in a worktree of their own", async () => {
    const { cwd, shas } = repoWithHistory(8, () => "green");
    const first = world(cwd);
    await assess(cwd, first, landingsAt(shas, [2, 3, 4, 5, 6]));
    const second = world(cwd, first.store);
    await assess(cwd, second, landingsAt(shas, [2, 3, 4, 5, 6]));
    expect(second.suiteRuns).toEqual([]);
    expect(second.fileRuns).toEqual([]);
    expect(second.ownWorktrees).toEqual([shas[7]]);
    expect(second.criteriaRuns.map((r) => [r.ac, r.worktree])).toEqual([["AC-1", "own"], ["AC-2", "own"]]);
  });

  it("AC-AO-5 BOUNDARY: one red file whose transition is among 8 commits, with no stored lower bound, costs at most 3 bisection runs plus 4 confirmation runs", async () => {
    // commits 0..8; the plan landed at 1 (lower bound = commit 0) and 6; the file turns red at 6, so the range holds 8 commits
    const { cwd, shas } = repoWithHistory(9, (i) => (i < 6 ? "green" : "red"));
    const w = world(cwd);
    const { regression } = await assess(cwd, w, landingsAt(shas, [1, 6]));
    expect(regression.charged).toEqual([{ file: RED_FILE, landing: shas[6] }]);
    expect(w.suiteRuns).toEqual([]);
    // 3 bisection runs (ceil(log2(8))) plus 4 fixed runs (head, lower bound, first failing commit, its parent) is the whole budget,
    // plus the batched run of the selection at L and the batched recheck at head;
    expect(regressionBisectionBudget(8)).toBe(3 + 4);
    expect(w.fileRuns.length).toBeLessThanOrEqual(3 + 4 + 2);
    expect(w.fileRuns.every((r) => r.file === RED_FILE)).toBe(true);
    // the runs are stored with their commit, so a second review reads them and runs nothing
    const before = w.fileRuns.length;
    await assess(cwd, w, landingsAt(shas, [1, 6]));
    expect(w.fileRuns.length).toBe(before);
  });
});
