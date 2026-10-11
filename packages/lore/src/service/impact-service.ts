/**
 * Module: impact-service — "what breaks if this rule changes or retires" (`lore rule impact`).
 *
 * Purpose: load the rule index data from the store and answer `impact` through the pure closure/SCC
 *   in `rule-index-queries.ts` (citing criteria, transitively dependent leaves, depends_on cycles, plus the
 *   standing split `living` / `records` of spec documents-are-living-or-records D7).
 * Public surface: {@link ImpactService.impact}.
 * Invariants: reads the migration-014 indexes only (no spec re-parse); unknown rule id is
 *   `DOC_NOT_FOUND`; terminates on cyclic graphs (see `computeImpact`).
 * Side-effect class: store reads only.
 * Source: spec-baseline-slice-2-completeness-census-per-branch-citation C6 (BL-10).
 */

import { err, ok } from "@lore/core";
import type { LoreError, Result } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { loadRuleIndexData } from "./rule-index-loader.js";
import { computeImpact } from "./rule-index-queries.js";
import type { ImpactReport } from "./rule-index-queries.js";

export class ImpactService {
  constructor(private readonly store: StoreInterface) {}

  async impact(ruleId: string): Promise<Result<ImpactReport, LoreError>> {
    const data = await loadRuleIndexData(this.store);
    if (!data.ok) return data;
    const report = computeImpact(ruleId, data.value);
    return report === undefined ? err({ code: "DOC_NOT_FOUND", id: ruleId }) : ok(report);
  }
}
