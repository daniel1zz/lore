/**
 * Module: spec-citation-census — the two spec-belonging counts of `lore status` (Baseline slice 3b, BR-1011).
 *
 * Purpose: a spec belongs to the baseline trees through its criteria's citations (BR-1008), so the corpus
 *   health question is "which live specs still cite nothing live" and "which live specs still carry a parent".
 * Public surface: {@link computeSpecCitationCensus}, {@link SpecCitationCensus}, {@link CensusBucket}.
 * Invariants:
 *   - "Live" spec = not soft-deleted and status not `archived` / `deprecated`; every other spec is invisible here.
 *   - A spec is CITED when at least one criterion cites a LIVE rule, judged by the same `collectLeafRules`
 *     rule index the Implements / Implemented-by views use (business BR leaves and architecture AS standards).
 *     A deprecated, retired, missing or debt (AD-n, never citable) id does not count.
 *   - A live spec with no criteria at all is uncited. Malformed criteria are skipped, never thrown.
 *   - `slugs` are sorted so the report is byte-stable.
 * Side-effect class: pure (inputs are already-loaded docs).
 * Spec: spec-baseline-slice-3b-specs-belong-to-the-trees-through (AC-BLS3B-3).
 */

import { ruleIdPrefix, type DocRecord } from "@lore/core";
import { collectLeafRules } from "./rule-index-queries.js";

/** A count together with the slugs it counted. */
export interface CensusBucket {
  count: number;
  slugs: string[];
}

/** The `data.specs_without_citation` / `data.specs_with_parent` pair of `lore status --json`. */
export interface SpecCitationCensus {
  specs_without_citation: CensusBucket;
  specs_with_parent: CensusBucket;
}

const NOT_LIVE_STATUSES: ReadonlySet<string> = new Set(["archived", "deprecated"]);

function citesOf(spec: DocRecord): string[] {
  const criteria = spec.extra["acceptance_criteria"];
  if (!Array.isArray(criteria)) return [];
  return (criteria as unknown[]).flatMap((criterion) => {
    if (typeof criterion !== "object" || criterion === null) return [];
    const cites = (criterion as { cites?: unknown }).cites;
    return Array.isArray(cites) ? cites.filter((c): c is string => typeof c === "string") : [];
  });
}

function bucketOf(slugs: string[]): CensusBucket {
  const sorted = [...slugs].sort();
  return { count: sorted.length, slugs: sorted };
}

/**
 * Count the live specs that cite no live rule, and the live specs that still have a parent.
 *
 * @param specs - every spec doc (any status; this function filters to live ones)
 * @param baselineDocs - every baseline doc (both trees)
 * @returns the two buckets, slugs sorted
 * @example
 * computeSpecCitationCensus(specs, baseline).specs_without_citation // => { count: 2, slugs: ["spec-a", "spec-b"] }
 */
export function computeSpecCitationCensus(specs: readonly DocRecord[], baselineDocs: readonly DocRecord[]): SpecCitationCensus {
  const rules = collectLeafRules(baselineDocs);
  const isLiveCitable = (id: string): boolean => ruleIdPrefix(id) !== "AD" && rules.get(id)?.lifecycle === "live";

  const live = specs.filter((spec) => (spec.deleted_at ?? null) === null && !NOT_LIVE_STATUSES.has(spec.status));
  return {
    specs_without_citation: bucketOf(live.filter((spec) => !citesOf(spec).some(isLiveCitable)).map((spec) => spec.slug)),
    specs_with_parent: bucketOf(live.filter((spec) => (spec.parent_id ?? null) !== null).map((spec) => spec.slug)),
  };
}
