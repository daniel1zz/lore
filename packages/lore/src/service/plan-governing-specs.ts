/**
 * Module: plan-governing-specs — the one resolver of the specs that govern a plan's criteria.
 *
 * Purpose: answers "which specs declare the acceptance criteria a task of this plan may scope or run" — the plan's parent
 *   spec first, then every spec the plan `implements`, in link order.
 * Public surface: {@link resolvePlanGoverningSpecs}, {@link PlanGoverningSpecsPort}.
 * Invariants:
 *   - the done-contract compiler (`DoneContractService.resolveCriteria`) and `lore finish` (`VerifyRunnerService.verifyPlan`)
 *     both resolve through this function, so the AC ids the contract compiles are the ids finish accepts (issue 622).
 *   - a spec appears once; a link to a non-spec or to the parent again adds nothing.
 * Side-effect class: store reads only.
 *
 * Source: spec-done-contract-compiled-at-approve-task-kinds-write-sets (AC-DCS1-2, AC-DCS1-15); issue 622.
 */

import { ok, type DocRecord, type LoreError, type Result } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";

/** Resolves the specs governing a plan; bound at the composition root to {@link resolvePlanGoverningSpecs}. */
export type PlanGoverningSpecsPort = (plan: DocRecord) => Promise<Result<DocRecord[], LoreError>>;

/**
 * Every spec the plan is parented to or implements (the parent first, then `implements` link targets in link order).
 *
 * @param store - the corpus store the plan and specs are read from
 * @param plan - the plan whose governing specs are wanted
 * @returns the distinct specs, parent first; a store failure is returned unchanged
 */
export async function resolvePlanGoverningSpecs(
  store: Pick<StoreInterface, "find" | "findLinks">,
  plan: DocRecord,
): Promise<Result<DocRecord[], LoreError>> {
  const specs: DocRecord[] = [];
  if (plan.parent_id !== null) {
    const parent = await store.find(plan.parent_id);
    if (!parent.ok) return parent;
    if (parent.value !== null && parent.value.type === "spec") specs.push(parent.value);
  }
  const links = await store.findLinks(plan.id, "out");
  if (!links.ok) return links;
  for (const link of links.value) {
    if (link.link_type !== "implements") continue;
    const target = await store.find(link.to_id);
    if (!target.ok) return target;
    if (target.value !== null && target.value.type === "spec" && !specs.some((spec) => spec.id === target.value?.id)) specs.push(target.value);
  }
  return ok(specs);
}
