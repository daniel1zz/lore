/**
 * The real `StaleAcRefresherPort` behind `lore assess`: re-runs the citing acceptance criteria of stale cited rules
 * through the trusted `lore verify` runner (`VerifyRunnerService.verifyPlan`), so the refreshed evidence is attested
 * exactly like any other (BR-1372, spec-lean-governance-batch-verbs-judgment-only-at-milestones Part D).
 *
 * Purpose: turn "stale" (anchors changed after the last attested pass) into "verified" or "contradicted" before a
 *   review judges snapshot accuracy, without ad-hoc command spawning.
 * Public surface: createVerifyStaleRefresher, VerifyStaleRefresherDeps.
 * Invariants:
 *   - Commands run in the execution root supplied by the caller (the batch's throwaway main worktree), never here.
 *   - Evidence lands on the task whose declared `ac_scope` names the criterion; a criterion no task scopes is an `err`
 *     (its rule stays stale, so n/a), never run against an arbitrary task.
 *   - A command that needs approval is NOT auto-approved (`allowNewCommands` stays off): the run is refused and reported.
 * Side-effect class: IO (the verify runner spawns the AC commands and writes attested evidence to the corpus).
 *
 * Reference: Bazel action cache (an entry whose inputs changed is re-executed, never read as a wrong result).
 * @spec_ref spec-lean-governance-batch-verbs-judgment-only-at-milestones (Part D, AC-LG-12, BR-1372)
 */

import { err, ok, type LoreError, type PlanBundle, type Result } from "@lore/core";
import type { StaleAcRefresherPort } from "../../service/milestone-review-inputs.js";
import type { VerifyRunnerService } from "../../service/verify-runner-service.js";

/** Dependencies of {@link createVerifyStaleRefresher}. */
export interface VerifyStaleRefresherDeps {
  readonly verify: Pick<VerifyRunnerService, "verifyPlan">;
  readonly getPlanBundle: (planRef: string) => Promise<Result<PlanBundle, LoreError>>;
  /** The throwaway main worktree the criteria's commands run in. */
  readonly executionRoot: string;
  /** Actor recorded on the evidence. */
  readonly by: string;
  readonly nowIso: () => string;
}

/**
 * Builds the port.
 *
 * @param deps - the verify runner, plan-bundle reader, execution root, actor and clock
 * @returns a port whose `runAcs` verifies each criterion once on the task that scopes it
 */
export function createVerifyStaleRefresher(deps: VerifyStaleRefresherDeps): StaleAcRefresherPort {
  return {
    runAcs: async (planRef, acIds): Promise<Result<void, LoreError>> => {
      const bundle = await deps.getPlanBundle(planRef);
      if (!bundle.ok) return bundle;
      const byTask = new Map<string, string[]>();
      for (const acId of acIds) {
        const owner = bundle.value.tasks.find((task) => {
          const scope = task.extra["ac_scope"];
          return Array.isArray(scope) && scope.includes(acId);
        });
        if (owner === undefined) {
          return err({
            code: "VALIDATION_ERROR",
            field: "ac_scope",
            message: `no task of plan "${planRef}" declares ${acId} in its ac_scope, so it cannot be re-verified; its rules stay stale`,
            rule: "BR-1372",
          });
        }
        byTask.set(owner.slug, [...(byTask.get(owner.slug) ?? []), acId]);
      }
      for (const [taskSlug, ids] of byTask) {
        const run = await deps.verify.verifyPlan(planRef, {
          acIds: ids,
          explicitTaskIdOrSlug: taskSlug,
          by: deps.by,
          nowIso: deps.nowIso(),
          executionRoot: { root: deps.executionRoot, mode: "worktree" },
        });
        if (!run.ok) return run;
      }
      return ok(undefined);
    },
  };
}
