/**
 * `findPlanClaimedByWriter` — the plan whose work the writing run is doing, read from the claim lease it holds.
 *
 * Purpose: the retiring write (`lore ac supersede`, a spec deprecation) records `retired_in_plan` from this, so a
 *   retirement belongs to the plan whose work made it (adr-an-acceptance-criterion-retires-with-the-feature-it).
 * Public surface: {@link findPlanClaimedByWriter}.
 * Invariants:
 *   - Reads the run from the store's write context (`readWriteContext`), never from a caller argument.
 *   - `ok(undefined)` when the write has no run or the run holds no claim: a retirement is then attributed to no plan.
 *   - A run whose claims span MORE than one plan is REFUSED (VALIDATION_ERROR naming the plans) unless the caller
 *     names one with `explicitPlan` (`--plan <slug>`); a retirement never silently escapes the owner's confirmation.
 *   - `explicitPlan` must be a plan the run claims a task in; otherwise it is refused (also when the run claims nothing).
 *   - A task's plan is `extra.plan_id` (plan membership); a phase's plan is its `parent_id`.
 * Side-effect class: IO (reads only).
 * @spec_ref spec-lean-governance-batch-verbs-judgment-only-at-milestones (Part D, AC-LG-12)
 */

import { err, ok, type DocRecord, type LoreError, type Result } from "@lore/core";
import { readWriteContext } from "../store/write-context-store.js";
import type { StoreInterface } from "../store/store-interface.js";

/** The plan id a claim-holding doc belongs to, or `undefined`. */
function planIdOf(doc: DocRecord): string | undefined {
  if (doc.type === "phase") return doc.parent_id ?? undefined;
  const planId = doc.extra["plan_id"];
  return typeof planId === "string" && planId !== "" ? planId : undefined;
}

/**
 * @param store - the store the writing service was handed (carries the write context)
 * @param explicitPlan - the plan slug or id the caller named (`--plan`), to disambiguate several claimed plans
 * @returns the id of the plan the writing run holds a claim in; `undefined` when it claims none and none was named
 */
export async function findPlanClaimedByWriter(store: StoreInterface, explicitPlan?: string): Promise<Result<string | undefined, LoreError>> {
  const run = readWriteContext(store)?.identity.harnessRun;
  const hasRun = run !== null && run !== undefined && run !== "";
  if (!hasRun && explicitPlan === undefined) return ok(undefined);
  const plans = new Set<string>();
  // reason: a run-less write holds no lease; scanning would match claims whose harness_run is null
  for (const type of hasRun ? (["task", "phase"] as const) : []) {
    const docs = await store.findMany({ type });
    if (!docs.ok) return docs;
    for (const doc of docs.value) {
      if (doc.deleted_at !== null) continue;
      const claim = doc.extra["claim"];
      if (typeof claim !== "object" || claim === null || (claim as Record<string, unknown>)["harness_run"] !== run) continue;
      const planId = planIdOf(doc);
      if (planId !== undefined) plans.add(planId);
    }
  }
  const named: { id: string; slug: string }[] = [];
  for (const id of plans) {
    const plan = await store.find(id as DocRecord["id"]);
    if (!plan.ok) return plan;
    named.push({ id, slug: plan.value?.slug ?? id });
  }
  if (explicitPlan !== undefined) {
    const chosen = named.find((p) => p.slug === explicitPlan || p.id === explicitPlan);
    if (chosen === undefined) {
      return err({
        code: "VALIDATION_ERROR",
        field: "plan",
        message:
          `--plan ${explicitPlan} is not a plan this run claims a task in` +
          (named.length === 0 ? " (it holds no claim)" : `; claimed plans: ${named.map((p) => p.slug).join(", ")}`),
        value: explicitPlan,
      });
    }
    return ok(chosen.id);
  }
  if (named.length > 1) {
    return err({
      code: "VALIDATION_ERROR",
      field: "plan",
      message: `this run claims tasks in ${String(named.length)} plans (${named.map((p) => p.slug).join(", ")}); the retirement must name its plan: pass --plan <slug>`,
      value: named.map((p) => p.slug),
    });
  }
  return ok(named[0]?.id);
}
