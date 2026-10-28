/**
 * The real "newest stored main suite result at or after the plan's last landing" lookup for regression per landing.
 *
 * Purpose: decide which stored suite result a landing regression is cleared against (BR-1496): the newest measured
 *   result whose commit is on main's first-parent history and is the plan's last landing or a later main commit.
 * Public surface: createGitClearingSourceFinder.
 * Invariants:
 *   - Order is main's first-parent history (`git rev-list --first-parent <ref>`), never `measured_at`.
 *   - A landing commit that is not on main's first-parent history makes the answer `err` (undeterminable), not "none".
 *   - Only `measured` results qualify; an unrunnable one checked nothing.
 * Side-effect class: IO (runs `git` read-only commands in `cwd`).
 *
 * @spec_ref spec-the-milestone-review-measures-its-facts-per-landing-and (AC-AF-1, BR-1496)
 */

import { spawnSync } from "node:child_process";
import { err, ok, type LoreError, type Result } from "@lore/core";
import type { SuiteResultRecord } from "../../store/store-interface.js";
import type { RegressionClearingSource } from "../../service/regression-per-landing.js";

/**
 * Builds the clearing lookup over the stored results.
 *
 * @param cwd - any directory inside the checkout
 * @param env - environment for git
 * @param listResults - every stored suite result, oldest first
 * @param mainRef - the ref whose first-parent history is "main" (default `main`)
 */
export function createGitClearingSourceFinder(
  cwd: string,
  env: NodeJS.ProcessEnv,
  listResults: () => Promise<Result<SuiteResultRecord[], LoreError>>,
  mainRef = "main",
): (landingCommits: readonly string[]) => Promise<Result<RegressionClearingSource | null, LoreError>> {
  return async (landingCommits) => {
    const history = spawnSync("git", ["rev-list", "--first-parent", mainRef], { cwd, env, encoding: "utf8" });
    if (history.status !== 0) {
      return err({ code: "STORE_ERROR", message: `cannot read ${mainRef}'s first-parent history: ${(history.stderr ?? "").trim()}` });
    }
    const position = new Map<string, number>();
    history.stdout.split("\n").filter((l) => l.length > 0).forEach((commit, index) => position.set(commit, index));
    // rev-list is newest first: the LAST landing is the one with the smallest index.
    let lastLandingIndex: number | undefined;
    for (const commit of landingCommits) {
      const index = position.get(commit);
      if (index === undefined) {
        return err({ code: "STORE_ERROR", message: `landing ${commit} is not on ${mainRef}'s first-parent history` });
      }
      lastLandingIndex = lastLandingIndex === undefined ? index : Math.min(lastLandingIndex, index);
    }
    if (lastLandingIndex === undefined) return ok(null);
    const stored = await listResults();
    if (!stored.ok) return stored;
    let best: { index: number; result: SuiteResultRecord } | undefined;
    for (const result of stored.value) {
      if (result.status !== "measured") continue;
      const index = position.get(result.commit_sha);
      if (index === undefined || index > lastLandingIndex) continue;
      if (best === undefined || index < best.index) best = { index, result };
    }
    return ok(best === undefined ? null : { commit: best.result.commit_sha, result: best.result });
  };
}
