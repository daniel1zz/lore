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
 *   map <leaf> [--command <name>]... [--remove-command <name>]...
 *                   The ONLY writer of `extra.commands` (leaf only). With no change
 *                   flag it authorizes through the corpus-write guard (claim scope, AC-BLS2-8), reports
 *                   the verdict and records nothing. A site's rule is declared in code, never mapped here (BR-1344).
 *   sites <command> Static census (TypeScript compiler API) of the failure sites the CLI command can
 *                   reach: prints the count and every key with the rule the tree declares there
 *                   (`unmapped`, a conflict naming both rules, or a retired/unknown id); `~` marks a not_measured
 *                   (dynamic) site. Name rule: token 1 = commands/<token>.ts, further tokens = nested subCommands;
 *                   `ac-add` = file `ac` + subcommand `add` (see site-census.ts::resolveCommandEntry).
 *   coverage <leaf|branch|root> [--json] [--commands-only]
 *                   Per leaf: the census of its declared `commands`, judged by the rules the code declares at each
 *                   reached site (file:line). Report-only for sites; exit 1 only for a runnable command no leaf declares.
 *                   The leaf's commands are an explicit stored field (`--command`), not derived: a leaf's
 *                   Command section is prose without CLI names.
 *   fidelity --size N --seed S [--judges 1|2] [--ai] [--json]
 *                   Seeded sample of live (criterion, rule) citations judged by the AI provider; the record is stored as
 *                   a `research` knowledge doc and printed. Read-only on rules/citations.
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
import { findLoreDbPathQuiet } from "../corpus-resolution.js";
import { exitCode, formatErrorFor, resolveActor } from "../utils.js";
import type { App } from "../../../app.js";
import type { AddNodeInput, BaselineTreeEntry, CommandsChange } from "../../../service/rule-service.js";
import { commandFixCommand, sitesDeclaringRulesOf, computeLeafCoverage, computeUndeclaredCommands, partitionDeclaredCommands, siteFixHint, absentCommandFixCommand } from "../../../service/leaf-coverage.js";
import type { ConflictedSite, GenericSite, InvalidDeclaration, MappedSite } from "../../../service/leaf-coverage.js";
import { classifySiteDeclaration, ruleStatusIndexOf } from "../../../service/site-declarations.js";
import type { RuleStatusOf } from "../../../service/site-declarations.js";
import { treePredicateFor } from "../absent-declarations.js";
import { approvedCommandsOf, approvedDependsOnOf, approvedRulesOf } from "../../../service/baseline-items.js";
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
      const rules = leafDoc.ok && leafDoc.value !== null ? approvedRulesOf(leafDoc.value) : [];
      const statement = (rules as Array<{ id?: unknown; statement?: unknown }>).find((r) => r.id === rule)?.statement;
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

/**
 * Rule liveness from the corpus reachable from `inv.cwd`, or `undefined` when there is none (the census analyses source and
 * needs no corpus; without one every declared id is reported as unchecked, never as verified).
 */
async function readRuleStatusIndex(inv: Invocation): Promise<RuleStatusOf | undefined> {
  const dbPath = findLoreDbPathQuiet(inv.io, { cwd: inv.cwd, env: inv.env });
  if (dbPath === undefined) return undefined;
  const store = new SQLiteStore(dbPath);
  try {
    const nodes = await store.findMany({ type: "baseline" });
    return nodes.ok ? ruleStatusIndexOf(nodes.value) : undefined;
  } finally {
    store.close();
  }
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
  /** What measured the leaf: its declared commands' census, the sites it owns (no live command), `absent` (it declares commands, all absent from this tree, and owns no site: pending), or nothing (no command, no owned site: unmeasured). */
  measured_by: "commands" | "owned_sites" | "absent" | "none";
  sites: number;
  /** The reached sites whose code declares one of this leaf's live rules, at file:line (BR-1344). */
  mapped_sites: MappedSite[];
  gaps: string[];
  not_measured: string[];
  /** Reached sites whose code declares two or more rules. */
  conflicts: ConflictedSite[];
  /** Reached sites whose code declares a retired, deprecated or unknown rule id. */
  invalid_declarations: InvalidDeclaration[];
  /** Shared sites reached through predicates of different rules: listed with those rules, attributed to none. */
  generic: GenericSite[];
  /** Imports the census could not resolve; non-empty means the site list is a lower bound and the leaf is NOT complete. */
  unresolved_imports: string[];
  bootstrap: string[];
  /** One hint per entry of `gaps` then `not_measured`, in that order: where to write the declaration for that site. */
  fix_hints: string[];
  ok: boolean;
}

/**
 * `coverage <leaf|branch>`: census each leaf's declared `commands`, judge the rules the tree declares at each reached site.
 * A leaf declaring no command is measured by the sites that declare its rules (see sitesDeclaringRulesOf); one that owns none is
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
      return reportFailure(inv, { code: "VALIDATION_ERROR", field: "target", message: `'${target}' is a ${resolved.value.type}, not a baseline node`, rule: "BR-662" }, json);
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
    const leafCommands = (leaf: DocRecord): string[] => approvedCommandsOf(leaf);
    // reason: a declared command absent from the analysed tree is REPORTED, never a coverage defect: a branch that adds a command
    // must declare it in the shared corpus before it lands, so every other branch's tree lacks it until then and refusing it would
    // block every other integrate. It also must not surface as a census error (exit 4) from resolveCommandEntry; only an
    // unanalysable tree still throws.
    // reason: every leaf of the corpus is partitioned, not only the target's: a command-less leaf is measured by the sites its rules
    // are declared at, which any leaf's command may reach (BR-1344), so its census must span them all.
    const allLeafDocs = all.value.filter((d) => d.extra["node"] === "leaf");
    const { runnable, entryKeys, runnableEntries } = await treePredicateFor(rootDir, allLeafDocs.flatMap(leafCommands));
    const partitionByLeaf = new Map(allLeafDocs.map((leaf) => [leaf.slug, partitionDeclaredCommands(leafCommands(leaf), entryKeys, runnableEntries)]));
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
    // reason: the census is the tree's, the declarations are the tree's, and the corpus contributes only rule liveness and commands
    // (BR-1344): a branch that adds, moves or renames a refusal site needs no corpus write, and no corpus row can change what a site declares.
    const statusOf = ruleStatusIndexOf(all.value);
    const needsWholeTree = leaves.some((leaf) => livePartition(leaf).live.length === 0);
    const censusLeaves = needsWholeTree ? allLeafDocs : leaves;
    const censusByCommand = listSitesMany({ rootDir, commands: censusLeaves.flatMap((leaf) => livePartition(leaf).live) });
    // reason: a command-less (cross-cutting) leaf owns the reached sites that declare its rules (BL-D1); the union of every
    // censused command's non-bootstrap sites is where to look, de-duplicated by key.
    const wholeTreeSites = new Map<string, Site>();
    if (needsWholeTree) {
      for (const census of censusByCommand.values()) {
        const bootstrapKeys = new Set(census.bootstrap.map((s) => s.key));
        for (const site of census) if (!bootstrapKeys.has(site.key)) wholeTreeSites.set(site.key, site);
      }
    }
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
      const rules = approvedRulesOf(leaf) as Array<{ id: string; lifecycle: string }>;
      // reason: BL-D1 - a cross-cutting leaf declares no command (its rules guard sites other leaves' commands reach), so it
      // is measured by the sites that declare its rules instead of a proxy command; owning none is UNMEASURED, never silently ok.
      // reason: a leaf whose declared commands are ALL absent from this tree is measured as if command-less.
      const ownedSites = live.length > 0 ? [] : sitesDeclaringRulesOf([...wholeTreeSites.values()], new Set(rules.map((r) => r.id)));
      for (const site of ownedSites) byKey.set(site.key, site);
      const verdict = computeLeafCoverage({
        sites: [...byKey.values()],
        bootstrap: [...bootstrapByKey.values()],
        unresolvedImports: [...unresolvedByKey.values()],
        liveRuleIds: rules.filter((r) => r.lifecycle === "live").map((r) => r.id),
        statusOf,
      });
      return {
        slug: leaf.slug,
        commands,
        measured_by: live.length > 0 ? "commands" : ownedSites.length > 0 ? "owned_sites" : absent.length > 0 ? "absent" : "none",
        absent_commands: absent.map((command) => ({ command, fix: absentCommandFixCommand(leaf.slug, command) })),
        sites: byKey.size,
        mapped_sites: verdict.mapped,
        gaps: verdict.gaps,
        not_measured: verdict.notMeasured,
        conflicts: verdict.conflicts,
        invalid_declarations: verdict.invalid,
        generic: verdict.generic,
        unresolved_imports: verdict.unresolvedImports ?? [],
        bootstrap: [...bootstrapByKey.keys()].sort(),
        fix_hints: [...verdict.gaps, ...verdict.notMeasured].map((key) => siteFixHint(byKey.get(key) as Site)),
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
        const state = r.measured_by === "absent" ? "PENDING (declared commands not in this tree)" : r.measured_by === "none" ? "UNMEASURED (no commands declared and no code site declares one of its rules; use `lore baseline map --command` or declare its rule at the sites it enforces)" : r.ok ? "fully mapped" : "UNMAPPED sites (report only)";
        printLine(inv.io.stdout, `${r.slug}: ${state} - ${r.sites} site(s), ${r.mapped_sites.length} mapped, ${r.gaps.length} gap(s), ${r.not_measured.length} not_measured, ${r.conflicts.length} conflict(s), ${r.generic.length} generic, ${r.invalid_declarations.length} invalid declaration(s), ${r.unresolved_imports.length} unresolved import(s), ${r.bootstrap.length} bootstrap (not counted as gaps)`);
        if (r.measured_by === "absent") printLine(inv.io.stdout, `  all declared commands absent from this tree (pending or stale): ${r.absent_commands.map((a) => a.command).join(", ")}`);
        for (const a of r.absent_commands) printLine(inv.io.stdout, `  declared command not in this tree: ${a.command} (pending in a branch that has not landed, or stale; not counted against coverage)\n    if stale: ${a.fix}`);
        for (const m of r.mapped_sites) printLine(inv.io.stdout, `  mapped       ${m.file}:${m.line} ${m.rule}`);
        for (const key of r.unresolved_imports) printLine(inv.io.stdout, `  unresolved  ${key} (census incomplete: sites behind this import are not listed)`);
        for (const c of r.conflicts) printLine(inv.io.stdout, `  conflict     ${c.file}:${c.line} declares ${c.rules.join(" and ")} (a site carries at most one rule)`);
        for (const g of r.generic) printLine(inv.io.stdout, `  generic      ${g.file}:${g.line} is shared by predicates of ${g.rules.join(", ")}: ${g.predicates.map((p) => `${p.rule} at ${p.file}:${p.line}`).join("; ")}`);
        for (const d of r.invalid_declarations) printLine(inv.io.stdout, `  ${d.status}      ${d.file}:${d.line} declares ${d.rule}, which is ${d.status === "unknown" ? "not a rule of the baseline" : d.status}`);
        for (const [i, key] of [...r.gaps, ...r.not_measured].entries()) printLine(inv.io.stdout, `  ${i < r.gaps.length ? "gap         " : "not_measured"} ${key}\n    fix: ${r.fix_hints[i]}`);
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
  const headline = `${(record.faithful_share * 100).toFixed(1)}% of ${record.size} sampled citations judged faithful`;
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
  const fail = (field: string, message: string): ExitReport => reportFidelityFailure(inv, { code: "VALIDATION_ERROR", field, message, rule: "BR-963" }, json);
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

    const result = await runFidelity({ store, ai: provider, size, seed, judges, repoRoot: inv.cwd });
    if (!result.ok) return reportFidelityFailure(inv, result.error, json);
    const record = result.value;
    const share = `${(record.faithful_share * 100).toFixed(1)}% faithful`;
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
              { code: "VALIDATION_ERROR", field: "tree", message: `--tree must be one of ${BASELINE_TREES.join(" | ")} (got '${String(args.tree)}')`, value: args.tree, rule: "BR-979" },
              args.json === true,
            );
          }
          let content = "";
          if (args["content-file"] !== undefined) {
            try {
              content = readFileSync(args["content-file"] as string, "utf8");
            } catch (cause) {
              return reportFailure(inv, 
                { code: "VALIDATION_ERROR", field: "content-file", message: `cannot read ${String(args["content-file"])}: ${cause instanceof Error ? cause.message : String(cause)}`, rule: "BR-614" },
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
          const result = await svc.addNode(args.parent as string, input, { by: resolveActor(inv) });
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
          const result = await svc.setLabel(args.node as string, args.label as string, { by: resolveActor(inv) });
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
            { by: resolveActor(inv) },
          );
          if (!result.ok) return reportFailure(inv, result.error, args.json === true);
          const dependsOn = approvedDependsOnOf(result.value);
          if (args.json) printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { slug: result.value.slug, depends_on: dependsOn } }, null, 2));
          else printLine(inv.io.stdout, `${result.value.slug} depends_on: ${dependsOn.length > 0 ? dependsOn.join(", ") : "(none)"}`);
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
              const result = await svc.glossaryAdd(args.node as string, entry, { by: resolveActor(inv) });
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
              const result = await svc.glossaryRemove(args.node as string, args.term as string, { by: resolveActor(inv) });
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
      meta: { name: "map", description: "Declare the CLI commands a baseline leaf answers for (a site's rule is declared in code, not here)" },
      args: {
        leaf: { type: "positional", description: "Baseline leaf ID or slug", required: true },
        command: { type: "string", description: "[repeatable] CLI command name (e.g. 'ac add') this leaf answers for" },
        "remove-command": { type: "string", description: "[repeatable] Command name to drop" },
        ...commonArgs,
      },
      async run(context) {
        const { args } = context;
        const inv = invocationOf(context);
        return await withRuleService(inv, async (svc): Promise<number> => {
          const json = args.json === true;
          const by = resolveActor(inv);
          const change: CommandsChange = {
            addCommands: repeatable(args.command),
            removeCommands: repeatable(args["remove-command"]),
          };
          const noChange = (change.addCommands?.length ?? 0) + (change.removeCommands?.length ?? 0) === 0;
          if (noChange) {
            // Authorization-only: reports the claim-scope verdict (AC-BLS2-8) and records nothing.
            const authorized = await svc.authorizeNodeWrite(args.leaf as string, "baseline-map", by);
            if (!authorized.ok) return reportFailure(inv, authorized.error, json);
            const slug = authorized.value.slug;
            if (json) printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { slug, authorized: true, recorded: false } }, null, 2));
            else printLine(inv.io.stdout, `${slug}: command write authorized; nothing to record (pass --command/--remove-command to change the declared commands).`);
            return 0;
          }
          const result = await svc.setCommands(args.leaf as string, change, { by });
          if (!result.ok) return reportFailure(inv, result.error, json);
          const commands = approvedCommandsOf(result.value);
          if (json) printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { slug: result.value.slug, commands } }, null, 2));
          else printLine(inv.io.stdout, `${result.value.slug}: commands: ${commands.length > 0 ? commands.join(", ") : "(none)"}`);
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
              return reportFailure(inv, { code: "VALIDATION_ERROR", field: "command", message: `no CLI command '${command}': ${cause.message}`, value: command, rule: "BR-664" } as LoreError, json);
            }
            throw cause;
          }
          const entry = resolveCommandEntry({ rootDir, command });
          const dynamicCount = sites.filter((s) => s.dynamic).length;
          const statusOf = await readRuleStatusIndex(inv);
          // reason: each site is reported as what the tree declares there (BR-1344); `liveness` says whether the corpus was consulted to
          // tell a live rule from a retired or unknown id, so an unchecked id is never read as a verified one.
          const described = (site: Site) => {
            const declaration = classifySiteDeclaration(site.rules, statusOf, site.predicates);
            const rule = "rule" in declaration ? declaration.rule : null;
            return { ...site, status: declaration.state, rule, rules: site.rules, ...("via" in declaration && declaration.via !== undefined ? { via: declaration.via } : {}) };
          };
          if (json) {
            printLine(
              inv.io.stdout,
              JSON.stringify(
                {
                  ok: true,
                  data: {
                    command,
                    entry,
                    count: sites.length,
                    not_measured: dynamicCount,
                    unresolved_imports: sites.unresolvedImports,
                    liveness: statusOf === undefined ? "unchecked" : "checked",
                    sites: sites.map(described),
                    bootstrap: sites.bootstrap.map(described),
                  },
                },
                null,
                2,
              ),
            );
            if (sites.unresolvedImports.length > 0) return 1;
            return 0;
          }
          if (sites.unresolvedImports.length > 0) {
            for (const u of sites.unresolvedImports) printLine(inv.io.stdout, `unresolved import ${u.specifier} (from ${u.from}): census INCOMPLETE, sites behind it are not listed`);
          }
          printLine(inv.io.stdout, `${command}: ${sites.length} site(s), ${dynamicCount} not_measured, ${sites.bootstrap.length} bootstrap`);
          const declared = (site: Site): string => {
            const d = classifySiteDeclaration(site.rules, statusOf, site.predicates);
            if (d.state === "declared") return d.via === undefined ? d.rule : `${d.rule} (via ${d.via.file}:${d.via.line})`;
            if (d.state === "unmapped") return "unmapped";
            if (d.state === "generic") return `generic: predicates of ${d.rules.join(", ")}`;
            if (d.state === "conflict") return `conflict ${d.rules.join(" vs ")}`;
            return `${d.state} ${d.rule}`;
          };
          for (const site of sites) printLine(inv.io.stdout, `${site.dynamic ? "~" : " "} ${site.key}  ${site.file}:${site.line}  ${declared(site)}`);
          for (const site of sites.bootstrap) printLine(inv.io.stdout, `  bootstrap ${site.key}`);
          return sites.unresolvedImports.length > 0 ? 1 : 0;
        } catch (cause) {
          return reportCensusFailure(inv, cause, json);
        }
      },
    }),
    coverage: defineLoreCommand({
      meta: { name: "coverage", description: "Report, per baseline leaf, the census sites whose code declares one of its rules (file:line) and the sites that declare none; exit 1 only when a runnable command no leaf declares (root)" },
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
      meta: { name: "fidelity", description: "Judge a seeded sample of citations with the AI provider and store the record (read-only on the baseline)" },
      args: {
        size: { type: "string", description: "Sample size N (refused when larger than the pool)", required: true },
        seed: { type: "string", description: "Sampling seed; the same seed redraws the same sample", required: true },
        judges: { type: "string", description: "1 (default) or 2 (second judge + adjudicator for disagreements)" },
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
