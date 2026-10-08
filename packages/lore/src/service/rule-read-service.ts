/**
 * Module: rule-read-service — the read path of baseline rules (`lore rule show|find`).
 *
 * Purpose: load the rule index data from the store and answer `show` / `find` through the pure
 *   queries in `rule-index-queries.ts`.
 * Public surface: {@link RuleReadService} (`show`, `find`).
 * Invariants:
 *   - Every method returns `Result`; an unknown rule id is `DOC_NOT_FOUND`, never an empty record.
 *   - No logic lives here beyond loading; ranking and shaping are in `rule-index-queries.ts`.
 * Side-effect class: store reads only.
 * Source: spec-baseline-slice-2-completeness-census-per-branch-citation C6 (BL-10, BL-15).
 */

import { err, ok } from "@lore/core";
import type { LoreError, Result } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { loadRuleIndexData } from "./rule-index-loader.js";
import { buildRuleView, findRules } from "./rule-index-queries.js";
import type { RuleFindQuery, RuleView } from "./rule-index-queries.js";

export class RuleReadService {
  constructor(private readonly store: StoreInterface) {}

  /** Statement, leaf, confidence, computed state and every citing (spec, AC) of one rule. */
  async show(ruleId: string): Promise<Result<RuleView, LoreError>> {
    const data = await loadRuleIndexData(this.store);
    if (!data.ok) return data;
    const view = buildRuleView(ruleId, data.value);
    return view === undefined ? err({ code: "DOC_NOT_FOUND", id: ruleId }) : ok(view);
  }

  /** Rule ids relevant to a spec (cited by it), a file (cited by specs anchored to it) or a text. */
  async find(query: RuleFindQuery): Promise<Result<string[], LoreError>> {
    const data = await loadRuleIndexData(this.store);
    if (!data.ok) return data;
    return ok(findRules(query, data.value));
  }
}
