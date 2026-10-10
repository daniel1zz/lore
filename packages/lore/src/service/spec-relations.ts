/**
 * Module: spec-relations — the "Implements" / "Implemented by" views, computed from citations.
 *
 * Purpose: a spec belongs to the baseline trees through its criteria's `cites` (BR-1008), not through a
 *   parent link; this module derives both directions of that relation on demand so there is no second copy
 *   to drift: a spec's Implements (rule -> node -> citing criteria) and a baseline node's Implemented by
 *   (citing spec + criterion per rule it carries).
 * Public surface: {@link computeImplements}, {@link computeImplementedBy}, {@link RuleState},
 *   {@link ImplementsView}, {@link ImplementedByView}, {@link formatImplementsLines},
 *   {@link formatImplementedByLines}.
 * Invariants:
 *   - Reads `extra.acceptance_criteria[].cites` straight off the spec docs (the SSOT the `ac_cites` index
 *     is derived from); rule -> node resolution uses `collectLeafRules`, which covers BOTH trees (business
 *     BR leaves, architecture AS standards, AD registries). It does NOT reuse the cite gate's
 *     `indexBaseline`, which is business-only.
 *   - Counts are never silently filtered: a citation of a missing / deprecated / retired rule is listed with
 *     its state; specs of every status (archived, deprecated included) are listed with that status. Only
 *     soft-deleted docs are excluded, because they no longer exist.
 *   - `count` = number of (rule, criterion) citation pairs, so a rule cited by 3 criteria shows 3.
 *   - Malformed criteria are skipped, never thrown (same stance as `ac-citations.ts`).
 * Side-effect class: pure.
 * Spec: spec-baseline-slice-3b-specs-belong-to-the-trees-through (AC-BLS3B-4, BR-1008).
 */

import { ruleIdPrefixOfNode, type DocRecord } from "@lore/core";
import { collectLeafRules } from "./rule-index-queries.js";

/** A rule's state as seen by a citation; `missing` = the id resolves to no rule in either tree. */
export type RuleState = "live" | "deprecated" | "retired" | "missing";

export interface ImplementsRule {
  rule_id: string;
  /** Slug of the baseline node carrying the rule, or `null` when the rule is missing. */
  node_slug: string | null;
  state: RuleState;
  /** Ids of this spec's criteria citing the rule, in criterion order. */
  criteria: string[];
}

export interface ImplementsView {
  rules: ImplementsRule[];
  /** Number of (rule, criterion) citation pairs. */
  count: number;
}

export interface ImplementedByCitation {
  rule_id: string;
  spec: string;
  spec_status: string;
  criterion: string;
}

export interface ImplementedByView {
  /** Every rule the node carries (cited or not), with its state. */
  rules: Array<{ rule_id: string; state: RuleState }>;
  citations: ImplementedByCitation[];
  /** Number of (rule, criterion) citation pairs — equals `citations.length`. */
  count: number;
}

interface CitingCriterion {
  id: string;
  cites: string[];
}

function criteriaOf(spec: DocRecord): CitingCriterion[] {
  const raw = spec.extra["acceptance_criteria"];
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).flatMap((c) => {
    if (typeof c !== "object" || c === null) return [];
    const { id, cites } = c as { id?: unknown; cites?: unknown };
    if (typeof id !== "string" || !Array.isArray(cites)) return [];
    return [{ id, cites: (cites as unknown[]).filter((x): x is string => typeof x === "string") }];
  });
}

function isNotDeleted(doc: DocRecord): boolean {
  return (doc.deleted_at ?? null) === null;
}

/**
 * What `spec` implements: each distinct cited rule id (first-citation order) with its node slug, state
 * and the citing criterion ids.
 *
 * @param spec - a spec doc
 * @param baselineDocs - every baseline doc of both trees
 */
export function computeImplements(spec: DocRecord, baselineDocs: readonly DocRecord[]): ImplementsView {
  const rules = collectLeafRules(baselineDocs);
  const byRule = new Map<string, ImplementsRule>();
  let count = 0;
  for (const criterion of criteriaOf(spec)) {
    for (const ruleId of new Set(criterion.cites)) {
      let entry = byRule.get(ruleId);
      if (entry === undefined) {
        const rule = rules.get(ruleId);
        entry = {
          rule_id: ruleId,
          node_slug: rule === undefined ? null : rule.leaf.slug,
          state: rule === undefined ? "missing" : rule.lifecycle,
          criteria: [],
        };
        byRule.set(ruleId, entry);
      }
      entry.criteria.push(criterion.id);
      count += 1;
    }
  }
  return { rules: [...byRule.values()], count };
}

/**
 * Which specs implement `node`: every citation of any rule the node carries, with the spec's status.
 * A node carrying no rules (root, branch, module-card, ...) yields an empty view.
 *
 * @param node - a baseline doc
 * @param specs - every spec doc (any status)
 */
export function computeImplementedBy(node: DocRecord, specs: readonly DocRecord[]): ImplementedByView {
  if (ruleIdPrefixOfNode(node.extra) === undefined) return { rules: [], citations: [], count: 0 };
  const own = [...collectLeafRules([node]).values()].map((r) => ({ rule_id: r.id, state: r.lifecycle as RuleState }));
  const ownIds = new Set(own.map((r) => r.rule_id));
  const citations: ImplementedByCitation[] = [];
  for (const spec of specs) {
    if (!isNotDeleted(spec)) continue;
    for (const criterion of criteriaOf(spec)) {
      for (const ruleId of new Set(criterion.cites)) {
        if (ownIds.has(ruleId)) {
          citations.push({ rule_id: ruleId, spec: spec.slug, spec_status: spec.status, criterion: criterion.id });
        }
      }
    }
  }
  return { rules: own, citations, count: citations.length };
}

/** Human rendering of {@link ImplementsView}; one header line then one line per rule. */
export function formatImplementsLines(view: ImplementsView): string[] {
  const lines = [`── Implements (${view.count} citation${view.count === 1 ? "" : "s"}) ${"─".repeat(40)}`];
  if (view.rules.length === 0) lines.push("(none — no criterion cites a rule)");
  for (const r of view.rules) {
    const state = r.state === "live" ? "" : ` [${r.state}]`;
    lines.push(`${r.rule_id} -> ${r.node_slug ?? "(no such rule)"}${state}: ${r.criteria.join(", ")}`);
  }
  return lines;
}

/** Human rendering of {@link ImplementedByView}; header, one line per citation, then the count line. */
export function formatImplementedByLines(view: ImplementedByView): string[] {
  const lines = [`── Implemented by ${"─".repeat(46)}`];
  const stateOf = new Map(view.rules.map((r) => [r.rule_id, r.state]));
  for (const c of view.citations) {
    const state = stateOf.get(c.rule_id);
    const rule = state === undefined || state === "live" ? c.rule_id : `${c.rule_id} [${state}]`;
    lines.push(`${rule}: ${c.spec} (${c.spec_status}) ${c.criterion}`);
  }
  lines.push(`Count: ${view.count} citation${view.count === 1 ? "" : "s"}`);
  return lines;
}
