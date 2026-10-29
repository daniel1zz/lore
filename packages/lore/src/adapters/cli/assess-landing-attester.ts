/**
 * The real `LandingAttesterPort`: runs a landed task's script criteria through the trusted `lore verify` runner in a
 * throwaway worktree checked out AT the landing commit, so the attestation's `state_stamp.head_sha` is that commit (BR-1498).
 *
 * Purpose: every landed criterion is attested at its landing without anyone remembering to, so a criterion verified only
 *   in the task's worktree is still decided (pass or fail) at review time. With a suite step the attestation shares the
 *   worktree of the landing commit's suite run (BR-1497): one checkout and install per new landing, not two.
 * Public surface: createGitLandingAttester, LandingSuiteStep.
 * Invariants:
 *   - Commands run in a throwaway worktree of the landing commit (same mechanics as the suite runs:
 *     `runInThrowawayWorktree`, harness-free dependency preparation), never in the shared checkout.
 *   - With a suite step the work rides `SuiteResultService.lookupOrRunWith`: the worktree of a FRESH suite run when the
 *     commit has no stored result, a worktree of its own when it has one. The attestation runs exactly once either way.
 *   - A criterion whose run cannot be set up or is refused is an `err` naming it; the criterion then stays not-measured.
 *   - Identity is whatever the runner port carries (the detached batch's delegated identity is another session's concern).
 * Side-effect class: IO (git worktree, `bun install`, the verify runner spawns commands and writes attested evidence).
 *
 * @spec_ref spec-the-milestone-review-measures-its-facts-per-landing-and (AC-AF-3, BR-1497, BR-1498)
 */

import { err, ok, type LoreError, type Result } from "@lore/core";
import type { CriterionRerunPort } from "../../service/decision-recheck.js";
import type { LandingAttesterPort } from "../../service/milestone-attestation-facts.js";
import { loreErrorText, type CommitSuiteRunnerPort, type SuiteResultService } from "../../service/suite-result-service.js";
import { prepareDependencies, runInThrowawayWorktree, suiteChildEnv } from "./assess-suite-runner.js";

/** The suite store and runner the attestation shares a worktree with. */
export interface LandingSuiteStep {
  readonly suites: Pick<SuiteResultService, "lookupOrRunWith">;
  readonly runner: CommitSuiteRunnerPort;
}

/**
 * @param cwd - any directory inside the project's checkout
 * @param env - the environment git and dependency installation run with
 * @param rerunnerAt - builds the trusted criterion runner for an execution root (the landing commit's worktree)
 * @param suiteStep - when given, the attestation runs in the worktree of the landing commit's suite run (see the module header)
 * @returns a port; never throws
 */
export function createGitLandingAttester(
  cwd: string,
  env: NodeJS.ProcessEnv,
  rerunnerAt: (executionRoot: string) => CriterionRerunPort,
  suiteStep?: LandingSuiteStep,
): LandingAttesterPort {
  /** Attests `criteria` through the runner rooted at `root`; the first failure stops it. */
  const attestInRoot = async (
    root: string,
    landingCommit: string,
    criteria: readonly { readonly spec_slug: string; readonly ac_id: string }[],
  ): Promise<Result<void, LoreError>> => {
    const prepared = await prepareDependencies(root, suiteChildEnv(env));
    if (prepared !== undefined) return err({ code: "STORE_ERROR", message: prepared });
    const rerunner = rerunnerAt(root);
    for (const criterion of criteria) {
      const result = await rerunner.rerun({ slug: criterion.spec_slug }, criterion.ac_id);
      if (!result.ok) {
        return err({ code: "STORE_ERROR", message: `${criterion.spec_slug}:${criterion.ac_id} could not be attested at ${landingCommit}: ${loreErrorText(result.error)}` });
      }
    }
    return ok(undefined);
  };

  return {
    attestAt: async (landingCommit, criteria): Promise<Result<void, LoreError>> => {
      if (suiteStep === undefined) {
        const ran = await runInThrowawayWorktree(cwd, env, landingCommit, (root) => attestInRoot(root, landingCommit, criteria));
        return ran.ok ? ran.value : ran;
      }
      let outcome: Result<void, LoreError> | undefined;
      const looked = await suiteStep.suites.lookupOrRunWith(landingCommit, suiteStep.runner, async (root) => {
        outcome = await attestInRoot(root, landingCommit, criteria);
      });
      if (!looked.ok) return looked;
      if (looked.value.workError !== undefined) return err(looked.value.workError);
      return outcome ?? err({ code: "STORE_ERROR", message: `the attestation at ${landingCommit} did not run` });
    },
  };
}
