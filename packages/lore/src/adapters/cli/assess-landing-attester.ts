/**
 * The real `LandingAttesterPort`: runs a landed task's script criteria through the trusted `lore verify` runner in a
 * throwaway worktree checked out AT the landing commit, so the attestation's `state_stamp.head_sha` is that commit (BR-1498).
 *
 * Purpose: every landed criterion is attested at its landing without anyone remembering to, so a criterion verified only
 *   in the task's worktree is still decided (pass or fail) at review time.
 * Public surface: createGitLandingAttester.
 * Invariants:
 *   - Commands run in the throwaway worktree of the landing commit (same mechanics as the suite runs: `runInThrowawayWorktree`,
 *     harness-free dependency preparation), never in the shared checkout.
 *   - A criterion whose run cannot be set up or is refused is an `err` naming it; the criterion then stays not-measured.
 *   - Identity is whatever the runner port carries (the detached batch's delegated identity is another session's concern).
 * Side-effect class: IO (git worktree, `bun install`, the verify runner spawns commands and writes attested evidence).
 *
 * @spec_ref spec-the-milestone-review-measures-its-facts-per-landing-and (AC-AF-3, BR-1498)
 */

import { err, ok, type LoreError, type Result } from "@lore/core";
import type { CriterionRerunPort } from "../../service/decision-recheck.js";
import type { LandingAttesterPort } from "../../service/milestone-attestation-facts.js";
import { loreErrorText } from "../../service/suite-result-service.js";
import { prepareDependencies, runInThrowawayWorktree, suiteChildEnv } from "./assess-suite-runner.js";

/**
 * @param cwd - any directory inside the project's checkout
 * @param env - the environment git and dependency installation run with
 * @param rerunnerAt - builds the trusted criterion runner for an execution root (the landing commit's worktree)
 * @returns a port; never throws
 */
export function createGitLandingAttester(
  cwd: string,
  env: NodeJS.ProcessEnv,
  rerunnerAt: (executionRoot: string) => CriterionRerunPort,
): LandingAttesterPort {
  return {
    attestAt: async (landingCommit, criteria): Promise<Result<void, LoreError>> => {
      const ran = await runInThrowawayWorktree(cwd, env, landingCommit, async (root): Promise<Result<void, LoreError>> => {
        const prepared = prepareDependencies(root, suiteChildEnv(env));
        if (prepared !== undefined) return err({ code: "STORE_ERROR", message: prepared });
        const rerunner = rerunnerAt(root);
        for (const criterion of criteria) {
          const result = await rerunner.rerun({ slug: criterion.spec_slug }, criterion.ac_id);
          if (!result.ok) {
            return err({ code: "STORE_ERROR", message: `${criterion.spec_slug}:${criterion.ac_id} could not be attested at ${landingCommit}: ${loreErrorText(result.error)}` });
          }
        }
        return ok(undefined);
      });
      return ran.ok ? ran.value : ran;
    },
  };
}
