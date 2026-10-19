/**
 * Module: leaf-coverage — decide whether a baseline leaf accounts for every census site.
 *
 * Purpose: the pure verdict half of the completeness census (spec baseline-slice-2 C2): given the
 *   sites a leaf's commands reach, the leaf's `site_map`, and the live rule ids, report what is
 *   still unaccounted for.
 * Public surface: {@link computeLeafCoverage}, {@link findCorruptSiteMapValues}, {@link collectOwnedSites}, {@link partitionDeclaredCommands},
 *   {@link absentCommandFixCommand}, {@link leavesUnder}, {@link absentDeclarationsOf}, {@link absentDeclarationRefusal},
 *   {@link AbsentDeclaration}, {@link LeafCoverage}.
 * Invariants:
 *   - A site counts as mapped only by an unretired `BR-n` id of the leaf (BR-1248). Free text
 *     excuses nothing; a stored value that is not a BR-n id is CORRUPT data ({@link findCorruptSiteMapValues}), never "unmapped".
 *   - `gaps` (keyed) and `notMeasured` (dynamic) are REPORT output: they never decide an exit code. Only a runnable command
 *     no leaf declares ({@link computeUndeclaredCommands}) refuses (BR-1248, BR-660).
 *   - Bootstrap sites (site-census `bootstrap`, app wiring / config loading) are never reported as unmapped; the verdict
 *     does not echo them (the caller reports them).
 *   - A census with unresolved imports (site-census `unresolvedImports`) is a lower bound, never a complete list: they are
 *     reported as `unresolvedImports` (`<specifier> (from <file>)`) and make `ok` false.
 *   - `ok` iff `gaps`, `notMeasured` and `unresolvedImports` are all empty ("fully mapped"). Output follows the order of `sites`.
 * Side-effect class: pure.
 */

import type { Site, UnresolvedImport } from "./site-census.js";

/** Verdict of {@link computeLeafCoverage}; both lists hold site keys. */
export interface LeafCoverage {
  /** Keyed sites with no live-rule mapping (reported, never refused). */
  readonly gaps: string[];
  /** Dynamic sites the census could not measure and no live rule maps (reported, never refused). */
  readonly notMeasured: string[];
  /** `<specifier> (from <file>)` for each import the census could not resolve: sites behind it are missing. */
  readonly unresolvedImports?: string[];
  readonly ok: boolean;
}

/** The command that accounts for one unaccounted (site, leaf) pair: map the site to a live rule. */
export function siteFixCommand(leafSlug: string, siteKey: string): string {
  return `lore baseline map ${leafSlug} --site ${siteKey} --rule <BR-n>`;
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
 * The sites a command-less (cross-cutting) leaf owns: its own `site_map` keys. There is no census to run for such a leaf;
 * these are the sites its rules guard (BL-D1). A hand-off from another leaf no longer exists: free-text entries excuse nothing.
 *
 * @param ownSiteMap - the leaf's own `site_map`.
 * @returns the owned sites, sorted by key.
 */
export function collectOwnedSites(input: { ownSiteMap: Readonly<Record<string, readonly string[]>> }): Site[] {
  return Object.keys(input.ownSiteMap).sort().map(siteFromKey);
}

/** One stored `site_map` value that is not a `BR-n` id: the corpus holds an entry the grammar no longer admits. */
export interface CorruptSiteMapValue {
  readonly leaf: string;
  readonly site: string;
  readonly value: string;
}

const RULE_ID_PATTERN = /^BR-\d+$/;

/**
 * Every stored site_map value of a leaf that is not a `BR-n` id (BR-1248: a site map takes rule ids only). Such a value is
 * corrupt data, so coverage exits 2 naming it rather than reading it as "unmapped" or as an excuse.
 *
 * @param leafSlug - the leaf the map belongs to (named in the refusal).
 * @param siteMap - the leaf's stored `site_map`.
 * @returns the offending (leaf, site, value) triples, in site then value order.
 */
export function findCorruptSiteMapValues(leafSlug: string, siteMap: Readonly<Record<string, readonly string[]>>): CorruptSiteMapValue[] {
  return Object.keys(siteMap)
    .sort()
    .flatMap((site) => (siteMap[site] ?? []).filter((value) => !RULE_ID_PATTERN.test(value)).map((value) => ({ leaf: leafSlug, site, value })));
}

/** The command that declares a runnable command on a leaf (`<leaf>` is the leaf that owns the command's behaviour). */
export function commandFixCommand(command: string): string {
  return `lore baseline map <leaf> --command ${/\s/.test(command) ? `"${command}"` : command}`;
}

/** The command that drops a declared command this tree does not have from its leaf (right when it is stale, wrong when it is pending). */
export function absentCommandFixCommand(leafSlug: string, command: string): string {
  return `lore baseline map ${leafSlug} --remove-command "${command}"`;
}

/**
 * Split a leaf's declared commands into live and absent (never a census error, and never a coverage defect: an absent command
 * may be pending in a branch that has not landed). A command is absent when it resolves to no census entry, or its entry is no longer a runnable registry command.
 *
 * @param declared - the leaf's `extra.commands`.
 * @param entryKeys - `file#symbol` of each declared command, or `undefined` when it resolves to no census entry (the caller
 *   maps ONLY a command-unresolved failure to `undefined`; any other failure must propagate, never read as absent). Data, not a
 *   callback: the census would otherwise see an unresolvable call here and ask every reaching leaf to account for it.
 * @param runnableEntries - `file#symbol` of every command the registry lists.
 */
export function partitionDeclaredCommands(
  declared: readonly string[],
  entryKeys: ReadonlyMap<string, string | undefined>,
  runnableEntries: ReadonlySet<string>,
): { live: string[]; absent: string[] } {
  const live: string[] = [];
  const absent: string[] = [];
  for (const command of declared) {
    const key = entryKeys.get(command);
    (key !== undefined && runnableEntries.has(key) ? live : absent).push(command);
  }
  return { live, absent };
}

/** A leaf's declared commands, as the approval and status checks read them. */
export interface DeclaringLeaf {
  readonly slug: string;
  readonly commands: readonly string[];
}

/** One stale-or-pending declaration: `leaf` declares `command`, which main's tree does not have. */
export interface AbsentDeclaration {
  readonly leaf: string;
  readonly command: string;
  readonly fix: string;
}

/**
 * The leaves of the baseline tree at or below `node` (the node itself when it is a leaf), each with its declared commands.
 * Leaves declaring no command are omitted: they have nothing to measure.
 */
export function leavesUnder(
  node: { id: string; slug: string; extra: Record<string, unknown> },
  baselineDocs: readonly { id: string; slug: string; parent_id?: string | null; extra: Record<string, unknown> }[],
): DeclaringLeaf[] {
  const out: DeclaringLeaf[] = [];
  const queue: { id: string; slug: string; extra: Record<string, unknown> }[] = [node];
  while (queue.length > 0) {
    const doc = queue.shift() as { id: string; slug: string; extra: Record<string, unknown> };
    if (doc.extra["node"] === "leaf") {
      const commands = Array.isArray(doc.extra["commands"]) ? (doc.extra["commands"] as string[]) : [];
      if (commands.length > 0) out.push({ slug: doc.slug, commands });
    } else {
      queue.push(...baselineDocs.filter((d) => d.parent_id === doc.id));
    }
  }
  return out.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

/** Every absent declaration of `leaves`, by the SAME predicate coverage uses ({@link partitionDeclaredCommands}). */
export function absentDeclarationsOf(
  leaves: readonly DeclaringLeaf[],
  entryKeys: ReadonlyMap<string, string | undefined>,
  runnableEntries: ReadonlySet<string>,
): AbsentDeclaration[] {
  return leaves.flatMap((leaf) =>
    partitionDeclaredCommands(leaf.commands, entryKeys, runnableEntries).absent.map((command) => ({
      leaf: leaf.slug,
      command,
      fix: absentCommandFixCommand(leaf.slug, command),
    })),
  );
}

/** The approval refusal text: names each absent command with the fix that drops it. */
export function absentDeclarationRefusal(approvedSlug: string, absent: readonly AbsentDeclaration[]): string {
  const lines = absent.map((a) => `  ${a.leaf} declares "${a.command}", which main's tree does not have: ${a.fix}`);
  return (
    `Cannot approve ${approvedSlug}: ${absent.length} declared command(s) are absent from main's tree. ` +
    `Remove each stale declaration, or approve once the command has landed on main:\n${lines.join("\n")}`
  );
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

function isMappedToLiveRule(entries: readonly string[] | undefined, live: ReadonlySet<string>): boolean {
  return entries !== undefined && entries.some((entry) => live.has(entry));
}

/**
 * Compare census sites against a leaf's site map.
 *
 * @param input.sites - Sites from `listSites`.
 * @param input.bootstrap - Bootstrap sites from the census (`listSites(...).bootstrap`); default none.
 * @param input.siteMap - siteKey -> rule ids (`BR-n`); any other value is ignored here (see {@link findCorruptSiteMapValues}).
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
    if (isMappedToLiveRule(input.siteMap[site.key], live)) continue;
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
