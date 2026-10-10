/**
 * Module: baseline-node-budget — the per-kind size check of baseline nodes (Baseline slice 3b).
 *
 * Purpose: keep a baseline node small enough to read whole (BR-1010; BR-422 leaf, BR-423 branch, BR-425 standard):
 *   a business leaf is capped by body chars AND rule count, a business branch and an architecture standard by body chars.
 * Public surface: {@link checkBaselineNodeBudget}, {@link BaselineNodeBreach}, {@link BaselineNodeBudgetInput}.
 * Invariants:
 *   - Strictly greater-than: a node exactly AT a cap passes, one over is a finding.
 *   - Caps are ALWAYS read from the injected `budgets` (resolved from `budget.baseline.*` by `@lore/core`'s
 *     `resolveBaselineNodeBudgets`, the only home of the default numbers); nothing is hardcoded here.
 *   - Only business leaf / branch and architecture standard are measured; every other node kind (roots, sections,
 *     module cards, debt registries) has no cap and yields no finding. Soft-deleted docs are skipped.
 *   - "Chars" = the stored body (`content.length`); "rules" = `extra.rules.length` (every lifecycle, as stored).
 * Side-effect class: pure (no store, no fs, no clock).
 * Spec: spec-baseline-slice-3b-specs-belong-to-the-trees-through (AC-BLS3B-8).
 */

import { isBusinessBaseline, type BaselineNodeBudgets } from "@lore/core";

/** The baseline kinds this check measures. */
export type BudgetedNodeKind = "leaf" | "branch" | "standard";

/** What is measured: the body in characters, or the number of rules on a leaf. */
export type BaselineBudgetMetric = "chars" | "rules";

/** One node over its cap: names the node, its kind, what was measured, the measured size and the cap. */
export interface BaselineNodeBreach {
  slug: string;
  kind: BudgetedNodeKind;
  metric: BaselineBudgetMetric;
  measured: number;
  cap: number;
}

/** The facts of one baseline doc this check reads (a structural subset of `DocRecord`). */
export interface BaselineNodeBudgetInput {
  slug: string;
  content: string;
  extra: Record<string, unknown>;
  deleted_at?: string | null | undefined;
}

/** Which budgeted kind (if any) a baseline doc's `extra` makes it. */
function budgetedKindOf(extra: Record<string, unknown>): BudgetedNodeKind | undefined {
  const node = extra["node"];
  const tree = typeof extra["tree"] === "string" ? extra["tree"] : undefined;
  if (isBusinessBaseline({ tree })) {
    return node === "leaf" || node === "branch" ? node : undefined;
  }
  return node === "standard" ? "standard" : undefined;
}

/**
 * Measure one baseline node against its per-kind caps.
 *
 * @param node - The baseline doc's slug, body and `extra`.
 * @param budgets - Resolved caps (`resolveBaselineNodeBudgets`).
 * @returns One breach per exceeded cap (a leaf can breach both chars and rules); `[]` when within budget or unbudgeted.
 * @example
 * checkBaselineNodeBudget({ slug: "l", content: "x".repeat(16001), extra: { node: "leaf" } }, budgets);
 * // => [{ slug: "l", kind: "leaf", metric: "chars", measured: 16001, cap: 16000 }]
 */
export function checkBaselineNodeBudget(node: BaselineNodeBudgetInput, budgets: BaselineNodeBudgets): BaselineNodeBreach[] {
  if ((node.deleted_at ?? null) !== null) return [];
  const kind = budgetedKindOf(node.extra);
  if (kind === undefined) return [];

  const breaches: BaselineNodeBreach[] = [];
  const charCap = kind === "leaf" ? budgets.leaf_chars : kind === "branch" ? budgets.branch_chars : budgets.standard_chars;
  if (node.content.length > charCap) {
    breaches.push({ slug: node.slug, kind, metric: "chars", measured: node.content.length, cap: charCap });
  }
  if (kind === "leaf") {
    const rules = node.extra["rules"];
    const ruleCount = Array.isArray(rules) ? rules.length : 0;
    if (ruleCount > budgets.leaf_rules) {
      breaches.push({ slug: node.slug, kind, metric: "rules", measured: ruleCount, cap: budgets.leaf_rules });
    }
  }
  return breaches;
}
