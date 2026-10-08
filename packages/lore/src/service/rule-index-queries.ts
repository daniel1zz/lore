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
 *   - Impact closure uses a visited set and Tarjan on an explicit work stack: terminates on any graph.
 *     Cycles are strongly connected components (size > 1 or a self-edge) reachable from the origin leaf,
 *     reported once with sorted member slugs; the origin leaf is excluded from `dependentLeaves`.
 * Side-effect class: none.
 * Source: spec-baseline-slice-2-completeness-census-per-branch-citation C6 (BL-10, BL-15).
 */

import type { DocRecord, RuleLifecycle } from "@lore/core";
import type { AcCiteRow, RuleDependsRow } from "../store/store-interface.js";

export interface CitingCriterion {
  spec: string;
  ac: string;
}

export interface RuleView {
  id: string;
  statement: string;
  /** Slug of the baseline leaf carrying the rule. */
  leaf: string;
  confidence: string;
  state: RuleLifecycle;
  citingCriteria: CitingCriterion[];
}

export type RuleFindQuery = { spec: string } | { file: string } | { text: string };

export interface ImpactReport {
  citingCriteria: CitingCriterion[];
  /** Slugs of leaves transitively depending on the origin leaf, sorted. */
  dependentLeaves: string[];
  /** Each depends_on cycle reachable from the origin leaf, as its sorted member leaf slugs. */
  cycles: string[][];
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

/** BR-n ids ascending by n; anything else after, lexicographically. */
export function compareRuleIds(a: string, b: string): number {
  const na = /^BR-(\d+)$/.exec(a);
  const nb = /^BR-(\d+)$/.exec(b);
  if (na && nb) return Number(na[1]) - Number(nb[1]);
  if (na) return -1;
  if (nb) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Rules listed by live leaf docs, keyed by rule id (first leaf wins; duplicates are status's concern). */
export function collectLeafRules(baselineDocs: readonly DocRecord[]): Map<string, LeafRule> {
  const byId = new Map<string, LeafRule>();
  for (const doc of baselineDocs) {
    if ((doc.deleted_at ?? null) !== null || doc.extra["node"] !== "leaf") continue;
    const rules = doc.extra["rules"];
    if (!Array.isArray(rules)) continue;
    for (const r of rules as unknown[]) {
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

/** What `rule show` returns, or `undefined` when no live leaf lists the rule. */
export function buildRuleView(ruleId: string, data: RuleIndexData): RuleView | undefined {
  const rule = collectLeafRules(data.baseline).get(ruleId);
  if (rule === undefined) return undefined;
  return {
    id: rule.id,
    statement: rule.statement,
    leaf: rule.leaf.slug,
    confidence: rule.confidence,
    state: rule.lifecycle,
    citingCriteria: citingCriteriaOf(ruleId, data),
  };
}

/** Ranked rule ids for a spec, file or text query (see the module invariants for the ordering). */
export function findRules(query: RuleFindQuery, data: RuleIndexData): string[] {
  if ("text" in query) {
    const needle = query.text.trim().toLowerCase();
    if (needle === "") return [];
    const hits = [...collectLeafRules(data.baseline).values()].filter((r) => r.statement.toLowerCase().includes(needle));
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
  return [...count.keys()].sort((a, b) => (count.get(b) ?? 0) - (count.get(a) ?? 0) || compareRuleIds(a, b));
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
  return {
    citingCriteria: citingCriteriaOf(ruleId, data),
    dependentLeaves: [...reachable].filter((id) => id !== origin).map(slugOf).sort(),
    cycles: cyclicComponents(reachable, dependents)
      .map((members) => members.map(slugOf).sort())
      .sort((a, b) => a.join("\u0000").localeCompare(b.join("\u0000"))),
  };
}
