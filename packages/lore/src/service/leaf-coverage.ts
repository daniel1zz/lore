/**
 * Module: leaf-coverage — decide whether a baseline leaf accounts for every census site.
 *
 * Purpose: the pure verdict half of the completeness census (spec baseline-slice-2 C2): given the
 *   sites a leaf's commands reach, the leaf's `site_map`, and the live rule ids, report what is
 *   still unaccounted for.
 * Public surface: {@link computeLeafCoverage}, {@link NON_BUSINESS_PREFIX}, {@link LeafCoverage}.
 * Invariants:
 *   - A keyed (non-dynamic) site is covered only by a mapping to at least one LIVE rule id, or a
 *     `non-business:<reason>` entry with a non-empty reason; a mapping to retired/unknown ids only
 *     is a gap.
 *   - A dynamic site is "not_measured" until it is mapped to a live rule or justified
 *     `non-business:<reason>`; it never counts as a gap.
 *   - An interface-dispatch site (see site-census) is a dynamic site, so it follows the same rule.
 *   - Bootstrap sites (site-census `bootstrap`, app wiring / config loading) are never gaps, never
 *     not_measured and never affect `ok`; the verdict does not echo them (the caller reports them).
 *   - A census with unresolved imports (site-census `unresolvedImports`) is a lower bound, never a
 *     complete list: they are reported as `unresolvedImports` (`<specifier> (from <file>)`) and make `ok` false.
 *   - `ok` iff `gaps`, `notMeasured` and `unresolvedImports` are all empty. Output follows the order of `sites`.
 * Side-effect class: pure.
 */

import type { Site, UnresolvedImport } from "./site-census.js";

/** Prefix of a siteMap entry that justifies a site as not business behaviour: `non-business:<reason>`. */
export const NON_BUSINESS_PREFIX = "non-business:";

/** Verdict of {@link computeLeafCoverage}; both lists hold site keys. */
export interface LeafCoverage {
  /** Keyed sites with no live-rule mapping and no non-business justification. */
  readonly gaps: string[];
  /** Dynamic sites the census could not measure and nobody has accounted for. */
  readonly notMeasured: string[];
  /** `<specifier> (from <file>)` for each import the census could not resolve: sites behind it are missing. */
  readonly unresolvedImports: string[];
  readonly ok: boolean;
}

function isAccountedFor(entries: readonly string[] | undefined, live: ReadonlySet<string>): boolean {
  if (entries === undefined) return false;
  return entries.some(
    (entry) =>
      live.has(entry) || (entry.startsWith(NON_BUSINESS_PREFIX) && entry.slice(NON_BUSINESS_PREFIX.length).trim().length > 0),
  );
}

/**
 * Compare census sites against a leaf's site map.
 *
 * @param input.sites - Sites from `listSites`.
 * @param input.bootstrap - Bootstrap sites from the census (`listSites(...).bootstrap`); default none.
 * @param input.siteMap - siteKey -> rule ids (`BR-n`) and/or `non-business:<reason>`.
 * @param input.liveRuleIds - ids of the leaf's live rules.
 * @example
 * computeLeafCoverage({ sites, siteMap: { "a.ts#f#X": ["BR-1"] }, liveRuleIds: ["BR-1"] });
 */
export function computeLeafCoverage(input: {
  sites: readonly Site[];
  bootstrap?: readonly Site[];
  unresolvedImports?: readonly UnresolvedImport[];
  siteMap: Readonly<Record<string, readonly string[]>>;
  liveRuleIds: readonly string[];
}): LeafCoverage {
  const live = new Set(input.liveRuleIds);
  const gaps: string[] = [];
  const notMeasured: string[] = [];
  const bootstrap = new Set((input.bootstrap ?? []).map((s) => s.key));
  for (const site of input.sites) {
    if (bootstrap.has(site.key)) continue;
    if (isAccountedFor(input.siteMap[site.key], live)) continue;
    (site.dynamic ? notMeasured : gaps).push(site.key);
  }
  const unresolvedImports = (input.unresolvedImports ?? []).map((u) => `${u.specifier} (from ${u.from})`);
  return { gaps, notMeasured, unresolvedImports, ok: gaps.length === 0 && notMeasured.length === 0 && unresolvedImports.length === 0 };
}
