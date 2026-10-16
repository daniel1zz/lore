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
 * `isPlanMember` (never bare `parent_id`); an ad-hoc task counts only when `resolveGoverningSpecByAcScope`
 * resolves its declared scope to this spec.
 * Side-effect class: IO (reads only).
 */

import { extractDeclaredAcScope, extractEvidence, ok, resolveGoverningSpecByAcScope } from "@lore/core";
import type { DocId, DocRecord, LoreError, Result } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { isPlanMember } from "./plan-membership.js";

/** Service-layer clock: the one wall-clock read feeding core's `nowIso` parameter. */
const defaultNow = (): string => new Date().toISOString();

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
 * Ad-hoc tasks whose declared `ac_scope` resolves, unambiguously, to `spec` through
 * `resolveGoverningSpecByAcScope` over the full spec list (never a bare id string match — AC ids are
 * unique only within one spec). Absent/ambiguous/other-spec scope → silently excluded.
 */
export async function findAdhocGovernedTasks(
  store: StoreInterface,
  spec: DocRecord,
  now: () => string = defaultNow,
): Promise<Result<DocRecord[], LoreError>> {
  const allTasksResult = await store.findMany({ type: "task" });
  if (!allTasksResult.ok) return allTasksResult;
  const adhocTasks = allTasksResult.value.filter((t) => t.extra["adhoc"] === true);
  if (adhocTasks.length === 0) return ok([]);

  const allSpecsResult = await store.findMany({ type: "spec" });
  if (!allSpecsResult.ok) return allSpecsResult;
  const allSpecs = allSpecsResult.value;

  const nowIso = now();
  const governed: DocRecord[] = [];
  for (const task of adhocTasks) {
    const declared = extractDeclaredAcScope(task);
    if (declared === undefined || declared.length === 0) continue;
    const resolveResult = resolveGoverningSpecByAcScope(declared, allSpecs, `ad-hoc task "${task.slug}"`, nowIso);
    if (!resolveResult.ok) continue;
    if (resolveResult.value.spec.id === spec.id) governed.push(task);
  }
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
  now: () => string = defaultNow,
): Promise<Result<SpecEvidenceTasks, LoreError>> {
  const plansResult = await findSpecChildPlans(store, spec.id);
  if (!plansResult.ok) return plansResult;
  const planTasksResult = await findTasksUnderPlans(store, plansResult.value);
  if (!planTasksResult.ok) return planTasksResult;
  const adhocResult = await findAdhocGovernedTasks(store, spec, now);
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
