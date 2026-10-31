/**
 * The real `TestSelectionPort` behind `lore assess`: the repository's own test selector (`scripts/changed-tests.ts`,
 * AS-24) applied to a plan's landings at the commit that holds the last one (BR-1496, spec
 * `spec-a-plan-s-close-runs-only-the-tests-its-changes-can-reach` "Selection at close").
 *
 * Purpose: let the regression service ask "which tests can this plan's changes reach, at L" without importing a script;
 *   the service owns the question, this adapter owns the git reads and the selector call.
 * Public surface: createGitTestSelection.
 * Invariants:
 *   - Changed paths are the union, over the landings, of `git diff --name-only --no-renames <landing>^1 <landing>`; each
 *     landing's first parent is handed to the selector so a path a landing deleted selects through the parent's tree.
 *   - The selector reads git objects at the commit only, never the working tree (`selectForCommit`).
 *   - The universe count (the M of "N of M") is every test file of the selector's universe in the commit's tree.
 *   - A git or selector failure is an `err` naming it; nothing here returns a partial selection.
 * Side-effect class: IO (spawns git).
 *
 * @spec_ref spec-a-plan-s-close-runs-only-the-tests-its-changes-can-reach (AC-SC-3, AC-SC-4, BR-1496)
 */

import { execFileSync } from "node:child_process";
import { err, ok, type LoreError, type Result } from "@lore/core";
import type { TestSelection, TestSelectionPort } from "../../service/regression-at-head.js";
import { formatCommitAccounting, isTestFile, isUniversePath, selectForCommit } from "../../../../../scripts/changed-tests.js";

const GIT_MAX_BUFFER = 256 * 1024 * 1024;

function git(args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): string {
  return execFileSync("git", [...args], { cwd, env, encoding: "utf8", maxBuffer: GIT_MAX_BUFFER, stdio: ["ignore", "pipe", "pipe"] });
}

function failure(what: string, cause: unknown): Result<never, LoreError> {
  return err({ code: "STORE_ERROR", message: `${what}: ${cause instanceof Error ? cause.message : String(cause)}` });
}

/**
 * Builds the git-backed selection port.
 *
 * @param cwd - any directory inside the project's checkout
 * @param env - the environment git runs with
 * @returns a port; never throws
 */
export function createGitTestSelection(cwd: string, env: NodeJS.ProcessEnv): TestSelectionPort {
  return async ({ commit, landingCommits }): Promise<Result<TestSelection, LoreError>> => {
    try {
      const repoRoot = git(["rev-parse", "--show-toplevel"], cwd, env).trim();
      const changed = new Set<string>();
      const parents: string[] = [];
      for (const landing of landingCommits) {
        // reason: `<landing>^1` is the commit main stood at before the landing (first parent); a landing is always a merge or a commit with one.
        parents.push(git(["rev-parse", "--verify", `${landing}^1`], repoRoot, env).trim());
        const names = git(["diff", "--name-only", "--no-renames", "-z", `${landing}^1`, landing], repoRoot, env);
        for (const path of names.split("\0")) if (path.length > 0) changed.add(path);
      }
      const selection = selectForCommit({ repoRoot, commit, changedPaths: [...changed].sort(), landingParents: parents });
      const listing = git(["ls-tree", "-r", "--name-only", "-z", selection.commit], repoRoot, env);
      const totalTestFiles = listing.split("\0").filter((path) => path.length > 0 && isUniversePath(path) && isTestFile(path)).length;
      return ok({
        commit: selection.commit,
        selected: selection.selected.map((file) => ({ path: file.path, needsCompiledBinary: file.needsCompiledBinary === true })),
        totalTestFiles,
        unparseable: selection.unparseable.map((file) => ({ path: file.path, message: file.message })),
        removedTests: selection.removedTests.map((file) => ({ path: file.path })),
        accounting: `${formatCommitAccounting(selection)}\nchanged paths of the plan's landings: ${String(changed.size)}\ntest files in the selector's universe at the commit: ${String(totalTestFiles)}`,
      });
    } catch (cause) {
      return failure(`the selector could not read ${commit}`, cause);
    }
  };
}
