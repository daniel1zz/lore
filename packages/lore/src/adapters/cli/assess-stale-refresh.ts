/**
 * The real `StaleAcRefresherPort` behind `lore assess`: re-runs the citing acceptance criteria of stale cited rules
 * through the trusted `lore verify` runner (`VerifyRunnerService.verifyPlan`), so the refreshed evidence is attested
 * exactly like any other (BR-1372, spec-lean-governance-batch-verbs-judgment-only-at-milestones Part D).
 *
 * Purpose: turn "stale" (anchors changed after the last attested pass) into "verified" or "contradicted" before a
 *   review judges snapshot accuracy, without ad-hoc command spawning.
 * Public surface: createVerifyStaleRefresher, VerifyStaleRefresherDeps, createAppCriterionRerunner.
 * Invariants:
 *   - Commands run in the execution root supplied by the caller (the batch's throwaway main worktree), never here.
 *   - EVERY refresh row lands on the reusable per-(spec, AC) ad-hoc task (SPEC-069: `extra.adhoc`, `ac_scope` = [that AC],
 *     `extra.governing_spec` = the criterion's spec, BR-1495; reused by (spec, criterion), never by a bare id, because
 *     an id is unique only within one spec),
 *     never on the task that declares the criterion: the declaring task's 50-row evidence cap can therefore never be
 *     why a rule stays stale (#393). Rows carry `milestone_refresh`, so the write path replaces the previous refresh
 *     row of the same AC + runner and the ad-hoc task stays at one current row per AC. Readers
 *     (`attested-ac-runs.ts`) attribute the latest attested run by `ac_ref` across tasks, so the refresh is seen.
 *   - A new or changed command is decided through the autonomy class `verify-new-command` (auto; `allowNewCommands`
 *     routes it into the runner's decision seam), never a human prompt. An escalated decision is an `err` and is reported.
 * Side-effect class: IO (the verify runner spawns the AC commands and writes attested evidence to the corpus).
 *
 * Reference: Bazel action cache (an entry whose inputs changed is re-executed, never read as a wrong result).
 * @spec_ref spec-lean-governance-batch-verbs-judgment-only-at-milestones (Part D, AC-LG-12, BR-1372)
 */

import { err, extractGoverningSpecRef, ok, type DocRecord, type LoreError, type Result } from "@lore/core";
import type { CriterionRerunPort } from "../../service/decision-recheck.js";
import type { StaleAcRefresherPort } from "../../service/milestone-review-inputs.js";
import type { VerifyPlanResult, VerifyRunnerService } from "../../service/verify-runner-service.js";
import type { App } from "../../app.js";

/** Dependencies of {@link createVerifyStaleRefresher}. */
export interface VerifyStaleRefresherDeps {
  readonly verify: Pick<VerifyRunnerService, "verifyAdhocTask">;
  /** Every task and spec of the corpus (ad-hoc lookup and governing-spec resolution). */
  readonly listDocs: (type: "task" | "spec") => Promise<Result<DocRecord[], LoreError>>;
  /** The spec a plan's criteria belong to (the plan's parent spec). */
  readonly specOfPlan: (planRef: string) => Promise<Result<DocRecord, LoreError>>;
  /** Creates the ad-hoc task (extra.adhoc, parented to the root PRD by the service) scoped to `acId` of `spec`. */
  readonly createAdhocTask: (title: string, acId: string, spec: DocRecord) => Promise<Result<DocRecord, LoreError>>;
  /** The throwaway main worktree the criteria's commands run in. */
  readonly executionRoot: string;
  /** Actor recorded on the evidence. */
  readonly by: string;
  readonly nowIso: () => string;
}

/**
 * Builds the port.
 *
 * @param deps - the verify runner, execution root, actor and clock
 * @returns a port whose `runAcs` verifies each criterion once on the task that scopes it
 */
export function createVerifyStaleRefresher(deps: VerifyStaleRefresherDeps): StaleAcRefresherPort {
  return {
    runAcs: async (planRef, acIds): Promise<Result<void, LoreError>> => {
      const spec = await deps.specOfPlan(planRef);
      if (!spec.ok) return spec;
      for (const acId of acIds) {
        const refreshed = await runOnAdhocTask(deps, acId, spec.value);
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
  verify: Pick<VerifyRunnerService, "verifyAdhocTask">,
  opts: { readonly executionRoot: string; readonly by: string; readonly nowIso: () => string },
): StaleAcRefresherPort {
  return createVerifyStaleRefresher(createAppStaleRefresherDeps(app, verify, opts));
}

function createAppStaleRefresherDeps(
  app: Pick<App, "corpusService">,
  verify: Pick<VerifyRunnerService, "verifyAdhocTask">,
  opts: { readonly executionRoot: string; readonly by: string; readonly nowIso: () => string },
): VerifyStaleRefresherDeps {
  return {
    verify,
    listDocs: async (type) => {
      const listed = await app.corpusService.listFull({ type });
      return listed.ok ? ok(listed.value.docs) : listed;
    },
    specOfPlan: async (planRef) => {
      const plan = await app.corpusService.get(planRef);
      if (!plan.ok) return plan;
      const parentId = plan.value.doc.parent_id;
      if (plan.value.doc.type !== "plan" || parentId === null) {
        return err({ code: "VALIDATION_ERROR", field: "plan", message: `"${planRef}" is not a plan with a parent spec, so its criteria's spec is unknown`, value: planRef });
      }
      const spec = await app.corpusService.get(parentId);
      if (!spec.ok) return spec;
      if (spec.value.doc.type !== "spec") {
        return err({ code: "VALIDATION_ERROR", field: "plan", message: `plan "${planRef}" has a ${spec.value.doc.type} parent, not a spec`, value: planRef });
      }
      return ok(spec.value.doc);
    },
    createAdhocTask: (title, acId, spec) =>
      app.corpusService.create(
        {
          type: "task",
          title,
          content: `Re-verifies ${acId} of ${spec.slug} for the milestone review.`,
          priority: "low",
          extra: { adhoc: true, ac_scope: [acId], governing_spec: spec.id },
        },
        { by: opts.by },
      ),
    executionRoot: opts.executionRoot,
    by: opts.by,
    nowIso: opts.nowIso,
  };
}

/**
 * The criterion re-run behind the milestone's decision check (spec-a-decision-carrying-write-records-its-decision-on-its
 * D6): the SAME trusted runner and ad-hoc task as the stale refresh, but it reports whether the criterion passed.
 *
 * @param app - the corpus service the ad-hoc lookup and creation go through
 * @param verify - the trusted runner
 * @param opts - the execution root, the actor and the clock
 * @returns a port; a runner refusal or a result that is not a clean pass/fail of that criterion is an `err` (unverifiable)
 */
export function createAppCriterionRerunner(
  app: Pick<App, "corpusService">,
  verify: Pick<VerifyRunnerService, "verifyAdhocTask">,
  opts: { readonly executionRoot: string; readonly by: string; readonly nowIso: () => string },
): CriterionRerunPort {
  const deps = createAppStaleRefresherDeps(app, verify, opts);
  return {
    rerun: async (spec, acId) => {
      const specs = await deps.listDocs("spec");
      if (!specs.ok) return specs;
      const specDoc = specs.value.find((candidate) => candidate.slug === spec.slug);
      if (specDoc === undefined) return err({ code: "DOC_NOT_FOUND", id: spec.slug });
      const ran = await runOnAdhocTask(deps, acId, specDoc);
      if (!ran.ok) return ran;
      const row = ran.value.results.find((r) => r.ac_id === acId);
      if (row === undefined) return err({ code: "STORE_ERROR", message: `the runner reported no result for ${spec.slug} ${acId}` });
      const unboundCause = ran.value.unbound_causes?.find((u) => u.ac_id === acId)?.cause;
      return ok({
        passed: row.result === "pass",
        detail: `${row.result} (exit ${String(row.exit_code)})`,
        ...(unboundCause !== undefined ? { unbound_cause: unboundCause } : {}),
      });
    },
  };
}

function declaresOnly(task: DocRecord, acId: string, spec: DocRecord): boolean {
  const scope = task.extra["ac_scope"];
  const recorded = extractGoverningSpecRef(task);
  return (
    task.extra["adhoc"] === true &&
    Array.isArray(scope) &&
    scope.length === 1 &&
    scope[0] === acId &&
    (recorded === spec.id || recorded === spec.slug)
  );
}

async function runOnAdhocTask(deps: VerifyStaleRefresherDeps, acId: string, spec: DocRecord): Promise<Result<VerifyPlanResult, LoreError>> {
  const { listDocs, createAdhocTask } = deps;
  const tasks = await listDocs("task");
  if (!tasks.ok) return tasks;
  // reason: a criterion id is only unique within its spec, so the task is found by (spec, criterion), never the bare id.
  let task = tasks.value.find((candidate) => candidate.deleted_at === null && declaresOnly(candidate, acId, spec));
  if (task === undefined) {
    const created = await createAdhocTask(`Milestone review refresh of ${spec.slug} ${acId}`, acId, spec);
    if (!created.ok) return created;
    task = created.value;
  }
  const run = await deps.verify.verifyAdhocTask(task, [spec], {
    acIds: [acId],
    by: deps.by,
    nowIso: deps.nowIso(),
    allowNewCommands: true,
    milestoneRefresh: true,
    executionRoot: { root: deps.executionRoot, mode: "worktree" },
  });
  return run;
}
