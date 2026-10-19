/**
 * Module: leaf-coverage — decide whether a baseline leaf accounts for every census site.
 *
 * Purpose: the pure verdict half of the completeness census (spec baseline-slice-2 C2): given the
 *   sites a leaf's commands reach, the leaf's `site_map`, and the live rule ids, report what is
 *   still unaccounted for.
 * Public surface: {@link computeLeafCoverage}, {@link collectOwnedSites}, {@link partitionDeclaredCommands}, {@link staleCommandFixCommand},
 *   {@link NON_BUSINESS_PREFIX}, {@link LeafCoverage}.
 * Invariants:
 *   - A `non-business:owned-by <leaf> BR-n — <reason>` entry counts only while the owner leaf is a leaf and every named
 *     rule is live on it (see owned-by.ts); otherwise the site is a gap.
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
import { NON_BUSINESS_PREFIX, judgeOwnedBy, parseOwnedBy, type OwnerLeafIndex } from "./owned-by.js";

export { NON_BUSINESS_PREFIX };

/** Verdict of {@link computeLeafCoverage}; both lists hold site keys. */
export interface LeafCoverage {
  /** Keyed sites with no live-rule mapping and no non-business justification. */
  readonly gaps: string[];
  /** Dynamic sites the census could not measure and nobody has accounted for. */
  readonly notMeasured: string[];
  /** `<specifier> (from <file>)` for each import the census could not resolve: sites behind it are missing. */
  readonly unresolvedImports?: string[];
  readonly ok: boolean;
}

/** The command that accounts for one unaccounted (site, leaf) pair: map the site to a live rule or justify it. */
export function siteFixCommand(leafSlug: string, siteKey: string): string {
  return `lore baseline map ${leafSlug} --site ${siteKey} --rule <BR-n> | --non-business <reason>`;
}

/** Split a site key (`file#symbol#code` | `file#symbol#dynamic:<label>`) back into a {@link Site}. */
function siteFromKey(key: string): Site {
  const first = key.indexOf("#");
  const second = key.indexOf("#", first + 1);
  const file = first < 0 ? key : key.slice(0, first);
  const symbol = first < 0 || second < 0 ? "" : key.slice(first + 1, second);
  const tail = second < 0 ? "" : key.slice(second + 1);
  return tail.startsWith("dynamic:") ? { key, file, symbol, dynamic: true } : { key, file, symbol, code: tail, dynamic: false };
}

/**
 * The sites a command-less (cross-cutting) leaf owns: its own `site_map` keys plus every site another leaf's `site_map`
 * hands to it with `non-business:owned-by <this leaf> BR-n` (BL-D1). There is no census to run for such a leaf; these
 * are the sites its rules guard, and each must be accounted for in ITS site map like any census site.
 *
 * @param leafId - id of the leaf being measured (the owner index is keyed by id and slug; both resolve to this id).
 * @param ownSiteMap - the leaf's own `site_map`.
 * @param otherSiteMaps - the `site_map` of every OTHER leaf.
 * @param ownerLeaves - {@link buildOwnerLeafIndex}; resolves an owned-by entry's leaf reference.
 * @returns the owned sites, sorted by key.
 */
export function collectOwnedSites(input: {
  leafId: string;
  ownSiteMap: Readonly<Record<string, readonly string[]>>;
  otherSiteMaps: readonly Readonly<Record<string, readonly string[]>>[];
  ownerLeaves: OwnerLeafIndex;
}): Site[] {
  const keys = new Set(Object.keys(input.ownSiteMap));
  for (const siteMap of input.otherSiteMaps) {
    for (const [key, entries] of Object.entries(siteMap)) {
      const handedToThisLeaf = entries.some((entry) => {
        const parsed = parseOwnedBy(entry);
        return parsed.kind === "owned_by" && input.ownerLeaves.get(parsed.leaf)?.leafId === input.leafId;
      });
      if (handedToThisLeaf) keys.add(key);
    }
  }
  return [...keys].sort().map(siteFromKey);
}

/** The command that declares a runnable command on a leaf (`<leaf>` is the leaf that owns the command's behaviour). */
export function commandFixCommand(command: string): string {
  return `lore baseline map <leaf> --command ${/\s/.test(command) ? `"${command}"` : command}`;
}

/** The command that drops a declared command the registry no longer has from its leaf. */
export function staleCommandFixCommand(leafSlug: string, command: string): string {
  return `lore baseline map ${leafSlug} --remove-command "${command}"`;
}

/**
 * Split a leaf's declared commands into live and stale (BR-660: a vanished command is a coverage defect, never a census error).
 * A command is stale when it resolves to no census entry, or its entry is no longer a runnable registry command.
 *
 * @param declared - the leaf's `extra.commands`.
 * @param entryKeyOf - `file#symbol` of a declared command, or `undefined` when it resolves to no census entry (the caller
 *   maps ONLY a command-unresolved failure to `undefined`; any other failure must propagate, never read as stale).
 * @param runnableEntries - `file#symbol` of every command the registry lists.
 */
export function partitionDeclaredCommands(
  declared: readonly string[],
  entryKeyOf: (command: string) => string | undefined,
  runnableEntries: ReadonlySet<string>,
): { live: string[]; stale: string[] } {
  const live: string[] = [];
  const stale: string[] = [];
  for (const command of declared) {
    const key = entryKeyOf(command);
    (key !== undefined && runnableEntries.has(key) ? live : stale).push(command);
  }
  return { live, stale };
}

/**
 * Runnable commands no leaf declares (BR-660: root coverage is absolute, so a command nobody declares is unmeasured).
 * Commands compare by census entry, so `ac-add` and `ac add` are the same command.
 *
 * @param runnable - registry commands (`name` + census `entry`).
 * @param declaredEntries - `file#symbol` of every command any leaf declares.
 * @returns the names of the undeclared commands, in `runnable` order.
 */
export function computeUndeclaredCommands(
  runnable: readonly { name: string; entry: { file: string; symbol: string } }[],
  declaredEntries: ReadonlySet<string>,
): string[] {
  return runnable.filter((c) => !declaredEntries.has(`${c.entry.file}#${c.entry.symbol}`)).map((c) => c.name);
}

function isAccountedFor(
  entries: readonly string[] | undefined,
  live: ReadonlySet<string>,
  ownerLeaves: OwnerLeafIndex | undefined,
): boolean {
  if (entries === undefined) return false;
  return entries.some((entry) => {
    if (live.has(entry)) return true;
    if (!entry.startsWith(NON_BUSINESS_PREFIX) || entry.slice(NON_BUSINESS_PREFIX.length).trim().length === 0) return false;
    const owned = parseOwnedBy(entry);
    if (owned.kind === "not_owned_by") return true;
    // reason: an owned-by excuse holds only while its owner leaf still resolves and every named rule is live on it;
    // a malformed one, or one judged without a lookup, never accounts for a site.
    return owned.kind === "owned_by" && judgeOwnedBy(owned, ownerLeaves).ok;
  });
}

/**
 * Compare census sites against a leaf's site map.
 *
 * @param input.sites - Sites from `listSites`.
 * @param input.bootstrap - Bootstrap sites from the census (`listSites(...).bootstrap`); default none.
 * @param input.siteMap - siteKey -> rule ids (`BR-n`) and/or `non-business:<reason>`.
 * @param input.liveRuleIds - ids of the leaf's live rules.
 * @param input.ownerLeaves - {@link buildOwnerLeafIndex} over the baseline docs; judges `non-business:owned-by` entries
 *   (absent => every owned-by entry is a gap, never silently trusted).
 * @example
 * computeLeafCoverage({ sites, siteMap: { "a.ts#f#X": ["BR-1"] }, liveRuleIds: ["BR-1"] });
 */
export function computeLeafCoverage(input: {
  sites: readonly Site[];
  bootstrap?: readonly Site[];
  unresolvedImports?: readonly UnresolvedImport[];
  siteMap: Readonly<Record<string, readonly string[]>>;
  liveRuleIds: readonly string[];
  ownerLeaves?: OwnerLeafIndex;
}): LeafCoverage {
  const live = new Set(input.liveRuleIds);
  const gaps: string[] = [];
  const notMeasured: string[] = [];
  const bootstrap = new Set((input.bootstrap ?? []).map((s) => s.key));
  for (const site of input.sites) {
    if (bootstrap.has(site.key)) continue;
    if (isAccountedFor(input.siteMap[site.key], live, input.ownerLeaves)) continue;
    (site.dynamic ? notMeasured : gaps).push(site.key);
  }
  const unresolvedImports = (input.unresolvedImports ?? []).map((u) => `${u.specifier} (from ${u.from})`);
  // reason: the key appears only when non-empty, so a complete verdict keeps its pre-#94 shape byte-for-byte.
  return {
    gaps,
    notMeasured,
    ...(unresolvedImports.length > 0 ? { unresolvedImports } : {}),
    ok: gaps.length === 0 && notMeasured.length === 0 && unresolvedImports.length === 0,
  };
}
