/**
 * The git reads regression at the assessed commit needs: main's first-parent history and "does this file exist at this commit".
 *
 * Purpose: give `regressionAtHead` its history and file-existence ports over real git (BR-1496); replaces the clearing
 *   lookup of regression per landing.
 * Public surface: createGitFirstParentHistory, createGitFileExistsAt, createGitChangedFilesSince.
 * Invariants:
 *   - History order is `git rev-list --first-parent --reverse <ref>` (oldest first), never `measured_at`.
 *   - Every git failure is an `err` naming the command's stderr; nothing is read as "empty" or "absent" on failure.
 *   - A file is absent at a commit only when `git ls-tree` of that commit lists no such path; any git failure is an `err`.
 * Side-effect class: IO (runs read-only `git` commands in `cwd`).
 *
 * @spec_ref spec-a-plan-s-tests-and-criteria-are-measured-once-at-its (AC-AO-1, BR-1496)
 */

import { spawnSync } from "node:child_process";
import { err, ok, type LoreError, type Result } from "@lore/core";

const gitFailure = (what: string, stderr: string | null): LoreError => ({ code: "STORE_ERROR", message: `${what}: ${(stderr ?? "").trim()}` });

/**
 * Main's first-parent history up to `ref`, oldest first.
 *
 * @param cwd - any directory inside the checkout
 * @param env - environment for git
 */
export function createGitFirstParentHistory(cwd: string, env: NodeJS.ProcessEnv): (ref: string) => Promise<Result<readonly string[], LoreError>> {
  return async (ref) => {
    const history = spawnSync("git", ["rev-list", "--first-parent", "--reverse", ref], { cwd, env, encoding: "utf8" });
    if (history.status !== 0) return err(gitFailure(`cannot read ${ref}'s first-parent history`, history.stderr));
    return ok(history.stdout.split("\n").filter((line) => line.length > 0));
  };
}

/**
 * Whether a repo-relative file exists at a commit.
 *
 * @param cwd - any directory inside the checkout
 * @param env - environment for git
 */
export function createGitFileExistsAt(cwd: string, env: NodeJS.ProcessEnv): (commit: string, file: string) => Promise<Result<boolean, LoreError>> {
  return async (commit, file) => {
    // reason: `ls-tree` separates "the path is not in that tree" (exit 0, empty) from "that commit does not resolve"
    // (exit 128); `cat-file -e` reports both as the same "exists on disk, but not in" text.
    const listed = spawnSync("git", ["ls-tree", "--name-only", commit, "--", file], { cwd, env, encoding: "utf8" });
    if (listed.status !== 0) return err(gitFailure(`cannot tell whether ${file} exists at ${commit}`, listed.stderr));
    return ok(listed.stdout.split("\n").some((line) => line === file));
  };
}

/**
 * The files changed on `ref` since `commit` (`git diff --name-only <commit>..<ref>`), repo-relative.
 *
 * @param cwd - any directory inside the checkout
 * @param env - environment for git
 * @param ref - the ref the changes are read up to (`main`)
 */
export function createGitChangedFilesSince(cwd: string, env: NodeJS.ProcessEnv, ref = "main"): (commit: string) => Promise<Result<readonly string[], LoreError>> {
  return async (commit) => {
    const diff = spawnSync("git", ["diff", "--name-only", `${commit}..${ref}`], { cwd, env, encoding: "utf8" });
    if (diff.status !== 0) return err(gitFailure(`cannot list the files changed between ${commit} and ${ref}`, diff.stderr));
    return ok(diff.stdout.split("\n").filter((line) => line.length > 0));
  };
}
