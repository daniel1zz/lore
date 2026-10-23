/**
 * `findPlanClaimedByWriter` — the plan whose work the writing run is doing, read from the claim lease it holds.
 *
 * Purpose: the retiring write (`lore ac supersede`, a spec deprecation) records `retired_in_plan` from this, so a
 *   retirement belongs to the plan whose work made it (adr-an-acceptance-criterion-retires-with-the-feature-it).
 * Public surface: {@link findPlanClaimedByWriter}.
 * Invariants:
 *   - Reads the run from the store's write context (`readWriteContext`), never from a caller argument.
 *   - `ok(undefined)` when the write has no run, the run holds no claim, or its claims span MORE than one plan:
 *     a retirement is then attributed to no plan (never guessed).
 *   - A task's plan is `extra.plan_id` (plan membership); a phase's plan is its `parent_id`.
 * Side-effect class: IO (reads only).
 * @spec_ref spec-lean-governance-batch-verbs-judgment-only-at-milestones (Part D, AC-LG-12)
 */

import { ok, type DocRecord, type LoreError, type Result } from "@lore/core";
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
 * @returns the id of the single plan the writing run holds a claim in; `undefined` when none or ambiguous
 */
export async function findPlanClaimedByWriter(store: StoreInterface): Promise<Result<string | undefined, LoreError>> {
  const run = readWriteContext(store)?.identity.harnessRun;
  if (run === null || run === undefined || run === "") return ok(undefined);
  const plans = new Set<string>();
  for (const type of ["task", "phase"] as const) {
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
  return ok(plans.size === 1 ? [...plans][0] : undefined);
}
