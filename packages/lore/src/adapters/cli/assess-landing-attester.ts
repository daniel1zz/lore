/**
 * The real `HeadCriteriaRunnerPort`: runs a plan's script criteria through the trusted `lore verify` runner at the
 * assessed commit, so each attestation's `state_stamp.head_sha` is that commit (BR-1498, AC-AO-3).
 *
 * Purpose: criteria are measured once, at main's head when the review runs, never per landing. The criteria run in the
 *   review's suite worktree when one exists (`worktreeRoot`), else in a throwaway worktree at the commit made for the
 *   criteria alone. (File name kept from the per-landing attester it replaced; the anchors name it.)
 * Public surface: createGitHeadCriteriaRunner.
 * Invariants:
 *   - Commands run in a throwaway worktree of the assessed commit (same mechanics as the suite runs:
 *     `runInThrowawayWorktree`, harness-free dependency preparation), never in the shared checkout.
 *   - Every criterion runs exactly once per call; a criterion whose run is refused is an outcome naming the cause and the
 *     others still run. A worktree or dependency setup failure is an `err` (nothing ran).
 *   - Identity is whatever the rerunner carries (the review's run identity; the detached batch's delegated child run).
 * Side-effect class: IO (git worktree, `bun install`, the verify runner spawns commands and writes attested evidence).
 *
 * @spec_ref spec-a-plan-s-tests-and-criteria-are-measured-once-at-its (AC-AO-3, BR-1498)
 */

import { err, ok, type LoreError, type Result } from "@lore/core";
import type { CriterionRerunPort } from "../../service/decision-recheck.js";
import type { HeadCriteriaRunnerPort, HeadCriterionOutcome, HeadCriterionRef } from "../../service/milestone-attestation-facts.js";
import { loreErrorText } from "../../service/suite-result-service.js";
import { prepareDependencies, runInThrowawayWorktree, suiteChildEnv } from "./assess-suite-runner.js";

/**
 * Transitional stub (see the module header of `assess-main-first-parent.ts`): the per-landing attester is retired; this
 * returns a port that attests nothing so `commands/assess.ts` still compiles until the B2 patch removes its call.
 *
 * @deprecated delete with the assess.ts patch (AC-AO-3).
 * @param _cwd - unused
 * @param _env - unused
 * @param _rerunnerAt - unused
 * @param _suiteStep - unused
 * @returns a port whose `attestAt` succeeds without running anything
 */
export function createGitLandingAttester(
  _cwd: string,
  _env: NodeJS.ProcessEnv,
  _rerunnerAt: (executionRoot: string) => CriterionRerunPort,
  _suiteStep?: unknown,
): { readonly attestAt: (landingCommit: string, criteria: readonly HeadCriterionRef[]) => Promise<Result<void, LoreError>> } {
  return { attestAt: async () => ok(undefined) };
}

/**
 * @param cwd - any directory inside the project's checkout
 * @param env - the environment git and dependency installation run with
 * @param rerunnerAt - builds the trusted criterion runner for an execution root (the assessed commit's worktree)
 * @returns a port; never throws
 */
export function createGitHeadCriteriaRunner(
  cwd: string,
  env: NodeJS.ProcessEnv,
  rerunnerAt: (executionRoot: string) => CriterionRerunPort,
): HeadCriteriaRunnerPort {
  const runInRoot = async (root: string, criteria: readonly HeadCriterionRef[]): Promise<Result<readonly HeadCriterionOutcome[], LoreError>> => {
    const prepared = await prepareDependencies(root, suiteChildEnv(env));
    if (prepared !== undefined) return err({ code: "STORE_ERROR", message: prepared });
    const rerunner = rerunnerAt(root);
    const outcomes: HeadCriterionOutcome[] = [];
    for (const criterion of criteria) {
      const result = await rerunner.rerun({ slug: criterion.spec_slug }, criterion.ac_id);
      outcomes.push(result.ok ? { ...criterion, ran: true } : { ...criterion, ran: false, cause: loreErrorText(result.error) });
    }
    return ok(outcomes);
  };

  return {
    attestAtHead: async ({ commit, worktreeRoot, criteria }): Promise<Result<readonly HeadCriterionOutcome[], LoreError>> => {
      if (worktreeRoot !== undefined) return runInRoot(worktreeRoot, criteria);
      const ran = await runInThrowawayWorktree(cwd, env, commit, (root) => runInRoot(root, criteria));
      return ran.ok ? ran.value : ran;
    },
  };
}
