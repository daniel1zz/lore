/**
 * Module: rule-read-service — the read path of baseline rules (`lore rule show|find`).
 *
 * Purpose: answer "what does this rule say, who cites it" and "which rules relate to this
 *   spec / file / text" from the migration-014 `ac_cites` index plus the baseline leaves, without
 *   re-parsing every spec's criteria.
 * Public surface: {@link RuleReadService} (`show`, `find`), {@link RuleView}, {@link RuleFindQuery},
 *   {@link CitingCriterion}, {@link stripAnchorSymbol}, {@link compareRuleIds}, {@link collectLeafRules}.
 * Invariants:
 *   - Every method returns `Result`; an unknown rule id is `DOC_NOT_FOUND`, never an empty record.
 *   - `state` is the leaf-listed lifecycle (computed on read), never stored prose.
 *   - `find` ranking is deterministic: more citing criteria first, then BR-n ascending (text: statement
 *     prefix match first, then BR-n) — the citation gate reuses this ordering for candidates.
 * Side-effect class: store reads only.
 * Source: spec-baseline-slice-2-completeness-census-per-branch-citation C6 (BL-10, BL-15).
 */

import { err, ok } from "@lore/core";
import type { DocRecord, LoreError, Result, RuleLifecycle } from "@lore/core";
import type { AcCiteRow, StoreInterface } from "../store/store-interface.js";

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

interface World {
  rules: Map<string, LeafRule>;
  specs: DocRecord[];
  cites: AcCiteRow[];
}

export class RuleReadService {
  constructor(private readonly store: StoreInterface) {}

  /** Statement, leaf, confidence, computed state and every citing (spec, AC) of one rule. */
  async show(ruleId: string): Promise<Result<RuleView, LoreError>> {
    const world = await this.load();
    if (!world.ok) return world;
    const rule = world.value.rules.get(ruleId);
    if (rule === undefined) return err({ code: "DOC_NOT_FOUND", id: ruleId });
    const slugById = new Map(world.value.specs.map((s) => [s.id as string, s.slug]));
    const citingCriteria: CitingCriterion[] = [];
    for (const c of world.value.cites) {
      const spec = slugById.get(c.doc_id);
      if (c.rule_id === ruleId && spec !== undefined) citingCriteria.push({ spec, ac: c.ac_id });
    }
    return ok({
      id: rule.id,
      statement: rule.statement,
      leaf: rule.leaf.slug,
      confidence: rule.confidence,
      state: rule.lifecycle,
      citingCriteria,
    });
  }

  /** Rule ids relevant to a spec (cited by it), a file (cited by specs anchored to it) or a text. */
  async find(query: RuleFindQuery): Promise<Result<string[], LoreError>> {
    const world = await this.load();
    if (!world.ok) return world;
    const { rules, specs, cites } = world.value;

    if ("text" in query) {
      const needle = query.text.trim().toLowerCase();
      if (needle === "") return ok([]);
      const hits = [...rules.values()].filter((r) => r.statement.toLowerCase().includes(needle));
      const rank = (r: LeafRule) => (r.statement.toLowerCase().startsWith(needle) ? 0 : 1);
      hits.sort((a, b) => rank(a) - rank(b) || compareRuleIds(a.id, b.id));
      return ok(hits.map((r) => r.id));
    }

    const specIds = new Set<string>();
    if ("spec" in query) {
      for (const s of specs) if (s.slug === query.spec || s.id === query.spec) specIds.add(s.id);
    } else {
      const wanted = stripAnchorSymbol(query.file);
      for (const s of specs) {
        const anchors = s.extra["code_anchors"];
        if (!Array.isArray(anchors)) continue;
        if ((anchors as unknown[]).some((a) => typeof a === "string" && stripAnchorSymbol(a) === wanted)) specIds.add(s.id);
      }
    }
    const count = new Map<string, number>();
    for (const row of cites) {
      if (specIds.has(row.doc_id)) count.set(row.rule_id, (count.get(row.rule_id) ?? 0) + 1);
    }
    return ok([...count.keys()].sort((a, b) => (count.get(b) ?? 0) - (count.get(a) ?? 0) || compareRuleIds(a, b)));
  }

  private async load(): Promise<Result<World, LoreError>> {
    const baseline = await this.store.findMany({ type: "baseline" });
    if (!baseline.ok) return baseline;
    const specs = await this.store.findMany({ type: "spec" });
    if (!specs.ok) return specs;
    const cites = await this.store.listAcCites();
    if (!cites.ok) return cites;
    return ok({ rules: collectLeafRules(baseline.value), specs: specs.value, cites: cites.value });
  }
}
