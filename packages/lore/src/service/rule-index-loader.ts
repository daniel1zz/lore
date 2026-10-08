/**
 * Module: rule-index-loader — loads the data the pure rule queries (`rule-index-queries.ts`) run over.
 *
 * Purpose: one store read shared by `RuleReadService` and `ImpactService` so neither imports the other.
 * Public surface: {@link loadRuleIndexData}.
 * Invariants: reads the baseline leaves, specs and the migration-014 `ac_cites` / `rule_depends`
 *   indexes; never re-parses criteria, never writes.
 * Side-effect class: store reads only.
 */

import { ok } from "@lore/core";
import type { LoreError, Result } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import type { RuleIndexData } from "./rule-index-queries.js";

export async function loadRuleIndexData(store: StoreInterface): Promise<Result<RuleIndexData, LoreError>> {
  const baseline = await store.findMany({ type: "baseline" });
  if (!baseline.ok) return baseline;
  const specs = await store.findMany({ type: "spec" });
  if (!specs.ok) return specs;
  const cites = await store.listAcCites();
  if (!cites.ok) return cites;
  const depends = await store.listRuleDepends();
  if (!depends.ok) return depends;
  return ok({ baseline: baseline.value, specs: specs.value, cites: cites.value, depends: depends.value });
}
