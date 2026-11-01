/**
 * The real `CriterionContextPort` behind `lore assess`: the repository facts a criterion's judge-verdict key reads (BR-1535,
 * spec-a-re-review-reuses-the-judge-s-verdict-for-every-unit, S2).
 *
 * Purpose: answer "does this path exist at the assessed commit" and "which changed files do this command's test files reach" for the
 *   service without it importing a script. The reach is the repository's own selector (`scripts/changed-tests.ts`) run in reverse:
 *   a changed file is reached when selecting tests for it selects one of the command's test files.
 * Public surface: createGitCriterionContext.
 * Invariants:
 *   - Git objects at the assessed commit only, never the working tree.
 *   - A command that is not nothing but test-runner invocations over test files reaches every changed file (its inputs are unknowable,
 *     so the criterion covers the whole plan diff).
 *   - A git or selector failure is an `err` naming it; never a partial answer.
 * Side-effect class: IO (spawns git).
 */

import { execFileSync } from "node:child_process";
import { err, ok, type LoreError, type Result } from "@lore/core";
import type { CriterionContextPort } from "../../service/judge-unit-keys.js";
import { testPathsOfQualifyingCommand } from "../../service/milestone-attestation-facts.js";
import { selectForCommit } from "../../../../../scripts/changed-tests.js";

const GIT_MAX_BUFFER = 256 * 1024 * 1024;

function failure(what: string, cause: unknown): Result<never, LoreError> {
  return err({ code: "STORE_ERROR", message: `${what}: ${cause instanceof Error ? cause.message : String(cause)}` });
}

/**
 * Builds the git-backed criterion context.
 *
 * @param cwd - any directory inside the project's checkout
 * @param env - the environment git runs with
 * @param commit - the assessed commit
 * @returns a port; never throws
 */
export function createGitCriterionContext(cwd: string, env: NodeJS.ProcessEnv, commit: string): CriterionContextPort {
  const git = (args: readonly string[], dir: string): string => execFileSync("git", [...args], { cwd: dir, env, encoding: "utf8", maxBuffer: GIT_MAX_BUFFER, stdio: ["ignore", "pipe", "pipe"] });
  return {
    pathExists: async (path): Promise<Result<boolean, LoreError>> => {
      try {
        const listed = git(["ls-tree", "--name-only", "-z", commit, "--", path], cwd);
        return ok(listed.split("\0").some((p) => p === path));
      } catch (cause) {
        return failure(`could not read ${path} at ${commit}`, cause);
      }
    },
    reachedChangedFiles: async (command, changedFiles): Promise<Result<readonly string[], LoreError>> => {
      const testPaths = testPathsOfQualifyingCommand(command);
      if (testPaths === undefined) return ok([...changedFiles]);
      try {
        const repoRoot = git(["rev-parse", "--show-toplevel"], cwd).trim();
        const reaches = (paths: readonly string[]): boolean => {
          const selection = selectForCommit({ repoRoot, commit, changedPaths: [...paths], landingParents: [] });
          if (selection.unparseable.length > 0) throw new Error(`the selector could not parse ${selection.unparseable.map((f) => f.path).join(", ")}`);
          return selection.selected.some((file) => testPaths.includes(file.path));
        };
        // reason: one selection over every changed file answers "none reached" at the cost of one tree read; only a hit is narrowed per file.
        if (!reaches(changedFiles)) return ok([]);
        return ok(changedFiles.filter((file) => reaches([file])));
      } catch (cause) {
        return failure(`the selector could not run at ${commit}`, cause);
      }
    },
  };
}
