/**
 * Module: ac-citations — pure helpers for AC -> baseline-rule citations.
 *
 * Purpose: SSOT for how a `cites` id is judged (dangling / inactive) and how a set of
 *   specs is counted; shared by `AcService.citeCriterion` / add / set (warnings) and
 *   C7's RuleStateService / `lore status` (counts), so the two never disagree.
 * Public surface: `CiteWarning`, `RuleIndex`, `buildRuleIndex`, `citeWarnings`, `countCitations`.
 * Invariants: report-only — nothing here rejects or drops an id; a missing id is
 *   "dangling", a `deprecated`/`retired` rule is "inactive", a `live` rule yields nothing.
 *   Malformed `extra.rules` / `extra.acceptance_criteria` entries are skipped, never thrown.
 * Side effects: none (pure).
 * Spec: spec-baseline-slice-1-rules-with-permanent-ids-ac-citations §C4 (AC-BLS1-6).
 */
import type { DocRecord, RuleLifecycle } from "@lore/core";

export interface CiteWarning {
  id: string;
  kind: "dangling" | "inactive";
}

export type RuleIndex = ReadonlyMap<string, { lifecycle: RuleLifecycle }>;

export interface CitationCounts {
  acs_total: number;
  acs_citing: number;
  acs_uncited: number;
  cites_dangling: number;
  cites_to_inactive: number;
}

const LIFECYCLES: ReadonlySet<string> = new Set(["live", "deprecated", "retired"]);

/** Build id -> lifecycle from baseline leaf docs (`extra.rules[]`). First occurrence of an id wins. */
export function buildRuleIndex(leaves: readonly DocRecord[]): Map<string, { lifecycle: RuleLifecycle }> {
  const index = new Map<string, { lifecycle: RuleLifecycle }>();
  for (const leaf of leaves) {
    const rules = leaf.extra["rules"];
    if (!Array.isArray(rules)) continue;
    for (const r of rules as unknown[]) {
      if (typeof r !== "object" || r === null) continue;
      const { id, lifecycle } = r as { id?: unknown; lifecycle?: unknown };
      if (typeof id !== "string" || typeof lifecycle !== "string" || !LIFECYCLES.has(lifecycle)) continue;
      if (!index.has(id)) index.set(id, { lifecycle: lifecycle as RuleLifecycle });
    }
  }
  return index;
}

/** One warning per dangling / inactive id, in input order. Live rules yield none. */
export function citeWarnings(ids: readonly string[], index: RuleIndex): CiteWarning[] {
  const out: CiteWarning[] = [];
  for (const id of ids) {
    const rule = index.get(id);
    if (rule === undefined) out.push({ id, kind: "dangling" });
    else if (rule.lifecycle !== "live") out.push({ id, kind: "inactive" });
  }
  return out;
}

function criteriaOf(spec: DocRecord): Array<{ cites: string[] }> {
  const raw = spec.extra["acceptance_criteria"];
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).flatMap((c) => {
    if (typeof c !== "object" || c === null) return [];
    const cites = (c as { cites?: unknown }).cites;
    return [{ cites: Array.isArray(cites) ? (cites as unknown[]).filter((x): x is string => typeof x === "string") : [] }];
  });
}

/**
 * Count AC citations across `specs` against `ruleIndex`. `cites_*` count cite OCCURRENCES;
 * `acs_citing` counts ACs with >= 1 cite; `acs_uncited = acs_total - acs_citing`.
 */
export function countCitations(specs: readonly DocRecord[], ruleIndex: RuleIndex): CitationCounts {
  const counts: CitationCounts = {
    acs_total: 0,
    acs_citing: 0,
    acs_uncited: 0,
    cites_dangling: 0,
    cites_to_inactive: 0,
  };
  for (const spec of specs) {
    for (const ac of criteriaOf(spec)) {
      counts.acs_total += 1;
      if (ac.cites.length > 0) counts.acs_citing += 1;
      for (const w of citeWarnings(ac.cites, ruleIndex)) {
        if (w.kind === "dangling") counts.cites_dangling += 1;
        else counts.cites_to_inactive += 1;
      }
    }
  }
  counts.acs_uncited = counts.acs_total - counts.acs_citing;
  return counts;
}
