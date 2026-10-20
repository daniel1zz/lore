/**
 * Module: leaf-coverage — decide whether a baseline leaf accounts for every census site.
 *
 * Purpose: the pure verdict half of the completeness census (spec baseline-slice-2 C2): given the
 *   sites a leaf's commands reach (each carrying the rules the TREE declares there, BR-1344) and the leaf's rule ids,
 *   report what is mapped, unmapped, in conflict or declared against a dead rule.
 * Public surface: {@link computeLeafCoverage}, {@link sitesDeclaringRulesOf}, {@link partitionDeclaredCommands},
 *   {@link absentCommandFixCommand}, {@link leavesUnder}, {@link absentDeclarationsOf}, {@link absentDeclarationRefusal},
 *   {@link AbsentDeclaration}, {@link LeafCoverage}.
 * Invariants:
 *   - A site is mapped for a leaf only when the code declares exactly one rule there and that rule is a LIVE rule of the leaf
 *     (BR-1344). The corpus holds no site mapping; it contributes liveness and commands only.
 *   - `gaps` (keyed) and `notMeasured` (dynamic) are REPORT output: they never decide an exit code. Only a runnable command
 *     no leaf declares ({@link computeUndeclaredCommands}) refuses (BR-1248, BR-660).
 *   - Bootstrap sites (site-census `bootstrap`, app wiring / config loading) are never reported as unmapped; the verdict
 *     does not echo them (the caller reports them).
 *   - A census with unresolved imports (site-census `unresolvedImports`) is a lower bound, never a complete list: they are
 *     reported as `unresolvedImports` (`<specifier> (from <file>)`) and make `ok` false.
 *   - `ok` iff `gaps`, `notMeasured` and `unresolvedImports` are all empty ("fully mapped"). Output follows the order of `sites`.
 * Side-effect class: pure.
 */

import { approvedCommandsOf } from "./baseline-items.js";
import type { Site, UnresolvedImport } from "./site-census.js";
import { classifySiteDeclaration, type RuleStatus, type RuleStatusOf } from "./site-declarations.js";

/** One reached site that declares one of the leaf's own live rules. */
export interface MappedSite {
  readonly key: string;
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  /** Present when the site declares nothing itself and takes the rule of the predicate above it: where that predicate is written. */
  readonly via?: { readonly file: string; readonly line: number; readonly symbol: string };
}

/** One reached site shared by predicates of different rules: the census lists their rules and attributes the site to none. */
export interface GenericSite {
  readonly key: string;
  readonly file: string;
  readonly line: number;
  readonly rules: readonly string[];
  readonly predicates: readonly { readonly rule: string; readonly file: string; readonly line: number; readonly symbol: string }[];
}

/** One reached site whose code declares two or more rules (a site carries at most one). */
export interface ConflictedSite {
  readonly key: string;
  readonly file: string;
  readonly line: number;
  readonly rules: readonly string[];
}

/** One reached site whose declared rule is retired, deprecated or unknown to the corpus. */
export interface InvalidDeclaration {
  readonly key: string;
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly status: Exclude<RuleStatus, "live">;
}

/** Verdict of {@link computeLeafCoverage}; `gaps` and `notMeasured` hold site keys. */
export interface LeafCoverage {
  /** The leaf's own live rules, each declared at a reached site: file:line and rule. */
  readonly mapped: MappedSite[];
  /** Keyed sites that declare no rule (reported, never refused). */
  readonly gaps: string[];
  /** Dynamic sites the census could not measure and that declare no rule (reported, never refused). */
  readonly notMeasured: string[];
  /** Sites declaring more than one rule. */
  readonly conflicts: ConflictedSite[];
  /** Sites declaring a retired, deprecated or unknown rule id. */
  readonly invalid: InvalidDeclaration[];
  /** Shared sites reached through predicates of different rules (`generic`): reported with those rules, never attributed to one. */
  readonly generic: GenericSite[];
  /** `<specifier> (from <file>)` for each import the census could not resolve: sites behind it are missing. */
  readonly unresolvedImports?: string[];
  readonly ok: boolean;
}

/** The fix line for one site that declares no rule: where to write the declaration. */
export function siteFixHint(site: { key: string; file: string; line: number; dynamic: boolean }): string {
  return site.dynamic
    ? `tag the callee or the statement at ${site.file}:${site.line} with \`@lore-site BR-<n>\``
    : `declare the rule at ${site.file}:${site.line}: \`rule: "BR-<n>"\` on the refusal, or the rule argument of its helper`;
}

/**
 * The sites (from the union census of every live command) that declare one of `ruleIds`: what a command-less (cross-cutting)
 * leaf owns. There is no census to run for such a leaf; the code names the sites its rules guard (BL-D1, BR-1344).
 *
 * @param sites - every non-bootstrap site of every censused command, de-duplicated by key.
 * @param ruleIds - the leaf's rule ids (any lifecycle: a retired rule's site still belongs to the leaf that held it).
 */
export function sitesDeclaringRulesOf(sites: readonly Site[], ruleIds: ReadonlySet<string>): Site[] {
  return sites.filter((site) => (site.rules.length > 0 ? site.rules : site.predicates.map((p) => p.rule)).some((rule) => ruleIds.has(rule)));
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
      const commands = approvedCommandsOf(doc);
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

/**
 * Judge the declarations the tree makes at a leaf's reached sites.
 *
 * @param input.sites - Sites from `listSites` (each carries `rules`, read from the tree being judged).
 * @param input.bootstrap - Bootstrap sites from the census (`listSites(...).bootstrap`); default none.
 * @param input.liveRuleIds - ids of the leaf's live rules.
 * @param input.statusOf - corpus liveness of any rule id; absent = every single declaration is read as live.
 * @example
 * computeLeafCoverage({ sites, liveRuleIds: ["BR-1"], statusOf });
 */
export function computeLeafCoverage(input: {
  sites: readonly Site[];
  bootstrap?: readonly Site[];
  unresolvedImports?: readonly UnresolvedImport[];
  liveRuleIds: readonly string[];
  statusOf?: RuleStatusOf;
}): LeafCoverage {
  const live = new Set(input.liveRuleIds);
  const mapped: MappedSite[] = [];
  const gaps: string[] = [];
  const notMeasured: string[] = [];
  const conflicts: ConflictedSite[] = [];
  const invalid: InvalidDeclaration[] = [];
  const generic: GenericSite[] = [];
  const bootstrap = new Set((input.bootstrap ?? []).map((s) => s.key));
  for (const site of input.sites) {
    if (bootstrap.has(site.key)) continue;
    const at = { key: site.key, file: site.file, line: site.line };
    const declaration = classifySiteDeclaration(site.rules, input.statusOf, site.predicates);
    if (declaration.state === "unmapped") (site.dynamic ? notMeasured : gaps).push(site.key);
    else if (declaration.state === "conflict") conflicts.push({ ...at, rules: declaration.rules });
    else if (declaration.state === "generic") generic.push({ ...at, rules: declaration.rules, predicates: declaration.predicates });
    else if (declaration.state === "declared") {
      // reason: a site declaring ANOTHER leaf's live rule is accounted for by that leaf; it is neither this leaf's mapping nor a gap.
      if (live.has(declaration.rule)) mapped.push({ ...at, rule: declaration.rule, ...(declaration.via !== undefined ? { via: { file: declaration.via.file, line: declaration.via.line, symbol: declaration.via.symbol } } : {}) });
    } else invalid.push({ ...at, rule: declaration.rule, status: declaration.state });
  }
  const unresolvedImports = (input.unresolvedImports ?? []).map((u) => `${u.specifier} (from ${u.from})`);
  // reason: the key appears only when non-empty, so a complete verdict keeps its pre-#94 shape byte-for-byte.
  return {
    mapped,
    gaps,
    notMeasured,
    conflicts,
    invalid,
    generic,
    ...(unresolvedImports.length > 0 ? { unresolvedImports } : {}),
    ok: gaps.length === 0 && notMeasured.length === 0 && conflicts.length === 0 && invalid.length === 0 && generic.length === 0 && unresolvedImports.length === 0,
  };
}
