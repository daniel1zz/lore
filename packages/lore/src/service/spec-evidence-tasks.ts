/**
 * spec-evidence-tasks — the ONE query that answers "which tasks carry evidence for this spec".
 *
 * Purpose: shared by `AcService.listCriteria` (per-AC coverage) and `ReviewService.reopen` (the
 * zero-evidence precondition), so both count evidence through the same plan-member + ad-hoc-governed
 * task set (spec-documents-are-living-or-records D5: "counted through the same AC-coverage query").
 *
 * Public surface: {@link findSpecChildPlans}, {@link findTasksUnderPlans}, {@link findAdhocGovernedTasks},
 * {@link findSpecEvidenceTasks}, {@link countEvidenceEntries}.
 * Invariants: holds no state beyond the passed `StoreInterface`; read-only; membership decided by
 * `isPlanMember` (never bare `parent_id`); an ad-hoc task counts only when the spec it recorded
 * (`extra.governing_spec`, BR-1495) is this spec.
 * Side-effect class: IO (reads only).
 */

import { extractEvidence, extractGoverningSpecRef, ok } from "@lore/core";
import type { DocId, DocRecord, LoreError, Result } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { isPlanMember } from "./plan-membership.js";


/** Child plans of a spec (direct parent_id match only). */
export async function findSpecChildPlans(
  store: StoreInterface,
  specId: DocId,
): Promise<Result<DocRecord[], LoreError>> {
  return store.findMany({ parent_id: specId, type: "plan" });
}

/**
 * All tasks across a set of plans — ONE corpus-wide `type: "task"` findMany (the store has no
 * `extra.plan_id` filter), membership per plan by `isPlanMember`. Segments follow `plans` order and
 * preserve the store's relative order.
 */
export async function findTasksUnderPlans(
  store: StoreInterface,
  plans: DocRecord[],
): Promise<Result<DocRecord[], LoreError>> {
  if (plans.length === 0) return ok([]);
  const allTasksResult = await store.findMany({ type: "task" });
  if (!allTasksResult.ok) return allTasksResult;
  const allTasks = allTasksResult.value;
  const collected: DocRecord[] = [];
  for (const plan of plans) {
    collected.push(...allTasks.filter((t) => isPlanMember(t, plan.id)));
  }
  return ok(collected);
}

/**
 * Ad-hoc tasks that recorded `spec` as their governing spec (`extra.governing_spec`, BR-1495). Never a
 * match on scope ids (AC ids are unique only within one spec); a task recording another spec, or none, is excluded.
 */
export async function findAdhocGovernedTasks(
  store: StoreInterface,
  spec: DocRecord,
): Promise<Result<DocRecord[], LoreError>> {
  const allTasksResult = await store.findMany({ type: "task" });
  if (!allTasksResult.ok) return allTasksResult;
  const adhocTasks = allTasksResult.value.filter((t) => t.extra["adhoc"] === true);
  if (adhocTasks.length === 0) return ok([]);

  // BR-156/BR-1495: membership is the spec the task recorded (id or slug), nothing inferred from its scope ids.
  const governed = adhocTasks.filter((task) => {
    const ref = extractGoverningSpecRef(task);
    return ref !== undefined && (ref === spec.id || ref === spec.slug);
  });
  return ok(governed);
}

/** The evidence-bearing task set for `spec`: child plans plus plan-member and ad-hoc-governed tasks. */
export interface SpecEvidenceTasks {
  readonly plans: DocRecord[];
  readonly planTasks: DocRecord[];
  readonly adhocTasks: DocRecord[];
  /** `planTasks` followed by `adhocTasks` — the exact list `computeAcCoverage` is fed. */
  readonly tasks: DocRecord[];
}

/** Gather {@link SpecEvidenceTasks} for `spec`. */
export async function findSpecEvidenceTasks(
  store: StoreInterface,
  spec: DocRecord,
): Promise<Result<SpecEvidenceTasks, LoreError>> {
  const plansResult = await findSpecChildPlans(store, spec.id);
  if (!plansResult.ok) return plansResult;
  const planTasksResult = await findTasksUnderPlans(store, plansResult.value);
  if (!planTasksResult.ok) return planTasksResult;
  const adhocResult = await findAdhocGovernedTasks(store, spec);
  if (!adhocResult.ok) return adhocResult;
  return ok({
    plans: plansResult.value,
    planTasks: planTasksResult.value,
    adhocTasks: adhocResult.value,
    tasks: [...planTasksResult.value, ...adhocResult.value],
  });
}

/** Total evidence rows across `tasks`. */
export function countEvidenceEntries(tasks: readonly DocRecord[]): number {
  return tasks.reduce((sum, task) => sum + extractEvidence(task).length, 0);
}
