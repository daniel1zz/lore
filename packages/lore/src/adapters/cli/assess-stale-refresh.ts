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
 *   - Evidence lands on the task whose declared `ac_scope` names the criterion. A criterion NO task of the plan scopes
 *     is still run through the same trusted runner, on a reusable ad-hoc task (SPEC-069) scoped to exactly that
 *     criterion, so the evidence is attested and persisted like any other; it is never run against an arbitrary task.
 *   - A new or changed command is decided through the autonomy class `verify-new-command` (auto; `allowNewCommands`
 *     routes it into the runner's decision seam), never a human prompt. An escalated decision is an `err` and is reported.
 * Side-effect class: IO (the verify runner spawns the AC commands and writes attested evidence to the corpus).
 *
 * Reference: Bazel action cache (an entry whose inputs changed is re-executed, never read as a wrong result).
 * @spec_ref spec-lean-governance-batch-verbs-judgment-only-at-milestones (Part D, AC-LG-12, BR-1372)
 */

import { ok, type DocRecord, type LoreError, type PlanBundle, type Result } from "@lore/core";
import type { StaleAcRefresherPort } from "../../service/milestone-review-inputs.js";
import type { VerifyRunnerService } from "../../service/verify-runner-service.js";
import type { App } from "../../app.js";

/** Dependencies of {@link createVerifyStaleRefresher}. */
export interface VerifyStaleRefresherDeps {
  readonly verify: Pick<VerifyRunnerService, "verifyPlan" | "verifyAdhocTask">;
  readonly getPlanBundle: (planRef: string) => Promise<Result<PlanBundle, LoreError>>;
  /** Every task and spec of the corpus (ad-hoc lookup and governing-spec resolution). */
  readonly listDocs: (type: "task" | "spec") => Promise<Result<DocRecord[], LoreError>>;
  /** Creates the ad-hoc task (extra.adhoc, parented to the root PRD by the service) scoped to `acId`. */
  readonly createAdhocTask: (title: string, acId: string) => Promise<Result<DocRecord, LoreError>>;
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
      const unscoped: string[] = [];
      for (const acId of acIds) {
        const owner = bundle.value.tasks.find((task) => {
          const scope = task.extra["ac_scope"];
          return Array.isArray(scope) && scope.includes(acId);
        });
        if (owner === undefined) {
          unscoped.push(acId);
          continue;
        }
        byTask.set(owner.slug, [...(byTask.get(owner.slug) ?? []), acId]);
      }
      for (const [taskSlug, ids] of byTask) {
        const run = await deps.verify.verifyPlan(planRef, {
          acIds: ids,
          explicitTaskIdOrSlug: taskSlug,
          by: deps.by,
          nowIso: deps.nowIso(),
          allowNewCommands: true,
          milestoneRefresh: true,
          executionRoot: { root: deps.executionRoot, mode: "worktree" },
        });
        if (!run.ok) return run;
      }
      for (const acId of unscoped) {
        const refreshed = await refreshUnscoped(deps, acId);
        if (!refreshed.ok) return refreshed;
      }
      return ok(undefined);
    },
  };
}

/**
 * The refresher over the real App: the SAME wiring `lore assess` uses and the integration test drives.
 *
 * @param app - the corpus service the ad-hoc lookup and creation go through
 * @param verify - the trusted runner
 * @param opts - the batch's throwaway main worktree, the actor and the clock
 */
export function createAppStaleRefresher(
  app: Pick<App, "corpusService">,
  verify: Pick<VerifyRunnerService, "verifyPlan" | "verifyAdhocTask">,
  opts: { readonly executionRoot: string; readonly by: string; readonly nowIso: () => string },
): StaleAcRefresherPort {
  return createVerifyStaleRefresher({
    verify,
    getPlanBundle: (ref) => app.corpusService.getPlanBundle(ref),
    listDocs: async (type) => {
      const listed = await app.corpusService.listFull({ type });
      return listed.ok ? ok(listed.value.docs) : listed;
    },
    createAdhocTask: (title, acId) =>
      app.corpusService.create(
        { type: "task", title, content: `Re-verifies ${acId} for the milestone review.`, priority: "low", extra: { adhoc: true, ac_scope: [acId] } },
        { by: opts.by },
      ),
    executionRoot: opts.executionRoot,
    by: opts.by,
    nowIso: opts.nowIso,
  });
}

function declaresOnly(task: DocRecord, acId: string): boolean {
  const scope = task.extra["ac_scope"];
  return task.extra["adhoc"] === true && Array.isArray(scope) && scope.length === 1 && scope[0] === acId;
}

async function refreshUnscoped(deps: VerifyStaleRefresherDeps, acId: string): Promise<Result<void, LoreError>> {
  const { listDocs, createAdhocTask } = deps;
  const tasks = await listDocs("task");
  if (!tasks.ok) return tasks;
  const specs = await listDocs("spec");
  if (!specs.ok) return specs;
  let task = tasks.value.find((candidate) => candidate.deleted_at === null && declaresOnly(candidate, acId));
  if (task === undefined) {
    const created = await createAdhocTask(`Milestone review refresh of ${acId}`, acId);
    if (!created.ok) return created;
    task = created.value;
  }
  const run = await deps.verify.verifyAdhocTask(task, specs.value, {
    acIds: [acId],
    by: deps.by,
    nowIso: deps.nowIso(),
    allowNewCommands: true,
    milestoneRefresh: true,
    executionRoot: { root: deps.executionRoot, mode: "worktree" },
  });
  return run.ok ? ok(undefined) : run;
}
