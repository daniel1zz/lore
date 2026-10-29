/**
 * @spec_ref spec-a-plan-s-tests-and-criteria-are-measured-once-at-its (AC-AO-5, BR-1497)
 *
 * Assessment cost bound end to end: a throwaway git repo whose main carries a plan's landings, the real
 * `SuiteResultService` over the in-memory store, the real git history and file-existence readers, the real
 * `regressionAtHead` and `measureCriteriaAtHead`; only the processes are counted fakes (the suite runner, the single-file
 * runner and the criteria runner). The composition below is the one `lore assess` makes: the head suite (with the criteria
 * in its worktree, or in a worktree of their own when the head result is stored), then regression at the head.
 *
 * Dimensions: HAPPY (green head: exactly one suite run, one run per script criterion, no single-file run), STATE (stored
 * head result: zero suite runs, criteria in a worktree of their own, not counted as a suite run), BOUNDARY (one red file
 * with its transition among 8 commits: at most 3 bisection runs and 4 confirmation runs), REGRESSION (per-landing
 * measurement would perform five suite runs and fail the exact-count assertion).
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
import { createGitFileExistsAt, createGitFirstParentHistory } from "../../src/adapters/cli/assess-regression-git.js";

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
        rows.push({ id: `task@${at}`, spec_slug: c.spec_slug, ac_id: c.ac_id, result: "pass", head_sha: request.commit, recorded_at: at });
      }
      return ok(request.criteria.map((c) => ({ ...c, ran: true as const })));
    },
  };
  return { service, suiteRuns, fileRuns, criteriaRuns, ownWorktrees, store, suiteRunner, criteriaRunner, rows };
}

const scopes: CriterionScope[] = ["AC-1", "AC-2"].map((ac) => ({ spec_slug: "spec-one", ac_id: ac, mode: "script", command: `bun run test:file tests/${ac}.test.ts`, holders: [{ task_slug: "task-one" }] }));

/** One assessment, composed as `lore assess` composes it. */
async function assess(cwd: string, w: World, landings: RegressionLandingInput[]) {
  const looked = await w.service.lookupOrRunWith("main", w.suiteRunner, async (root, commit) => {
    await measureCriteriaAtHead({ scopes, headCommit: commit, runner: w.criteriaRunner, worktreeRoot: root, readRows: async () => ok(w.rows) });
  });
  if (!looked.ok) throw new Error(`lookupOrRunWith failed: ${looked.error.code}`);
  const regression = await regressionAtHead(landings, [], {
    suites: w.service,
    runner: w.suiteRunner,
    headRef: looked.value.result.commit_sha,
    firstParentHistory: createGitFirstParentHistory(cwd, process.env),
    fileExistsAt: createGitFileExistsAt(cwd, process.env),
  });
  if (!regression.ok) throw new Error(`regressionAtHead failed: ${regression.error.code}`);
  return { looked: looked.value, regression: regression.value };
}

const landingsAt = (shas: string[], indexes: number[]): RegressionLandingInput[] =>
  indexes.map((i) => ({ landing_commit: shas[i]!, main_before: shas[i - 1]!, task_slugs: [`task-${String(i)}`] }));

describe("AC-AO-5 assessment cost is bounded end to end", () => {
  it("AC-AO-5 HAPPY: a plan with five landings and a green head costs exactly one suite run, one run per script criterion and no single-file run", async () => {
    const { cwd, shas } = repoWithHistory(8, () => "green");
    const w = world(cwd);
    const { regression } = await assess(cwd, w, landingsAt(shas, [2, 3, 4, 5, 6]));
    expect(regression.charged).toEqual([]);
    // false green guarded: per-landing measurement runs the suite at each of the five landings and fails this exact count
    expect(w.suiteRuns).toEqual([shas[7]]);
    expect(w.criteriaRuns.map((r) => r.ac)).toEqual(["AC-1", "AC-2"]);
    expect(w.criteriaRuns.every((r) => r.commit === shas[7] && r.worktree === "suite")).toBe(true);
    expect(w.fileRuns).toEqual([]);
    expect(w.ownWorktrees).toEqual([]);
  });

  it("AC-AO-5 STATE: when the head's result is stored the suite runs zero times and the criteria run in a worktree of their own", async () => {
    const { cwd, shas } = repoWithHistory(8, () => "green");
    const first = world(cwd);
    await assess(cwd, first, landingsAt(shas, [2, 3, 4, 5, 6]));
    const second = world(cwd, first.store);
    const { looked } = await assess(cwd, second, landingsAt(shas, [2, 3, 4, 5, 6]));
    expect(second.suiteRuns).toEqual([]);
    expect(looked.workIn).toBe("own");
    expect(second.ownWorktrees).toEqual([shas[7]]);
    expect(second.criteriaRuns.map((r) => [r.ac, r.worktree])).toEqual([["AC-1", "own"], ["AC-2", "own"]]);
    expect(second.fileRuns).toEqual([]);
  });

  it("AC-AO-5 BOUNDARY: one red file whose transition is among 8 commits, with no stored lower bound, costs at most 3 bisection runs plus 4 confirmation runs", async () => {
    // commits 0..8; the plan landed at 1 (lower bound = commit 0) and 6; the file turns red at 6, so the range holds 8 commits
    const { cwd, shas } = repoWithHistory(9, (i) => (i < 6 ? "green" : "red"));
    const w = world(cwd);
    const { regression } = await assess(cwd, w, landingsAt(shas, [1, 6]));
    expect(regression.charged).toEqual([{ file: RED_FILE, landing: shas[6] }]);
    expect(w.suiteRuns).toEqual([shas[8]]);
    // 3 bisection runs (ceil(log2(8))) plus 4 fixed runs (head, lower bound, first failing commit, its parent) is the whole budget;
    expect(regressionBisectionBudget(8)).toBe(3 + 4);
    expect(w.fileRuns.length).toBeLessThanOrEqual(3 + 4);
    expect(w.fileRuns.every((r) => r.file === RED_FILE)).toBe(true);
    // the runs are stored with their commit, so a second review reads them and runs nothing
    const before = w.fileRuns.length;
    await assess(cwd, w, landingsAt(shas, [1, 6]));
    expect(w.fileRuns.length).toBe(before);
  });
});
