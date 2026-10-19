/**
 * @spec_ref task-skill-fix-lore-assess-derives-a-plan-s-diff-without-the
 *
 * `lore assess` derives a plan's diff from each task's recorded `commit_range` (base..head of the
 * task branch). A task branch merges main into itself (lore integrate's conflict-resolution step),
 * so `base..head` also contains every foreign commit main contributed; the derived diff then
 * blamed the plan for a peer session's unrelated changes and the budget truncated the plan's own
 * source out. The rule under test: a task's own commits are the non-merge commits on the
 * FIRST-PARENT chain of its head; everything merged in from main is excluded and COUNTED.
 *
 * Fixture reproduces the integrate model in a throwaway repo:
 *   main: base commit -> (foreign doc change lands on main)
 *   task branch (from base): own source commit -> `git merge main` (brings the foreign doc) -> own test commit
 *   landing: `git merge --no-ff <branch>` into main (a merge commit)
 *
 * Six dimensions: HAPPY (own files present, foreign absent, count named), NEGATIVE (foreign
 * content absent), BOUNDARY (a branch that never merged main excludes 0), STATE (several merges
 * of main counted together), ERROR (an unknown range head degrades to the slug search with a
 * warning), REGRESSION (the not-measured/slug path still diffs the landing merge against its
 * first parent, which is exactly the branch's change).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import * as derivation from "../../../src/adapters/cli/assess-commit-derivation.js";

const { deriveCommitSetForPlan } = derivation;

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Tester",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "Tester",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

let repo: string;

function git(...args: string[]): string {
  const r = spawnSync("git", args, { cwd: repo, encoding: "utf8", env: ENV });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function commitFile(path: string, content: string, message: string): string {
  mkdirSync(join(repo, path, ".."), { recursive: true });
  writeFileSync(join(repo, path), content);
  git("add", path);
  git("commit", "-q", "-m", message);
  return git("rev-parse", "HEAD");
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "lore-assess-merged-main-"));
  git("init", "-q", "-b", "main");
  git("config", "commit.gpgsign", "false");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

/** Builds the integrate-model history; returns the claim base and the task branch head. */
function buildIntegrateHistory(opts: { mergeMainTimes: number }): { base: string; head: string } {
  const base = commitFile("README.md", "base\n", "chore: base");
  git("checkout", "-q", "-b", "task-branch");
  commitFile("src/own-feature.ts", "export const own = 1;\n", "feat: own source");
  for (let i = 0; i < opts.mergeMainTimes; i++) {
    git("checkout", "-q", "main");
    commitFile(`docs/foreign-${String(i)}.md`, `foreign ${String(i)}\n`, `docs: foreign rewrite ${String(i)}`);
    git("checkout", "-q", "task-branch");
    git("merge", "-q", "--no-ff", "-m", "Merge branch 'main' into task-branch", "main");
  }
  commitFile("tests/own-feature.test.ts", "// test\n", "test: own test");
  const head = git("rev-parse", "HEAD");
  git("checkout", "-q", "main");
  git("merge", "-q", "--no-ff", "-m", "merge(task-branch): land task", "task-branch");
  return { base, head };
}

describe("assess plan diff excludes commits merged in from main", () => {
  it("AC-HAPPY: derived diff holds the task's own files, not the foreign change, and names the excluded count", () => {
    const { base, head } = buildIntegrateHistory({ mergeMainTimes: 1 });
    const result = deriveCommitSetForPlan(repo, ["task-x"], true, new Map([["task-x", { base, head }]]));

    expect(result.status).toBe("derived");
    expect(result.diff_text).toContain("src/own-feature.ts");
    expect(result.diff_text).toContain("tests/own-feature.test.ts");
    expect(result.diff_text).not.toContain("docs/foreign-0.md");
    expect(result.commits.map((c) => c.subject)).toEqual(["feat: own source", "test: own test"]);
    // 1 foreign commit + the merge commit that brought it in.
    expect(result.excluded_merged_commit_count).toBe(2);
    expect(derivation.describeCommitCount(result.commits.length, result.excluded_merged_commit_count)).toBe(
      "2 commit(s), excluding 2 merged in from main",
    );
  });

  it("AC-STATE: several merges of main are all excluded and counted together", () => {
    const { base, head } = buildIntegrateHistory({ mergeMainTimes: 3 });
    const result = deriveCommitSetForPlan(repo, ["task-x"], true, new Map([["task-x", { base, head }]]));

    expect(result.diff_text).not.toContain("docs/foreign-");
    expect(result.commits).toHaveLength(2);
    expect(result.excluded_merged_commit_count).toBe(6);
  });

  it("AC-BOUNDARY: a branch that never merged main excludes zero", () => {
    const { base, head } = buildIntegrateHistory({ mergeMainTimes: 0 });
    const result = deriveCommitSetForPlan(repo, ["task-x"], true, new Map([["task-x", { base, head }]]));

    expect(result.commits).toHaveLength(2);
    expect(result.excluded_merged_commit_count).toBe(0);
    expect(result.diff_text).toContain("src/own-feature.ts");
  });

  it("AC-ERROR: a recorded head that does not exist falls back to the slug search with a warning", () => {
    const { base } = buildIntegrateHistory({ mergeMainTimes: 1 });
    const result = deriveCommitSetForPlan(
      repo,
      ["task-x"],
      true,
      new Map([["task-x", { base, head: "0123456789012345678901234567890123456789" }]]),
    );

    expect(result.attribution["task-x"]).toBe("not_measured");
    expect(result.warnings.join("\n")).toContain("falling back to the slug search");
    expect(result.excluded_merged_commit_count).toBe(0);
  });

  it("AC-REGRESSION: the slug path diffs the landing merge against its first parent (the branch's own change only)", () => {
    buildIntegrateHistory({ mergeMainTimes: 1 });
    const result = deriveCommitSetForPlan(repo, ["task-branch"], true, new Map());

    expect(result.attribution["task-branch"]).toBe("slug_match");
    expect(result.diff_text).toContain("src/own-feature.ts");
    expect(result.diff_text).not.toContain("docs/foreign-0.md");
  });
});
