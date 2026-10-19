/**
 * lore baseline — the dedicated writer of the product-baseline tree's nodes.
 *
 * Subcommands (thin pipes over `RuleService`):
 *   add <parent> [--tree business|architecture] --node <kind> --label <l> --title <t> [--content-file <path>]
 *       Create a baseline node. Business (default): root under a PRD, branch/leaf under a root|branch.
 *       Architecture: root under a PRD, section under the architecture root, module-card|standard|
 *       debt-registry under a section.
 *   set-label <node> <label>
 *   depends <leaf> [--add BR-n]... [--remove BR-n]...
 *   glossary add <node> --term <t> --meaning <m> [--note <n>]   (root|branch only)
 *   glossary rm  <node> --term <t>
 *   map <leaf> [--site <key> (--rule BR-n... | --non-business <reason>)] [--sites-file <path>] [--remove-site <key>]...
 *               [--command <name>]... [--remove-command <name>]...
 *                   The ONLY writer of `extra.site_map` / `extra.commands` (leaf only). With no change
 *                   flag it authorizes through the corpus-write guard (claim scope, AC-BLS2-8), reports
 *                   the verdict and records nothing.
 *   sites <command> Static census (TypeScript compiler API) of the failure sites the CLI command can
 *                   reach: prints the count and every key; `~` marks a not_measured (dynamic) site.
 *                   Name rule: token 1 = commands/<token>.ts, further tokens = nested subCommands;
 *                   `ac-add` = file `ac` + subcommand `add` (see site-census.ts::resolveCommandEntry).
 *   coverage <leaf|branch|root> [--json] [--commands-only]
 *                   Per leaf: census of its declared `commands` vs its `site_map`. Exit 0 only when
 *                   every leaf has commands, 0 gaps and 0 unaccounted not_measured sites. The leaf's
 *                   commands are an explicit stored field (`--command`), not derived: a leaf's
 *                   Command section is prose without CLI names.
 *   fidelity --size N --seed S [--judges 1|2] [--exclusions] [--ai] [--json]
 *                   Seeded sample of live (criterion, rule) citations - or, with --exclusions, of the
 *                   `non-business:` site-map entries - judged by the AI provider; the record is stored as
 *                   a `research` knowledge doc and printed. Read-only on rules/citations/site_map.
 *                   Never skips the judge: without --ai on a surface whose AI default is off it refuses
 *                   (exit 2); size > pool or a bad flag exits 2; a judge failure or malformed reply exits 6.
 *   adopt [--mode report|enforce] [--arm <branch>]... [--disarm <branch>]...
 *                   Audited writer of workflow.gates."ac-cite" (config + one `baseline_adopt` audit row); see baseline-adopt.ts.
 *   tree [root] [--states] [--rule BR-n]
 *                   Listing (node kind, label, status, rule tallies). `--states` adds every rule's
 *                   verification state with its inputs and `computed_from`; `--rule BR-n` prints
 *                   that one rule (citing ACs, state, inputs). Git is consulted only for these two.
 *
 * `lore set` cannot touch `extra.node|label|depends_on|glossary` (CorpusService replace
 * guard) — these verbs are the only writers. Exit codes follow `exitCode(LoreError)`.
 *
 * Source: spec-baseline-slice-1-rules-with-permanent-ids-ac-citations §C3 (§C7 for `tree`).
 */

import { readFileSync } from "node:fs";

import { defineLoreCommand } from "../cli-exit.js";
import { AiConfigSchema, BASELINE_TREES, ruleIdPrefixOfNode } from "@lore/core";
import type { AIProvider, BaselineTree, DocRecord, Invocation, LoreError } from "@lore/core";
import { invocationOf } from "../command-invocation.js";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor, resolveActor } from "../utils.js";
import type { App } from "../../../app.js";
import type { AddNodeInput, BaselineTreeEntry, SiteMapChange } from "../../../service/rule-service.js";
import { NON_BUSINESS_PREFIX, commandFixCommand, collectOwnedSites, computeLeafCoverage, findCorruptSiteMapValues, computeUndeclaredCommands, partitionDeclaredCommands, siteFixCommand, absentCommandFixCommand } from "../../../service/leaf-coverage.js";
import { treePredicateFor } from "../absent-declarations.js";
import { resolveDoc } from "../../../service/resolve.js";
import { SiteCensusError, type UnresolvedImport, findCensusRoot, listSitesMany, resolveCommandEntry } from "../../../service/site-census.js";
import type { Site, SiteList } from "../../../service/site-census.js";
import { RuleStateService } from "../../../service/rule-state-service.js";
import type { RuleStateEntry, RuleStateFull } from "../../../service/rule-state-service.js";
import { SpawnGitPort, resolveGitRoot } from "../../../service/rule-state-git-port.js";
import { SQLiteStore } from "../../../store/sqlite-store.js";
import { buildProviderRegistry } from "../../../ai/registry.js";
import { adoptCommand } from "./baseline-adopt.js";
import { runFidelity } from "../../../service/fidelity-sample.js";
import type { FidelityRecord } from "../../../service/fidelity-sample.js";
import { printLine } from "../output.js";
import type { CliIo } from "../output.js";
import type { ExitReport } from "../cli-exit.js";

function repeatable(value: unknown): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

/**
 * Parse the body of a `--sites-file`: a JSON array of `{ site, rules: [BR-n...] }` or `{ site, nonBusiness: "<reason>" }`
 * rows into the `sites` map of one {@link SiteMapChange}. Pure; names the offending row (1-based) and site key.
 *
 * @param text - file contents
 * @param taken - site keys already named elsewhere in the same call (e.g. by `--site`); repeating one is a duplicate
 * @returns the sites map, or a VALIDATION_ERROR for not-JSON / not-an-array / empty / a malformed row / a duplicate site key
 */
export function parseSitesFile(text: string, taken: ReadonlySet<string> = new Set()): { ok: true; sites: Record<string, string[]> } | { ok: false; error: LoreError } {
  const fail = (message: string, value?: unknown): { ok: false; error: LoreError } => ({
    ok: false,
    error: { code: "VALIDATION_ERROR", field: "sites-file", message, ...(value !== undefined ? { value } : {}) } as LoreError,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    return fail(`sites file is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (!Array.isArray(parsed)) return fail("sites file must be a JSON array of { site, rules | nonBusiness } rows");
  if (parsed.length === 0) return fail("sites file must contain at least one row");
  const sites: Record<string, string[]> = {};
  const seen = new Set<string>(taken);
  for (const [i, row] of parsed.entries()) {
    const at = `row ${i + 1}`;
    if (typeof row !== "object" || row === null || Array.isArray(row)) return fail(`${at} must be an object { site, rules | nonBusiness }`);
    const { site, rules, nonBusiness } = row as Record<string, unknown>;
    if (typeof site !== "string" || site.trim().length === 0) return fail(`${at} needs a non-empty string 'site'`);
    const hasRules = rules !== undefined;
    const hasReason = nonBusiness !== undefined;
    if (hasRules === hasReason) return fail(`${at} (site '${site}') needs exactly one of 'rules' (array of BR-n) or 'nonBusiness' (reason string)`, site);
    if (seen.has(site)) return fail(`duplicate site key '${site}' at ${at}`, site);
    seen.add(site);
    if (hasRules) {
      if (!Array.isArray(rules) || rules.length === 0 || !rules.every((r) => typeof r === "string" && r.trim().length > 0)) {
        return fail(`${at} (site '${site}'): 'rules' must be a non-empty array of rule id strings`, site);
      }
      sites[site] = rules as string[];
    } else {
      if (typeof nonBusiness !== "string" || nonBusiness.trim().length === 0) return fail(`${at} (site '${site}'): 'nonBusiness' must be a non-empty reason string`, site);
      sites[site] = [`${NON_BUSINESS_PREFIX}${nonBusiness}`];
    }
  }
  return { ok: true, sites };
}

function reportFailure(inv: Invocation, error: LoreError, json: boolean): ExitReport {
  if (json) printLine(inv.io.stdout, JSON.stringify({ ok: false, error }, null, 2));
  else inv.io.stderr.write(formatErrorFor(inv, error));
  return exitCode(error);
}

function requireRuleService(io: CliIo, app: App) {
  if (app.ruleService === undefined) {
    io.stderr.write("Error: RuleService is not available in this build.\n");
    return undefined;
  }
  return app.ruleService;
}

/** Shared by every verb: open the app, run `body` with the service, always close. */
async function withRuleService(inv: Invocation, body: (svc: NonNullable<App["ruleService"]>) => Promise<ExitReport>): Promise<ExitReport> {
  const { app } = loadLoreApp({ inv });
  try {
    const svc = requireRuleService(inv.io, app);
    if (svc === undefined) return 1;
    return await body(svc);
  } finally {
    app.close();
  }
}

function renderRuleState(io: CliIo, rule: RuleStateEntry, indent: string, statement?: string): void {
  const reason = rule.unknown_reason !== undefined ? ` (${rule.unknown_reason})` : "";
  const lifecycle = rule.lifecycle === "live" ? "" : ` [${rule.lifecycle}]`;
  printLine(io.stdout, `${indent}${rule.rule_id} ${rule.state}${reason}${lifecycle}${statement !== undefined ? ` - ${statement}` : ""}`);
  if (rule.inputs.length === 0) printLine(io.stdout, `${indent}  (no citing script-mode AC)`);
  for (const input of rule.inputs) {
    const run =
      input.evidence_result === null
        ? "no attested run"
        : `${input.evidence_result} @ ${input.evidence_recorded_at ?? "?"} sha ${input.head_sha?.slice(0, 12) ?? "none"}`;
    printLine(io.stdout, `${indent}  ${input.spec}#${input.ac_id}: ${run}; anchors: ${input.anchor_paths.length === 0 ? "none" : input.anchor_paths.join(", ")}`);
  }
}

function renderComputedFrom(io: CliIo, full: RuleStateFull): void {
  printLine(io.stdout, 
    `computed_from: head ${full.computed_from.head_sha ?? "unavailable (git)"}, corpus version ${full.computed_from.corpus_version}; ambiguous_ac_ref ${full.ambiguous_ac_ref}`,
  );
}

/** `tree --states` / `tree --rule`: the only baseline verbs that consult git, via a read-only second store handle. */
async function runStatesTree(args: Record<string, unknown>, inv: Invocation): Promise<ExitReport> {
  const json = args.json === true;
  const { app, dbPath } = loadLoreApp({ inv });
  const store = new SQLiteStore(dbPath);
  try {
    const svc = requireRuleService(inv.io, app);
    if (svc === undefined) return 1;
    const stateService = new RuleStateService(store, new SpawnGitPort(resolveGitRoot(inv.cwd)));
    const rule = typeof args.rule === "string" ? args.rule : undefined;
    const full = await stateService.full(rule !== undefined ? { rule } : undefined);
    if (!full.ok) return reportFailure(inv, full.error, json);
    const tree = await svc.listBaselineTree(rule !== undefined ? undefined : (args.root as string | undefined));
    if (!tree.ok) return reportFailure(inv, tree.error, json);

    const byLeaf = new Map<string, RuleStateEntry[]>();
    for (const entry of full.value.rules) byLeaf.set(entry.leaf, [...(byLeaf.get(entry.leaf) ?? []), entry]);

    if (rule !== undefined) {
      const entry = full.value.rules[0] as RuleStateEntry;
      const leafDoc = await store.findBySlug(entry.leaf);
      const rules = leafDoc.ok && leafDoc.value !== null ? leafDoc.value.extra["rules"] : undefined;
      const statement = Array.isArray(rules)
        ? (rules as Array<{ id?: unknown; statement?: unknown }>).find((r) => r.id === rule)?.statement
        : undefined;
      if (json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { rule: entry, statement: statement ?? null, computed_from: full.value.computed_from, ambiguous_ac_ref: full.value.ambiguous_ac_ref } }, null, 2));
        return 0;
      }
      printLine(inv.io.stdout, `Leaf: ${entry.leaf}`);
      renderRuleState(inv.io, entry, "", typeof statement === "string" ? statement : undefined);
      renderComputedFrom(inv.io, full.value);
      return 0;
    }

    if (json) {
      const nodes = tree.value.map((n: BaselineTreeEntry) => ({ ...n, rule_states: byLeaf.get(n.slug) ?? [] }));
      printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { tree: nodes, computed_from: full.value.computed_from, ambiguous_ac_ref: full.value.ambiguous_ac_ref } }, null, 2));
      return 0;
    }
    if (tree.value.length === 0) {
      printLine(inv.io.stdout, "No baseline nodes.");
      return 0;
    }
    for (const entry of tree.value) {
      const indent = "  ".repeat(entry.depth);
      printLine(inv.io.stdout, `${indent}${entry.node} ${entry.label ?? entry.title} (${entry.slug}, ${entry.status})`);
      // reason: byLeaf is keyed by the rule-holding doc (business leaf or architecture standard, BR-670); any other node has no entry.
      for (const r of byLeaf.get(entry.slug) ?? []) renderRuleState(inv.io, r, `${indent}  `);
    }
    renderComputedFrom(inv.io, full.value);
  } finally {
    store.close();
    app.close();
  }
  return 0;
}

function requireCensusRoot(inv: Invocation): string {
  const root = findCensusRoot(inv.cwd);
  if (root === undefined) {
    throw new SiteCensusError("command-unresolved", {
      reason: "not inside a lore source checkout (packages/lore/src/adapters/cli/commands not found upward from cwd); the census analyses source, an installed binary has none",
      cwd: inv.cwd,
    });
  }
  return root;
}

function reportCensusFailure(inv: Invocation, cause: unknown, json: boolean): ExitReport {
  if (!(cause instanceof SiteCensusError)) throw cause;
  return reportFailure(inv, { code: "VALIDATION_ERROR", field: `census:${cause.reason}`, message: cause.message }, json);
}

/** Print the root's refusal: each runnable command no leaf declares, with its fix line. Prints nothing when there is none. */
function printUndeclared(inv: Invocation, undeclared: readonly string[]): void {
  if (undeclared.length === 0) return;
  printLine(inv.io.stdout, `undeclared commands (${undeclared.length}): runnable commands no leaf declares, so none of their sites are censused`);
  for (const command of undeclared) printLine(inv.io.stdout, `  undeclared   ${command}\n    fix: ${commandFixCommand(command)}`);
}

interface LeafCoverageReport {
  slug: string;
  commands: string[];
  /** Declared commands this tree does not have (pending in an unlanded branch, or stale): reported, never a coverage defect. */
  absent_commands: { command: string; fix: string }[];
  /** Mappings of a command-measured leaf whose site this tree no longer reaches: removable once main (the corpus checkout) no longer reaches them either. */
  stale_site_maps: { site: string; fix: string }[];
  /** What measured the leaf: its declared commands' census, the sites it owns (no live command), `absent` (it declares commands, all absent from this tree, and owns no site: pending), or nothing (no command, no owned site: unmeasured). */
  measured_by: "commands" | "owned_sites" | "absent" | "none";
  sites: number;
  gaps: string[];
  not_measured: string[];
  /** Imports the census could not resolve; non-empty means the site list is a lower bound and the leaf is NOT complete. */
  unresolved_imports: string[];
  bootstrap: string[];
  /** One fix command per entry of `gaps` then `not_measured`, in that order: how to account for that (site, leaf) pair. */
  fix_commands: string[];
  ok: boolean;
}

/**
 * `coverage <leaf|branch>`: census each leaf's declared `commands`, compare with its `site_map`.
 * A leaf declaring no command is measured by the sites it owns (see collectOwnedSites); one that owns none is
 * UNMEASURED and NOT ok — completeness of an unmeasured leaf is unproven.
 */
async function runCoverage(target: string, json: boolean, commandsOnly: boolean, inv: Invocation): Promise<ExitReport> {
  const { app, dbPath } = loadLoreApp({ inv });
  const store = new SQLiteStore(dbPath);
  try {
    const rootDir = requireCensusRoot(inv);
    const resolved = await resolveDoc(store, target);
    if (!resolved.ok) return reportFailure(inv, resolved.error, json);
    if (resolved.value.type !== "baseline") {
      return reportFailure(inv, { code: "VALIDATION_ERROR", field: "target", message: `'${target}' is a ${resolved.value.type}, not a baseline node` }, json);
    }
    const all = await store.findMany({ type: "baseline" });
    if (!all.ok) return reportFailure(inv, all.error, json);
    const leaves: DocRecord[] = [];
    const queue: DocRecord[] = [resolved.value];
    while (queue.length > 0) {
      const doc = queue.shift() as DocRecord;
      if (doc.extra["node"] === "leaf") leaves.push(doc);
      else queue.push(...all.value.filter((d) => d.parent_id === doc.id));
    }
    leaves.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    // reason: every distinct command of every leaf is censused ONCE over one shared program (BR-1248); a per-leaf
    // census rebuilt the program per command (~2.8 s each, 128 commands).
    const leafCommands = (leaf: DocRecord): string[] => (Array.isArray(leaf.extra["commands"]) ? (leaf.extra["commands"] as string[]) : []);
    // reason: a declared command absent from the analysed tree is REPORTED, never a coverage defect: a branch that adds a command
    // must declare it in the shared corpus before it lands, so every other branch's tree lacks it until then and refusing it would
    // block every other integrate. It also must not surface as a census error (exit 4) from resolveCommandEntry; only an
    // unanalysable tree still throws.
    const { runnable, entryKeys, runnableEntries } = await treePredicateFor(rootDir, leaves.flatMap(leafCommands));
    const partitionByLeaf = new Map(leaves.map((leaf) => [leaf.slug, partitionDeclaredCommands(leafCommands(leaf), entryKeys, runnableEntries)]));
    const livePartition = (leaf: DocRecord) => partitionByLeaf.get(leaf.slug) as { live: string[]; absent: string[] };
    // reason: complete coverage is absolute at the root (BR-660): a runnable command declared by no leaf is never
    // censused. This is the ONLY refusal of this verb (BR-1248); only the root asks, a leaf or branch judges its own commands.
    const undeclared =
      resolved.value.extra["node"] === "root"
        ? computeUndeclaredCommands(
            runnable,
            new Set(
              leaves
                .flatMap((leaf) => livePartition(leaf).live)
                .map((command) => entryKeys.get(command) as string),
            ),
          )
        : [];
    const undeclaredCommands = undeclared.map((command) => ({ command, fix: commandFixCommand(command) }));
    // reason: `--commands-only` is the integrate floor's mode: it needs only the registry and the declarations, so it never runs the
    // site census (the expensive half, and not a refusal).
    if (commandsOnly) {
      if (json) printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { target: resolved.value.slug, complete: undeclared.length === 0, leaves: [], undeclared_commands: undeclaredCommands } }, null, 2));
      else printUndeclared(inv, undeclared);
      return undeclared.length === 0 ? 0 : 1;
    }
    // reason: a stored site_map value that is not a BR-n id is corrupt data (BR-1248): exit 2 naming leaf, site and value, on the full report only, before any
    // verdict, so it is never read as "unmapped" and never excuses a site.
    const corrupt = leaves.flatMap((leaf) => findCorruptSiteMapValues(leaf.slug, (leaf.extra["site_map"] ?? {}) as Record<string, string[]>));
    if (corrupt.length > 0) {
      if (json) printLine(inv.io.stdout, JSON.stringify({ ok: false, error: { code: "SITE_MAP_CORRUPT", entries: corrupt } }, null, 2));
      else for (const c of corrupt) inv.io.stderr.write(`Error: leaf ${c.leaf} stores site_map value ${JSON.stringify(c.value)} for site ${c.site}: a site map takes BR-n rule ids only\n  fix: lore baseline map ${c.leaf} --remove-site ${c.site}\n`);
      return 2;
    }
    // reason: `--commands-only` returned above without reading any site_map value (BR-1248: the floor reads only the registry and the
    // declarations), so leftover excuse entries make only this full report exit 2, never the integrate floor.
    const censusByCommand = listSitesMany({ rootDir, commands: leaves.flatMap((leaf) => livePartition(leaf).live) });
    const reports: LeafCoverageReport[] = leaves.map((leaf) => {
      const commands = leafCommands(leaf);
      const { live, absent } = livePartition(leaf);
      const byKey = new Map<string, Site>();
      const bootstrapByKey = new Map<string, Site>();
      const unresolvedByKey = new Map<string, UnresolvedImport>();
      for (const command of live) {
        const census = censusByCommand.get(command) as SiteList;
        for (const u of census.unresolvedImports) unresolvedByKey.set(`${u.specifier}\0${u.from}`, u);
        for (const site of census) byKey.set(site.key, site);
        for (const site of census.bootstrap) bootstrapByKey.set(site.key, site);
      }
      const siteMap = (leaf.extra["site_map"] ?? {}) as Record<string, string[]>;
      // reason: BL-D1 - a cross-cutting leaf declares no command (its rules guard sites other leaves' commands reach), so it
      // is measured by the sites it owns instead of a proxy command; owning none is UNMEASURED, never silently ok.
      // reason: a leaf whose declared commands are ALL absent from this tree is measured as if command-less.
      const ownedSites =
        live.length > 0
          ? []
          : collectOwnedSites({ ownSiteMap: siteMap });
      for (const site of ownedSites) byKey.set(site.key, site);
      const rules = Array.isArray(leaf.extra["rules"]) ? (leaf.extra["rules"] as Array<{ id: string; lifecycle: string }>) : [];
      const verdict = computeLeafCoverage({
        sites: [...byKey.values()],
        bootstrap: [...bootstrapByKey.values()],
        unresolvedImports: [...unresolvedByKey.values()],
        siteMap,
        liveRuleIds: rules.filter((r) => r.lifecycle === "live").map((r) => r.id),
      });
      return {
        slug: leaf.slug,
        commands,
        measured_by: live.length > 0 ? "commands" : ownedSites.length > 0 ? "owned_sites" : absent.length > 0 ? "absent" : "none",
        absent_commands: absent.map((command) => ({ command, fix: absentCommandFixCommand(leaf.slug, command) })),
        // reason: only a leaf measured by its commands has a census to compare with; an owned-sites leaf's own keys ARE its sites.
        stale_site_maps:
          live.length > 0
            ? Object.keys(siteMap)
                .filter((key) => !byKey.has(key) && !bootstrapByKey.has(key))
                .sort()
                .map((site) => ({ site, fix: `lore baseline map ${leaf.slug} --remove-site ${site}` }))
            : [],
        sites: byKey.size,
        gaps: verdict.gaps,
        not_measured: verdict.notMeasured,
        unresolved_imports: verdict.unresolvedImports ?? [],
        bootstrap: [...bootstrapByKey.keys()].sort(),
        fix_commands: [...verdict.gaps, ...verdict.notMeasured].map((key) => siteFixCommand(leaf.slug, key)),
        // reason: a leaf declaring only absent commands is PENDING (its branch has not landed), not unmeasured; only ZERO declared commands
        // and no owned site is unmeasured (BL-D1), so an unlanded declaration never blocks another branch's integrate.
        ok: (live.length > 0 || ownedSites.length > 0 || absent.length > 0) && verdict.ok,
      };
    });
    const ok = undeclared.length === 0;
    if (json) {
      printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { target: resolved.value.slug, complete: ok, leaves: reports, undeclared_commands: undeclaredCommands } }, null, 2));
    } else {
      if (reports.length === 0) printLine(inv.io.stdout, `${resolved.value.slug}: no leaves under this node.`);
      for (const r of reports) {
        const state = r.measured_by === "absent" ? "PENDING (declared commands not in this tree)" : r.measured_by === "none" ? "UNMEASURED (no commands declared and no owned sites; use `lore baseline map --command` or map the sites it owns)" : r.ok ? "fully mapped" : "UNMAPPED sites (report only)";
        printLine(inv.io.stdout, `${r.slug}: ${state} - ${r.sites} site(s), ${r.gaps.length} gap(s), ${r.not_measured.length} not_measured, ${r.unresolved_imports.length} unresolved import(s), ${r.bootstrap.length} bootstrap (not counted as gaps)`);
        if (r.measured_by === "absent") printLine(inv.io.stdout, `  all declared commands absent from this tree (pending or stale): ${r.absent_commands.map((a) => a.command).join(", ")}`);
        for (const a of r.absent_commands) printLine(inv.io.stdout, `  declared command not in this tree: ${a.command} (pending in a branch that has not landed, or stale; not counted against coverage)\n    if stale: ${a.fix}`);
        for (const s of r.stale_site_maps) printLine(inv.io.stdout, `  stale mapping ${s.site} (this tree no longer reaches it; removable once main no longer does, refused until then)\n    fix: ${s.fix}`);
        for (const key of r.unresolved_imports) printLine(inv.io.stdout, `  unresolved  ${key} (census incomplete: sites behind this import are not listed)`);
        for (const key of r.gaps) printLine(inv.io.stdout, `  gap          ${key}\n    fix: ${siteFixCommand(r.slug, key)}`);
        for (const key of r.not_measured) printLine(inv.io.stdout, `  not_measured ${key}\n    fix: ${siteFixCommand(r.slug, key)}`);
        for (const key of r.bootstrap) printLine(inv.io.stdout, `  bootstrap    ${key}`);
      }
      const unmappedSites = reports.reduce((n, r) => n + r.gaps.length + r.not_measured.length, 0);
      const unmappedLeaves = reports.filter((r) => !r.ok).map((r) => r.slug);
      printLine(inv.io.stdout, `unmapped sites: ${unmappedSites} across ${unmappedLeaves.length} leaf(s) (report only, never a refusal)`);
      printUndeclared(inv, undeclared);
    }
    if (!ok) return 1;
  } catch (cause) {
    return reportCensusFailure(inv, cause, json);
  } finally {
    store.close();
    app.close();
  }
  return 0;
}

/** `--seed` stays a number when it is a plain integer, so the record and title read `seed 42`, not `seed "42"`. */
function parseSeed(raw: unknown): number | string | undefined {
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  return /^-?\d+$/.test(raw.trim()) ? Number(raw.trim()) : raw.trim();
}

function renderFidelityContent(record: FidelityRecord): string {
  const headline =
    record.mode === "exclusions"
      ? `${(((record.wrong_share ?? 0) * 100)).toFixed(1)}% of ${record.size} sampled exclusions judged wrong`
      : `${(record.faithful_share * 100).toFixed(1)}% of ${record.size} sampled citations judged faithful`;
  const catchAll = record.catch_all.map((c) => `- ${c.rule_id}: cited by ${c.citing_criteria.length} criteria`).join("\n");
  return [
    `# Baseline fidelity sample (${record.mode}, seed ${String(record.seed)})`,
    "",
    `${headline} (pool ${record.pool}, ${record.judges} judge(s), ${record.disagreements.length} disagreement(s)).`,
    "",
    `not_seen: ${record.not_seen} (sampled items never judged because a cited test file could not be read; not counted as faithful or wrong)`,
    ...(record.catch_all.length > 0 ? ["", `## Catch-all rules (> ${record.threshold_share * 100}% of citing criteria)`, catchAll] : []),
    "",
    "## Record",
    "```json",
    JSON.stringify(record, null, 2),
    "```",
    "",
  ].join("\n");
}

/**
 * Fidelity failures: SPEC-157 AC-BLS2-21 fixes a refused sample (size > pool, bad flag, AI off) at exit 2,
 * whereas `exitCode()` maps VALIDATION_ERROR to 4 - so VALIDATION_ERROR is pinned to 2 here and every other
 * error keeps its `exitCode()` (AI_PROVIDER_ERROR -> 6).
 */
function reportFidelityFailure(inv: Invocation, error: LoreError, json: boolean): ExitReport {
  const code = reportFailure(inv, error, json);
  return error.code === "VALIDATION_ERROR" ? 2 : code;
}

/** `fidelity`: validate flags, resolve the AI provider (never skipping the judge), run, store, print. */
async function runFidelityCommand(args: Record<string, unknown>, inv: Invocation): Promise<ExitReport> {
  const json = args.json === true;
  const fail = (field: string, message: string): ExitReport => reportFidelityFailure(inv, { code: "VALIDATION_ERROR", field, message }, json);
  const rawArgv = inv.argv;
  // reason: SPEC-024 tri-state AI flag - citty collapses --ai/--no-ai, so detect them in argv like assess.ts does.
  const hasExplicitAi = rawArgv.includes("--ai");
  if (rawArgv.includes("--no-ai")) return fail("ai", "lore baseline fidelity needs an AI judge; --no-ai is a contradiction (BR-964: the judge is never skipped)");

  const size = typeof args.size === "string" && /^\d+$/.test(args.size.trim()) ? Number(args.size.trim()) : undefined;
  if (size === undefined || size < 1) return fail("size", "--size <N> is required and must be a positive integer");
  const seed = parseSeed(args.seed);
  if (seed === undefined) return fail("seed", "--seed <S> is required (the same seed redraws the same sample)");
  const judgesRaw = args.judges === undefined ? "1" : String(args.judges);
  if (judgesRaw !== "1" && judgesRaw !== "2") return fail("judges", `--judges must be 1 or 2, got '${judgesRaw}'`);
  const judges = judgesRaw === "2" ? 2 : 1;

  const { app, dbPath, config } = loadLoreApp({ inv });
  const store = new SQLiteStore(dbPath);
  try {
    if (!hasExplicitAi && !app.resolveAiDefault(undefined).ai) {
      return fail("ai", "lore baseline fidelity needs an AI judge and AI is off by default on this surface; pass --ai (the judge is never silently skipped)");
    }
    const registry = buildProviderRegistry(config?.ai ?? AiConfigSchema.parse({}), { env: inv.env, tmpDir: inv.paths.tmpDir });
    if (!registry.ok) return reportFidelityFailure(inv, registry.error, json);
    const provider: AIProvider | undefined = registry.value.providers.get(registry.value.active);
    if (provider === undefined) return fail("ai", `active AI provider '${registry.value.active}' is not registered`);

    const result = await runFidelity({ store, ai: provider, size, seed, judges, exclusions: args.exclusions === true, repoRoot: inv.cwd });
    if (!result.ok) return reportFidelityFailure(inv, result.error, json);
    const record = result.value;
    const share = record.mode === "exclusions" ? `${((record.wrong_share ?? 0) * 100).toFixed(1)}% wrong` : `${(record.faithful_share * 100).toFixed(1)}% faithful`;
    const created = await app.corpusService.create({
      type: "knowledge",
      title: `Baseline fidelity (${record.mode}) seed ${String(record.seed)}: ${share}`,
      extra: { sub_type: "research" },
      content: renderFidelityContent(record),
    });
    if (!created.ok) return reportFidelityFailure(inv, created.error, json);
    if (json) {
      printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { record, doc: { id: created.value.id, slug: created.value.slug } } }, null, 2));
      return 0;
    }
    printLine(inv.io.stdout, `Stored ${created.value.slug}: ${share} of ${record.size} sampled (pool ${record.pool}, seed ${String(record.seed)}, ${record.judges} judge(s), ${record.disagreements.length} disagreement(s)).`);
    printLine(inv.io.stdout, `not_seen: ${record.not_seen}`);
    for (const v of record.verdicts) {
      if (v.verdict === "not_seen") printLine(inv.io.stdout, `  ${v.n}. NOT SEEN ${(v.unseen_paths ?? []).join(", ")} - ${v.key} - ${v.reason}`);
      else printLine(inv.io.stdout, `  ${v.n}. ${v.verdict === "faithful" ? "ok " : "BAD"} ${v.key} - ${v.reason}`);
    }
    for (const c of record.catch_all) printLine(inv.io.stdout, `  catch-all ${c.rule_id}: cited by ${c.citing_criteria.length} criteria`);
  } finally {
    store.close();
    app.close();
  }
  return 0;
}

const commonArgs = {
  json: { type: "boolean", description: "Output result as JSON" },
} as const;

export default defineLoreCommand({
  meta: { name: "baseline", description: "Build and edit the product-baseline tree (root / branch / leaf nodes)" },
  subCommands: {
    add: defineLoreCommand({
      meta: { name: "add", description: "Create a baseline node under a parent" },
      args: {
        parent: { type: "positional", description: "Parent: a PRD (for --node root) or a baseline root|branch (ID or slug)", required: true },
        tree: { type: "string", description: "business (default) | architecture. architecture nodes: root | section | module-card | standard | debt-registry" },
        node: { type: "string", description: "business: root | branch | leaf; architecture: root | section | module-card | standard | debt-registry", required: true },
        label: { type: "string", description: "Short display label for the node", required: true },
        title: { type: "string", description: "Document title", required: true },
        "content-file": { type: "string", description: "Read the node body from this file (default: empty body)" },
        ...commonArgs,
      },
      async run(context) {
        const { args } = context;
        const inv = invocationOf(context);
        return await withRuleService(inv, async (svc): Promise<number> => {
          if (args.tree !== undefined && !(BASELINE_TREES as readonly string[]).includes(args.tree as string)) {
            return reportFailure(inv, 
              { code: "VALIDATION_ERROR", field: "tree", message: `--tree must be one of ${BASELINE_TREES.join(" | ")} (got '${String(args.tree)}')`, value: args.tree },
              args.json === true,
            );
          }
          let content = "";
          if (args["content-file"] !== undefined) {
            try {
              content = readFileSync(args["content-file"] as string, "utf8");
            } catch (cause) {
              return reportFailure(inv, 
                { code: "VALIDATION_ERROR", field: "content-file", message: `cannot read ${String(args["content-file"])}: ${cause instanceof Error ? cause.message : String(cause)}` },
                args.json === true,
              );
            }
          }
          const tree = (args.tree as BaselineTree | undefined) ?? "business";
          const input: AddNodeInput = {
            ...(args.tree !== undefined ? { tree } : {}),
            node: args.node as AddNodeInput["node"],
            label: args.label as string,
            title: args.title as string,
            content,
          };
          const result = await svc.addNode(args.parent as string, input, { by: resolveActor(inv.io, undefined, inv.env, inv.cwd, inv.user) });
          if (!result.ok) return reportFailure(inv, result.error, args.json === true);
          if (args.json) printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { id: result.value.id, slug: result.value.slug, node: input.node, tree } }, null, 2));
          else printLine(inv.io.stdout, `Created baseline ${input.node} ${result.value.slug} (${result.value.id}).`);
          return 0;
        });
      },
    }),
    "set-label": defineLoreCommand({
      meta: { name: "set-label", description: "Set a baseline node's display label" },
      args: {
        node: { type: "positional", description: "Baseline node ID or slug", required: true },
        label: { type: "positional", description: "New label", required: true },
        ...commonArgs,
      },
      async run(context) {
        const { args } = context;
        const inv = invocationOf(context);
        return await withRuleService(inv, async (svc): Promise<number> => {
          const result = await svc.setLabel(args.node as string, args.label as string, { by: resolveActor(inv.io, undefined, inv.env, inv.cwd, inv.user) });
          if (!result.ok) return reportFailure(inv, result.error, args.json === true);
          if (args.json) printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { slug: result.value.slug, label: args.label } }, null, 2));
          else printLine(inv.io.stdout, `Label of ${result.value.slug} set to '${String(args.label)}'.`);
          return 0;
        });
      },
    }),
    depends: defineLoreCommand({
      meta: { name: "depends", description: "Add / remove depends_on rule ids on a baseline leaf" },
      args: {
        leaf: { type: "positional", description: "Baseline leaf ID or slug", required: true },
        add: { type: "string", description: "[repeatable] Rule id (BR-n) to depend on; must exist" },
        remove: { type: "string", description: "[repeatable] Rule id (BR-n) to stop depending on" },
        ...commonArgs,
      },
      async run(context) {
        const { args } = context;
        const inv = invocationOf(context);
        return await withRuleService(inv, async (svc): Promise<number> => {
          const result = await svc.setDependsOn(
            args.leaf as string,
            { add: repeatable(args.add), remove: repeatable(args.remove) },
            { by: resolveActor(inv.io, undefined, inv.env, inv.cwd, inv.user) },
          );
          if (!result.ok) return reportFailure(inv, result.error, args.json === true);
          const dependsOn = result.value.extra["depends_on"];
          if (args.json) printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { slug: result.value.slug, depends_on: dependsOn } }, null, 2));
          else printLine(inv.io.stdout, `${result.value.slug} depends_on: ${Array.isArray(dependsOn) && dependsOn.length > 0 ? dependsOn.join(", ") : "(none)"}`);
          return 0;
        });
      },
    }),
    glossary: defineLoreCommand({
      meta: { name: "glossary", description: "Add / remove glossary terms on a baseline root|branch" },
      subCommands: {
        add: defineLoreCommand({
          meta: { name: "add", description: "Define a term on a baseline root|branch" },
          args: {
            node: { type: "positional", description: "Baseline root|branch ID or slug", required: true },
            term: { type: "string", description: "The term", required: true },
            meaning: { type: "string", description: "What it means in this product", required: true },
            note: { type: "string", description: "Optional clarification" },
            ...commonArgs,
          },
          async run(context) {
            const { args } = context;
            const inv = invocationOf(context);
            return await withRuleService(inv, async (svc): Promise<number> => {
              const entry = {
                term: args.term as string,
                meaning: args.meaning as string,
                ...(args.note !== undefined ? { note: args.note as string } : {}),
              };
              const result = await svc.glossaryAdd(args.node as string, entry, { by: resolveActor(inv.io, undefined, inv.env, inv.cwd, inv.user) });
              if (!result.ok) return reportFailure(inv, result.error, args.json === true);
              if (args.json) printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { slug: result.value.slug, term: entry.term } }, null, 2));
              else printLine(inv.io.stdout, `Defined '${entry.term}' on ${result.value.slug}.`);
              return 0;
            });
          },
        }),
        rm: defineLoreCommand({
          meta: { name: "rm", description: "Remove a glossary term" },
          args: {
            node: { type: "positional", description: "Baseline root|branch ID or slug", required: true },
            term: { type: "string", description: "The exact term to remove", required: true },
            ...commonArgs,
          },
          async run(context) {
            const { args } = context;
            const inv = invocationOf(context);
            return await withRuleService(inv, async (svc): Promise<number> => {
              const result = await svc.glossaryRemove(args.node as string, args.term as string, { by: resolveActor(inv.io, undefined, inv.env, inv.cwd, inv.user) });
              if (!result.ok) return reportFailure(inv, result.error, args.json === true);
              if (args.json) printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { slug: result.value.slug, term: args.term } }, null, 2));
              else printLine(inv.io.stdout, `Removed '${String(args.term)}' from ${result.value.slug}.`);
              return 0;
            });
          },
        }),
      },
    }),
    map: defineLoreCommand({
      meta: { name: "map", description: "Map census sites of a baseline leaf to rules (or non-business reasons) and declare its commands" },
      args: {
        leaf: { type: "positional", description: "Baseline leaf ID or slug", required: true },
        site: { type: "string", description: "Census site key (file#symbol#code, from `lore baseline sites`) to map; needs --rule or --non-business" },
        rule: { type: "string", description: "[repeatable] Rule id (BR-n) of this leaf that the --site refusal enforces" },
        "non-business": { type: "string", description: "Reason the --site is not business behaviour (stored as non-business:<reason>)" },
        "sites-file": { type: "string", description: "JSON file of many site mappings: [{ \"site\": key, \"rules\": [BR-n...] } | { \"site\": key, \"nonBusiness\": reason }]; written as ONE version, all rows or none" },
        "remove-site": { type: "string", description: "[repeatable] Site key to unmap" },
        command: { type: "string", description: "[repeatable] CLI command name (e.g. 'ac add') this leaf answers for" },
        "remove-command": { type: "string", description: "[repeatable] Command name to drop" },
        ...commonArgs,
      },
      async run(context) {
        const { args } = context;
        const inv = invocationOf(context);
        return await withRuleService(inv, async (svc): Promise<number> => {
          const json = args.json === true;
          const by = resolveActor(inv.io, undefined, inv.env, inv.cwd, inv.user);
          const site = typeof args.site === "string" ? args.site : undefined;
          const rules = repeatable(args.rule);
          const reason = typeof args["non-business"] === "string" ? args["non-business"] : undefined;
          if (site === undefined && (rules.length > 0 || reason !== undefined)) {
            return reportFailure(inv, { code: "VALIDATION_ERROR", field: "site", message: "--rule / --non-business need --site <key>" }, json);
          }
          if (site !== undefined && (rules.length > 0) === (reason !== undefined)) {
            return reportFailure(inv, { code: "VALIDATION_ERROR", field: "site", message: "--site needs exactly one of --rule BR-n (repeatable) or --non-business <reason>" }, json);
          }
          const rowSites: Record<string, string[]> = site !== undefined ? { [site]: reason !== undefined ? [`${NON_BUSINESS_PREFIX}${reason}`] : rules } : {};
          const sitesFile = typeof args["sites-file"] === "string" ? args["sites-file"] : undefined;
          if (sitesFile !== undefined) {
            let text: string;
            try {
              text = readFileSync(sitesFile, "utf8");
            } catch (cause) {
              return reportFailure(inv, { code: "VALIDATION_ERROR", field: "sites-file", message: `cannot read sites file '${sitesFile}': ${cause instanceof Error ? cause.message : String(cause)}` }, json);
            }
            const parsedFile = parseSitesFile(text, new Set(Object.keys(rowSites)));
            if (!parsedFile.ok) return reportFailure(inv, parsedFile.error, json);
            Object.assign(rowSites, parsedFile.sites);
          }
          const hasSites = Object.keys(rowSites).length > 0;
          const change: SiteMapChange = {
            ...(hasSites ? { sites: rowSites } : {}),
            removeSites: repeatable(args["remove-site"]),
            addCommands: repeatable(args.command),
            removeCommands: repeatable(args["remove-command"]),
          };
          const noChange = !hasSites && (change.removeSites?.length ?? 0) + (change.addCommands?.length ?? 0) + (change.removeCommands?.length ?? 0) === 0;
          if (noChange) {
            // Authorization-only: reports the claim-scope verdict (AC-BLS2-8) and records nothing.
            const authorized = await svc.authorizeNodeWrite(args.leaf as string, "baseline-map", by);
            if (!authorized.ok) return reportFailure(inv, authorized.error, json);
            const slug = authorized.value.slug;
            if (json) printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { slug, authorized: true, recorded: false } }, null, 2));
            else printLine(inv.io.stdout, `${slug}: site-map write authorized; nothing to record (pass --site/--sites-file/--command to change the map).`);
            return 0;
          }
          const result = await svc.setSiteMap(args.leaf as string, change, { by });
          if (!result.ok) return reportFailure(inv, result.error, json);
          const siteMap = (result.value.extra["site_map"] ?? {}) as Record<string, string[]>;
          const commands = (result.value.extra["commands"] ?? []) as string[];
          if (json) printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { slug: result.value.slug, site_map: siteMap, commands } }, null, 2));
          else printLine(inv.io.stdout, `${result.value.slug}: ${Object.keys(siteMap).length} site(s) mapped; commands: ${commands.length > 0 ? commands.join(", ") : "(none)"}`);
          return 0;
        });
      },
    }),
    sites: defineLoreCommand({
      meta: { name: "sites", description: "List the failure sites a CLI command can reach (static census, TypeScript compiler API)" },
      args: {
        command: { type: "positional", description: "CLI command path, e.g. 'ac add' (or 'ac-add'); token 1 = commands/<token>.ts, every further positional = a nested subcommand ('gate spec-create')", required: true },
        json: { type: "boolean", description: "Output result as JSON" },
      },
      async run(context): Promise<number> {
        const { args } = context;
        const inv = invocationOf(context);
        const json = args.json === true;
        try {
          const rootDir = requireCensusRoot(inv);
          // reason: citty binds exactly ONE token to the declared positional; every positional survives on `args._`, and
          // dropping the rest silently censused the wrong command (BR-664: an unresolvable path is a refusal, never a guess).
          const command = ((args._ as string[] | undefined) ?? [args.command as string]).join(" ");
          let sites: SiteList;
          try {
            sites = listSitesMany({ rootDir, commands: [command] }).get(command) as SiteList;
          } catch (cause) {
            if (cause instanceof SiteCensusError && cause.reason === "entry-symbol-missing") {
              return reportFailure(inv, { code: "VALIDATION_ERROR", field: "command", message: `no CLI command '${command}': ${cause.message}`, value: command } as LoreError, json);
            }
            throw cause;
          }
          const entry = resolveCommandEntry({ rootDir, command });
          const dynamicCount = sites.filter((s) => s.dynamic).length;
          if (json) {
            printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { command, entry, count: sites.length, not_measured: dynamicCount, unresolved_imports: sites.unresolvedImports, sites, bootstrap: sites.bootstrap } }, null, 2));
            if (sites.unresolvedImports.length > 0) return 1;
            return 0;
          }
          if (sites.unresolvedImports.length > 0) {
            for (const u of sites.unresolvedImports) printLine(inv.io.stdout, `unresolved import ${u.specifier} (from ${u.from}): census INCOMPLETE, sites behind it are not listed`);
          }
          printLine(inv.io.stdout, `${command}: ${sites.length} site(s), ${dynamicCount} not_measured, ${sites.bootstrap.length} bootstrap`);
          for (const site of sites) printLine(inv.io.stdout, `${site.dynamic ? "~" : " "} ${site.key}`);
          for (const site of sites.bootstrap) printLine(inv.io.stdout, `  bootstrap ${site.key}`);
          return sites.unresolvedImports.length > 0 ? 1 : 0;
        } catch (cause) {
          return reportCensusFailure(inv, cause, json);
        }
      },
    }),
    coverage: defineLoreCommand({
      meta: { name: "coverage", description: "Report how each baseline leaf maps its census sites; exit 1 only when a runnable command no leaf declares (root), exit 2 on a stored site_map value that is not a BR-n id" },
      args: {
        target: { type: "positional", description: "Baseline leaf or branch|root ID or slug", required: true },
        json: { type: "boolean", description: "Output result as JSON" },
        "commands-only": { type: "boolean", description: "Check only for undeclared commands; never run the site census (the integrate floor's mode)" },
      },
      async run(context) {
        const { args } = context;
        const inv = invocationOf(context);
        return await runCoverage(args.target as string, args.json === true, args["commands-only"] === true, inv);
      },
    }),
    fidelity: defineLoreCommand({
      meta: { name: "fidelity", description: "Judge a seeded sample of citations (or non-business exclusions) with the AI provider and store the record (read-only on the baseline)" },
      args: {
        size: { type: "string", description: "Sample size N (refused when larger than the pool)", required: true },
        seed: { type: "string", description: "Sampling seed; the same seed redraws the same sample", required: true },
        judges: { type: "string", description: "1 (default) or 2 (second judge + adjudicator for disagreements)" },
        exclusions: { type: "boolean", description: "Sample the non-business site-map exclusions instead of the citations" },
        ai: { type: "boolean", description: "Confirm AI use (required on surfaces where AI is off by default)" },
        json: { type: "boolean", description: "Output result as JSON" },
      },
      async run(context) {
        const { args } = context;
        const inv = invocationOf(context);
        return await runFidelityCommand(args, inv);
      },
    }),
    adopt: adoptCommand,
    tree: defineLoreCommand({
      meta: { name: "tree", description: "List the baseline tree (kind, label, status, rule counts)" },
      args: {
        root: { type: "positional", description: "Optional baseline node ID or slug to list only its subtree", required: false },
        states: { type: "boolean", description: "Add each rule's verification state, inputs and computed_from (consults git)" },
        rule: { type: "string", description: "Show one rule (BR-n): citing ACs, state and inputs; implies --states" },
        json: { type: "boolean", description: "Output result as JSON" },
      },
      async run(context) {
        const { args } = context;
        const inv = invocationOf(context);
        if (args.states === true || args.rule !== undefined) {
          return await runStatesTree(args, inv);
        }
        return await withRuleService(inv, async (svc): Promise<number> => {
          const result = await svc.listBaselineTree(args.root as string | undefined);
          if (!result.ok) return reportFailure(inv, result.error, args.json === true);
          if (args.json) {
            printLine(inv.io.stdout, JSON.stringify({ ok: true, data: result.value }, null, 2));
            return 0;
          }
          if (result.value.length === 0) {
            printLine(inv.io.stdout, "No baseline nodes.");
            return 0;
          }
          for (const entry of result.value) {
            const counts = `live ${entry.rules.live} / deprecated ${entry.rules.deprecated} / retired ${entry.rules.retired}`;
            // reason: BR-674 / #125 — counts follow the node kinds that hold rules (business leaf, architecture
            // standard, debt-registry), decided by core's ruleIdPrefixOfNode, never by `node === "leaf"`.
            const holdsRules = ruleIdPrefixOfNode({ tree: entry.tree, node: entry.node }) !== undefined;
            const rules = holdsRules ? `  [rules: ${counts}]` : "";
            const kind = entry.tree === "architecture" ? `architecture ${entry.node}` : entry.node;
            printLine(inv.io.stdout, `${"  ".repeat(entry.depth)}${kind} ${entry.label ?? entry.title} (${entry.slug}, ${entry.status})${rules}`);
          }
          return 0;
        });
      },
    }),
  },
});
