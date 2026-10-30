/**
 * @spec_ref spec-a-plan-s-tests-and-criteria-are-measured-once-at-its (BR-1496)
 *
 * `createGitFirstParentCommitContaining` over a real throwaway repo: branch X merged into branch Y and Y landed on main, so
 * X's head is off main's first-parent chain; the answer is the main commit that merged Y.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createGitFirstParentCommitContaining } from "../../../../src/adapters/cli/assess-regression-git.js";

const root = mkdtempSync(join(tmpdir(), "lore-containing-"));
const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (...args: string[]): string => {
  const r = spawnSync("git", args, { cwd: root, env, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const commit = (name: string): string => {
  writeFileSync(join(root, name), name);
  git("add", name);
  git("commit", "-m", name);
  return git("rev-parse", "HEAD");
};

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("first-parent commit containing a landing", () => {
  it("a branch merged into another branch that landed maps to the main merge commit that brought it in", async () => {
    git("init", "-b", "main");
    commit("base");
    git("checkout", "-b", "y");
    commit("y1");
    git("checkout", "-b", "x");
    const xHead = commit("x1");
    git("checkout", "y");
    git("merge", "--no-ff", "-m", "merge x into y", "x");
    git("checkout", "main");
    commit("main2");
    git("merge", "--no-ff", "-m", "land y", "y");
    const landed = git("rev-parse", "HEAD");
    commit("after");
    const containing = createGitFirstParentCommitContaining(root, env);
    const found = await containing(xHead, "main");
    expect(found).toEqual({ ok: true, value: landed });
  });

  it("a commit that is not below the ref, or does not resolve, has no containing commit", async () => {
    git("checkout", "-b", "stray");
    const stray = commit("stray1");
    git("checkout", "main");
    const containing = createGitFirstParentCommitContaining(root, env);
    expect(await containing(stray, "main")).toEqual({ ok: true, value: undefined });
    expect(await containing("0".repeat(40), "main")).toEqual({ ok: true, value: undefined });
  });
});
