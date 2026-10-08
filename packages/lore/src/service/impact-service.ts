/**
 * Module: impact-service — "what breaks if this rule changes or retires" (`lore rule impact`).
 *
 * Purpose: list the criteria citing a rule and the baseline leaves that transitively depend on the
 *   leaf carrying it, reporting `depends_on` cycles instead of looping on them.
 * Public surface: {@link ImpactService.impact}, {@link ImpactReport}.
 * Invariants:
 *   - Reads the migration-014 indexes (`listAcCites`, `listRuleDepends`) — no spec re-parse.
 *   - Closure uses a visited set and Tarjan runs on an explicit work stack: terminates on any graph.
 *     Cycles are the strongly connected components (size > 1, or a self-edge) among the leaves
 *     reachable from the origin leaf; each is reported once with all its member slugs (sorted).
 *   - `dependentLeaves` excludes the origin leaf itself (even when it sits on a cycle).
 *   - Unknown rule id -> `DOC_NOT_FOUND`.
 * Side-effect class: store reads only.
 * Source: spec-baseline-slice-2-completeness-census-per-branch-citation C6 (BL-10).
 */

import { err, ok } from "@lore/core";
import type { LoreError, Result } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { RuleReadService, collectLeafRules } from "./rule-read-service.js";
import type { CitingCriterion } from "./rule-read-service.js";

export interface ImpactReport {
  citingCriteria: CitingCriterion[];
  /** Slugs of leaves transitively depending on the origin leaf, sorted. */
  dependentLeaves: string[];
  /** Each depends_on cycle reachable from the origin leaf, as its sorted member leaf slugs. */
  cycles: string[][];
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

export class ImpactService {
  constructor(private readonly store: StoreInterface) {}

  async impact(ruleId: string): Promise<Result<ImpactReport, LoreError>> {
    const shown = await new RuleReadService(this.store).show(ruleId);
    if (!shown.ok) return shown;
    const baseline = await this.store.findMany({ type: "baseline" });
    if (!baseline.ok) return baseline;
    const depends = await this.store.listRuleDepends();
    if (!depends.ok) return depends;

    const rules = collectLeafRules(baseline.value);
    const owner = rules.get(ruleId);
    if (owner === undefined) return err({ code: "DOC_NOT_FOUND", id: ruleId });
    const slugById = new Map(baseline.value.map((d) => [d.id as string, d.slug]));

    // dependents[X] = leaves holding a depends_on entry for a rule carried by leaf X
    const dependents: Edges = new Map();
    for (const row of depends.value) {
      const target = rules.get(row.rule_id);
      if (target === undefined || !slugById.has(row.leaf_id)) continue;
      const set = dependents.get(target.leaf.id) ?? new Set<string>();
      set.add(row.leaf_id);
      dependents.set(target.leaf.id, set);
    }

    const origin = owner.leaf.id as string;
    const reachable = closure(origin, dependents);
    const slugOf = (id: string): string => slugById.get(id) ?? id;
    const dependentLeaves = [...reachable].filter((id) => id !== origin).map(slugOf).sort();
    const cycles = cyclicComponents(reachable, dependents)
      .map((members) => members.map(slugOf).sort())
      .sort((a, b) => a.join("\u0000").localeCompare(b.join("\u0000")));
    return ok({ citingCriteria: shown.value.citingCriteria, dependentLeaves, cycles });
  }
}
