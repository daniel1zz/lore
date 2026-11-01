/**
 * The real `CarryPort` behind `lore assess`: git ancestry reads and the repository's own test selector
 * (`scripts/changed-tests.ts`, AS-24) applied to the changes between a criterion's stamped pass and the assessed commit (#553,
 * spec `spec-a-criterion-s-stamped-pass-carries-to-the-assessed-head` "Carried when untouched").
 *
 * Purpose: answer "does anything between C and H reach this command's test files" without the service importing a script;
 *   the service owns the question, this adapter owns the git reads and the selector call (same split as `assess-selection.ts`).
 * Public surface: createGitCarryPort.
 * Invariants:
 *   - Changed paths are `git diff --name-only --no-renames C H`; the selector runs at H's tree (`selectForCommit`) with C as
 *     the landing parent, so a path deleted between C and H selects through C's tree. Git objects only, never the working tree.
 *   - Test files absent at H are reported `missing` BEFORE any selection (a deleted or renamed test is never "untouched").
 *   - A test file the selector could not parse (malformed `@reads`/`@spawns`) is an `err`: its reach is unknown, so nothing is carried.
 *   - A git or selector failure is an `err` naming it; never a partial answer.
 * Side-effect class: IO (spawns git).
 *
 * @spec_ref spec-a-criterion-s-stamped-pass-carries-to-the-assessed-head (AC-CC-1, BR-1498)
 */

import { execFileSync } from "node:child_process";
import { err, ok, type LoreError, type Result } from "@lore/core";
import type { CarryPort, CarryReach } from "../../service/milestone-attestation-facts.js";
import { selectForCommit } from "../../../../../scripts/changed-tests.js";

const GIT_MAX_BUFFER = 256 * 1024 * 1024;

function git(args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): string {
  return execFileSync("git", [...args], { cwd, env, encoding: "utf8", maxBuffer: GIT_MAX_BUFFER, stdio: ["ignore", "pipe", "pipe"] });
}

function failure(what: string, cause: unknown): Result<never, LoreError> {
  return err({ code: "STORE_ERROR", message: `${what}: ${cause instanceof Error ? cause.message : String(cause)}` });
}

/**
 * Builds the git-backed carry port.
 *
 * @param cwd - any directory inside the project's checkout
 * @param env - the environment git runs with
 * @returns a port; never throws
 */
export function createGitCarryPort(cwd: string, env: NodeJS.ProcessEnv): CarryPort {
  return {
    firstParentLine: async (head): Promise<Result<ReadonlySet<string>, LoreError>> => {
      try {
        const out = git(["rev-list", "--first-parent", head], cwd, env);
        return ok(new Set(out.split("\n").filter((sha) => sha.length > 0)));
      } catch (cause) {
        return failure(`the first-parent line of ${head} could not be read`, cause);
      }
    },
    reachBetween: async ({ from, to, testPaths }): Promise<Result<CarryReach, LoreError>> => {
      try {
        const repoRoot = git(["rev-parse", "--show-toplevel"], cwd, env).trim();
        const present = new Set(git(["ls-tree", "--name-only", "-z", to, "--", ...testPaths], repoRoot, env).split("\0").filter((p) => p.length > 0));
        const missing = testPaths.filter((p) => !present.has(p));
        if (missing.length > 0) return ok({ kind: "missing", paths: missing });
        const changed = git(["diff", "--name-only", "--no-renames", "-z", from, to], repoRoot, env)
          .split("\0")
          .filter((p) => p.length > 0)
          .sort();
        if (changed.length === 0) return ok({ kind: "untouched" });
        const selection = selectForCommit({ repoRoot, commit: to, changedPaths: changed, landingParents: [from] });
        if (selection.unparseable.length > 0) {
          return failure(`the selector could not parse ${selection.unparseable.map((f) => f.path).join(", ")}`, selection.unparseable[0]?.message ?? "malformed declaration");
        }
        const reached = selection.selected.map((file) => file.path).filter((path) => testPaths.includes(path));
        return ok(reached.length > 0 ? { kind: "reached", files: reached } : { kind: "untouched" });
      } catch (cause) {
        return failure(`the selector could not read ${from}..${to}`, cause);
      }
    },
  };
}
