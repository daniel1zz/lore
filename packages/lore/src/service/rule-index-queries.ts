/**
 * Module: rule-index-queries — pure read-side queries over the baseline rule indexes.
 *
 * Purpose: one store-free implementation of "show a rule", "find rules" and "impact of a rule", shared
 *   by `RuleReadService`, `ImpactService` and the citation gate's candidate ranking, so no service
 *   imports another.
 * Public surface: {@link collectLeafRules}, {@link buildRuleView}, {@link findRules},
 *   {@link computeImpact}, {@link stripAnchorSymbol}, {@link compareRuleIds}, and the data/result types.
 * Invariants:
 *   - Pure: every function takes already-loaded data (baseline docs, spec docs, `ac_cites` /
 *     `rule_depends` rows) and returns plain values; no store, IO or clock.
 *   - `findRules` ranking is deterministic: spec/file queries rank by citing-criterion count desc, then
 *     BR-n ascending (a file query only considers specs whose code anchor matches, `#Symbol` stripped);
 *     text queries rank statement-prefix matches first, then BR-n ascending.
 *   - Snapshot views list only rules a leaf lists: a PROPOSED id (reserved by a spec's change set, listed by no
 *     leaf) never appears in `findRules` or `computeImpact`, and a retired tombstone is hidden from `findRules`
 *     unless the caller asks (`includeTombstones`); `buildRuleView` (`rule show`) reads both by id, a proposed
 *     one with the proposing spec (`proposed_by`).
 *   - Impact closure uses a visited set and Tarjan on an explicit work stack: terminates on any graph.
 *     Cycles are strongly connected components (size > 1 or a self-edge) reachable from the origin leaf,
 *     reported once with sorted member slugs; the origin leaf is excluded from `dependentLeaves`.
 * Side-effect class: none.
 * Source: spec-baseline-slice-2-completeness-census-per-branch-citation C6 (BL-10, BL-15).
 */

import { ruleIdPrefix, ruleIdPrefixOfNode, type DocRecord, type RuleLifecycle, type RuleRegistryState } from "@lore/core";
import type { AcCiteRow, RuleDependsRow } from "../store/store-interface.js";
import { approvedRulesOf } from "./baseline-items.js";
import { findProposal } from "./rule-changes.js";

export interface CitingCriterion {
  spec: string;
  ac: string;
}

export interface RuleView {
  id: string;
  statement: string;
  /** Slug of the baseline node (leaf, standard or debt-registry) carrying the rule — for a proposed rule, the leaf it will land on. */
  leaf: string;
  confidence: string;
  /** `proposed` = reserved by a spec's change set, NOT in the baseline (see {@link RuleView.proposed_by}). */
  state: RuleRegistryState;
  citingCriteria: CitingCriterion[];
  /** Slug of the spec whose change set proposes this rule; present only when `state` is `proposed`. */
  proposed_by?: string;
}

export type RuleFindQuery = { spec: string } | { file: string } | { text: string };

/** Options of {@link findRules}. */
export interface RuleFindOptions {
  /** Also list retired rules (tombstones). Default: the snapshot only — a retired rule is no longer true. */
  includeTombstones?: boolean;
}

export interface ImpactReport {
  citingCriteria: CitingCriterion[];
  /** Slugs of leaves transitively depending on the origin leaf, sorted. */
  dependentLeaves: string[];
  /** Each depends_on cycle reachable from the origin leaf, as its sorted member leaf slugs. */
  cycles: string[][];
  /**
   * Documents a change to the rule edits IN PLACE (spec D7): the origin leaf first, then every transitively
   * dependent leaf (sorted). Baseline leaves are living, so this group is what the change touches directly.
   */
  living: string[];
  /**
   * Documents a change to the rule can NOT rewrite once approved (spec D7): each citing spec criterion as
   * `{slug, acId}`, sorted by slug then criterion id. Same facts as `citingCriteria`, named for the standing split.
   */
  records: ImpactRecord[];
}

/** One locked-record criterion citing the rule. */
export interface ImpactRecord {
  slug: string;
  acId: string;
}

/** Everything the queries need, already loaded. */
export interface RuleIndexData {
  baseline: readonly DocRecord[];
  specs: readonly DocRecord[];
  cites: readonly AcCiteRow[];
  depends: readonly RuleDependsRow[];
}

/** One rule as listed in a leaf, with the owning leaf. */
export interface LeafRule {
  id: string;
  statement: string;
  confidence: string;
  lifecycle: RuleLifecycle;
  leaf: DocRecord;
}

/** `src/a.ts#Symbol` -> `src/a.ts` (anchors may carry a `#Symbol` suffix). */
export function stripAnchorSymbol(anchor: string): string {
  const i = anchor.indexOf("#");
  return i === -1 ? anchor : anchor.slice(0, i);
}

const RULE_FAMILY_ORDER = ["BR", "AS", "AD"] as const;

/** Rule ids by family (BR, then AS, then AD), each ascending by n; anything else after, lexicographically. */
export function compareRuleIds(a: string, b: string): number {
  const fa = ruleIdPrefix(a);
  const fb = ruleIdPrefix(b);
  if (fa !== undefined && fb !== undefined) {
    if (fa !== fb) return RULE_FAMILY_ORDER.indexOf(fa) - RULE_FAMILY_ORDER.indexOf(fb);
    return Number(a.slice(3)) - Number(b.slice(3));
  }
  if (fa !== undefined) return -1;
  if (fb !== undefined) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Rules listed by live rule-holding nodes — business leaves (BR), architecture standards (AS) and
 * architecture debt registries (AD) — keyed by rule id (first node wins; duplicates are status's
 * concern). `LeafRule.leaf` is the owning node whatever its kind.
 */
export function collectLeafRules(baselineDocs: readonly DocRecord[]): Map<string, LeafRule> {
  const byId = new Map<string, LeafRule>();
  for (const doc of baselineDocs) {
    if ((doc.deleted_at ?? null) !== null || ruleIdPrefixOfNode(doc.extra) === undefined) continue;
    for (const r of approvedRulesOf(doc)) {
      if (!isRecord(r) || typeof r["id"] !== "string" || byId.has(r["id"])) continue;
      const lifecycle = r["lifecycle"];
      if (lifecycle !== "live" && lifecycle !== "deprecated" && lifecycle !== "retired") continue;
      byId.set(r["id"], {
        id: r["id"],
        statement: typeof r["statement"] === "string" ? r["statement"] : "",
        confidence: typeof r["confidence"] === "string" ? r["confidence"] : "",
        lifecycle,
        leaf: doc,
      });
    }
  }
  return byId;
}

function citingCriteriaOf(ruleId: string, data: RuleIndexData): CitingCriterion[] {
  const slugById = new Map(data.specs.map((s) => [s.id as string, s.slug]));
  const out: CitingCriterion[] = [];
  for (const c of data.cites) {
    const spec = slugById.get(c.doc_id);
    if (c.rule_id === ruleId && spec !== undefined) out.push({ spec, ac: c.ac_id });
  }
  return out;
}

/**
 * What `rule show` returns, or `undefined` when no leaf lists the rule and no spec proposes it. A retired rule
 * is a tombstone, readable by id (BR-643); a proposed rule is reported with the spec that proposes it.
 */
export function buildRuleView(ruleId: string, data: RuleIndexData): RuleView | undefined {
  const rule = collectLeafRules(data.baseline).get(ruleId);
  if (rule === undefined) {
    const proposal = findProposal(ruleId, data.specs);
    if (proposal === undefined || proposal.change.op !== "add") return undefined;
    return {
      id: ruleId,
      statement: proposal.change.statement,
      leaf: proposal.change.leaf,
      confidence: "",
      state: "proposed",
      citingCriteria: citingCriteriaOf(ruleId, data),
      proposed_by: proposal.spec.slug,
    };
  }
  return {
    id: rule.id,
    statement: rule.statement,
    leaf: rule.leaf.slug,
    confidence: rule.confidence,
    state: rule.lifecycle,
    citingCriteria: citingCriteriaOf(ruleId, data),
  };
}

/**
 * Ranked rule ids for a spec, file or text query (see the module invariants for the ordering). A snapshot view:
 * only rules a leaf lists — a PROPOSED id (no leaf lists it) and a retired tombstone (unless
 * `opts.includeTombstones`) never appear, whichever query found them.
 */
export function findRules(query: RuleFindQuery, data: RuleIndexData, opts: RuleFindOptions = {}): string[] {
  const listed = collectLeafRules(data.baseline);
  const inSnapshot = (ruleId: string): boolean => {
    const rule = listed.get(ruleId);
    return rule !== undefined && (opts.includeTombstones === true || rule.lifecycle !== "retired");
  };
  if ("text" in query) {
    const needle = query.text.trim().toLowerCase();
    if (needle === "") return [];
    const hits = [...listed.values()].filter((r) => inSnapshot(r.id) && r.statement.toLowerCase().includes(needle));
    const rank = (r: LeafRule) => (r.statement.toLowerCase().startsWith(needle) ? 0 : 1);
    hits.sort((a, b) => rank(a) - rank(b) || compareRuleIds(a.id, b.id));
    return hits.map((r) => r.id);
  }

  const specIds = new Set<string>();
  if ("spec" in query) {
    for (const s of data.specs) if (s.slug === query.spec || s.id === query.spec) specIds.add(s.id);
  } else {
    const wanted = stripAnchorSymbol(query.file);
    for (const s of data.specs) {
      const anchors = s.extra["code_anchors"];
      if (!Array.isArray(anchors)) continue;
      if ((anchors as unknown[]).some((a) => typeof a === "string" && stripAnchorSymbol(a) === wanted)) specIds.add(s.id);
    }
  }
  const count = new Map<string, number>();
  for (const row of data.cites) {
    if (specIds.has(row.doc_id)) count.set(row.rule_id, (count.get(row.rule_id) ?? 0) + 1);
  }
  return [...count.keys()]
    .filter(inSnapshot)
    .sort((a, b) => (count.get(b) ?? 0) - (count.get(a) ?? 0) || compareRuleIds(a, b));
}

type Edges = Map<string, Set<string>>;

/** Every node reachable from `origin` over `edges` (origin included). */
function closure(origin: string, edges: Edges): Set<string> {
  const seen = new Set<string>([origin]);
  const stack = [origin];
  while (stack.length > 0) {
    const node = stack.pop() as string;
    for (const next of edges.get(node) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return seen;
}

/** Tarjan SCCs over `nodes`; keeps components with more than one member or a self-edge. */
function cyclicComponents(nodes: Set<string>, edges: Edges): string[][] {
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  type Frame = { node: string; iter: Iterator<string> };

  for (const root of nodes) {
    if (index.has(root)) continue;
    const work: Frame[] = [];
    const enter = (n: string): void => {
      index.set(n, counter);
      low.set(n, counter);
      counter += 1;
      stack.push(n);
      onStack.add(n);
      work.push({ node: n, iter: (edges.get(n) ?? new Set<string>())[Symbol.iterator]() });
    };
    enter(root);
    while (work.length > 0) {
      const frame = work[work.length - 1] as Frame;
      const step = frame.iter.next();
      if (step.done !== true) {
        const next = step.value;
        if (!nodes.has(next)) continue;
        if (!index.has(next)) enter(next);
        else if (onStack.has(next)) low.set(frame.node, Math.min(low.get(frame.node) as number, index.get(next) as number));
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent !== undefined) low.set(parent.node, Math.min(low.get(parent.node) as number, low.get(frame.node) as number));
      if (low.get(frame.node) !== index.get(frame.node)) continue;
      const comp: string[] = [];
      let member: string;
      do {
        member = stack.pop() as string;
        onStack.delete(member);
        comp.push(member);
      } while (member !== frame.node);
      if (comp.length > 1 || edges.get(frame.node)?.has(frame.node) === true) out.push(comp);
    }
  }
  return out;
}

/** Impact of changing/retiring a rule, or `undefined` when no live leaf lists it. */
export function computeImpact(ruleId: string, data: RuleIndexData): ImpactReport | undefined {
  const rules = collectLeafRules(data.baseline);
  const owner = rules.get(ruleId);
  if (owner === undefined) return undefined;
  const slugById = new Map(data.baseline.map((d) => [d.id as string, d.slug]));

  // dependents[X] = leaves holding a depends_on entry for a rule carried by leaf X
  const dependents: Edges = new Map();
  for (const row of data.depends) {
    const target = rules.get(row.rule_id);
    if (target === undefined || !slugById.has(row.leaf_id)) continue;
    const set = dependents.get(target.leaf.id) ?? new Set<string>();
    set.add(row.leaf_id);
    dependents.set(target.leaf.id, set);
  }

  const origin = owner.leaf.id as string;
  const reachable = closure(origin, dependents);
  const slugOf = (id: string): string => slugById.get(id) ?? id;
  const citing = citingCriteriaOf(ruleId, data);
  const dependentLeaves = [...reachable].filter((id) => id !== origin).map(slugOf).sort();
  return {
    citingCriteria: citing,
    dependentLeaves,
    living: [owner.leaf.slug, ...dependentLeaves],
    records: citing
      .map((c) => ({ slug: c.spec, acId: c.ac }))
      .sort((a, b) => a.slug.localeCompare(b.slug) || a.acId.localeCompare(b.acId)),
    cycles: cyclicComponents(reachable, dependents)
      .map((members) => members.map(slugOf).sort())
      .sort((a, b) => a.join("\u0000").localeCompare(b.join("\u0000"))),
  };
}
