/**
 * The git-backed `MainFirstParentPort`: which commits are a landing commit or a LATER commit on main's first-parent
 * history (BR-1498).
 *
 * Purpose: decide, by ancestry, whether an attestation's `state_stamp.head_sha` is bound to main from a task's landing
 *   (a worktree commit, or a main commit before the landing, is not).
 * Public surface: createGitMainFirstParent.
 * Invariants:
 *   - Only the first-parent line of `main` counts: a commit reachable only through a merge's second parent (a task
 *     branch's own commits) is never "on main".
 *   - A landing commit that is not on that line gives `ok(null)` (nothing binds to it); an unreadable history is an `err`.
 *   - The history is read once per port (one `git rev-list --first-parent`); a port serves one batch or one review.
 * Side-effect class: IO (spawns git read-only).
 *
 * @spec_ref spec-the-milestone-review-measures-its-facts-per-landing-and (AC-AF-3, BR-1498)
 */

import { spawnSync } from "node:child_process";
import { err, ok, type LoreError, type Result } from "@lore/core";
import type { MainFirstParentPort } from "../../service/milestone-attestation-facts.js";

const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * @param cwd - any directory inside the project's checkout
 * @param env - the environment git runs with
 * @param mainRef - the ref whose first-parent history is main (default `main`)
 * @returns a port; never throws
 */
export function createGitMainFirstParent(cwd: string, env: NodeJS.ProcessEnv, mainRef = "main"): MainFirstParentPort {
  let history: Result<readonly string[], LoreError> | undefined;
  const read = (): Result<readonly string[], LoreError> => {
    if (history !== undefined) return history;
    const ran = spawnSync("git", ["rev-list", "--first-parent", mainRef], { cwd, env, encoding: "utf8", maxBuffer: MAX_BUFFER });
    history =
      ran.status === 0
        ? ok(ran.stdout.split("\n").filter((l) => l.length > 0))
        : err({ code: "STORE_ERROR", message: `could not read ${mainRef}'s first-parent history: ${(ran.stderr ?? "").trim() || (ran.error?.message ?? "git failed")}` });
    return history;
  };
  return {
    commitsFrom: async (landingCommit) => {
      const all = read();
      if (!all.ok) return all;
      // rev-list is newest first: the landing and everything before it in the list is "the landing or later".
      const at = all.value.indexOf(landingCommit);
      return ok(at < 0 ? null : new Set(all.value.slice(0, at + 1)));
    },
  };
}
