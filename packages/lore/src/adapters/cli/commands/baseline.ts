/**
 * lore baseline — the dedicated writer of the product-baseline tree's nodes.
 *
 * Subcommands (thin pipes over `RuleService`):
 *   add <parent> --node root|branch|leaf --label <l> --title <t> [--content-file <path>]
 *       Create a baseline node (root under a PRD; branch/leaf under a root|branch).
 *   set-label <node> <label>
 *   depends <leaf> [--add BR-n]... [--remove BR-n]...
 *   glossary add <node> --term <t> --meaning <m> [--note <n>]   (root|branch only)
 *   glossary rm  <node> --term <t>
 *   map <leaf> [--site <key> (--rule BR-n... | --non-business <reason>)] [--remove-site <key>]...
 *               [--command <name>]... [--remove-command <name>]...
 *                   The ONLY writer of `extra.site_map` / `extra.commands` (leaf only). With no change
 *                   flag it authorizes through the corpus-write guard (claim scope, AC-BLS2-8), reports
 *                   the verdict and records nothing.
 *   sites <command> Static census (TypeScript compiler API) of the failure sites the CLI command can
 *                   reach: prints the count and every key; `~` marks a not_measured (dynamic) site.
 *                   Name rule: token 1 = commands/<token>.ts, further tokens = nested subCommands;
 *                   `ac-add` = file `ac` + subcommand `add` (see site-census.ts::resolveCommandEntry).
 *   coverage <leaf|branch> [--json]
 *                   Per leaf: census of its declared `commands` vs its `site_map`. Exit 0 only when
 *                   every leaf has commands, 0 gaps and 0 unaccounted not_measured sites. The leaf's
 *                   commands are an explicit stored field (`--command`), not derived: a leaf's
 *                   Command section is prose without CLI names.
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
import { defineCommand } from "citty";
import type { DocRecord, LoreError } from "@lore/core";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, resolveActor } from "../utils.js";
import type { App } from "../../../app.js";
import type { AddNodeInput, BaselineTreeEntry, SiteMapChange } from "../../../service/rule-service.js";
import { NON_BUSINESS_PREFIX, computeLeafCoverage } from "../../../service/leaf-coverage.js";
import { resolveDoc } from "../../../service/resolve.js";
import { SiteCensusError, type UnresolvedImport, findCensusRoot, listSites, resolveCommandEntry } from "../../../service/site-census.js";
import type { Site } from "../../../service/site-census.js";
import { RuleStateService } from "../../../service/rule-state-service.js";
import type { RuleStateEntry, RuleStateFull } from "../../../service/rule-state-service.js";
import { SpawnGitPort, resolveGitRoot } from "../../../service/rule-state-git-port.js";
import { SQLiteStore } from "../../../store/sqlite-store.js";

function repeatable(value: unknown): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function reportFailure(error: LoreError, json: boolean): void {
  if (json) console.log(JSON.stringify({ ok: false, error }, null, 2));
  else process.stderr.write(formatError(error));
  process.exitCode = exitCode(error);
}

function requireRuleService(app: App) {
  if (app.ruleService === undefined) {
    process.stderr.write("Error: RuleService is not available in this build.\n");
    process.exitCode = 1;
    return undefined;
  }
  return app.ruleService;
}

/** Shared by every verb: open the app, run `body` with the service, always close. */
async function withRuleService(body: (svc: NonNullable<App["ruleService"]>) => Promise<void>): Promise<void> {
  const { app } = loadLoreApp();
  try {
    const svc = requireRuleService(app);
    if (svc === undefined) return;
    await body(svc);
  } finally {
    app.close();
  }
}

function renderRuleState(rule: RuleStateEntry, indent: string, statement?: string): void {
  const reason = rule.unknown_reason !== undefined ? ` (${rule.unknown_reason})` : "";
  const lifecycle = rule.lifecycle === "live" ? "" : ` [${rule.lifecycle}]`;
  console.log(`${indent}${rule.rule_id} ${rule.state}${reason}${lifecycle}${statement !== undefined ? ` - ${statement}` : ""}`);
  if (rule.inputs.length === 0) console.log(`${indent}  (no citing script-mode AC)`);
  for (const input of rule.inputs) {
    const run =
      input.evidence_result === null
        ? "no attested run"
        : `${input.evidence_result} @ ${input.evidence_recorded_at ?? "?"} sha ${input.head_sha?.slice(0, 12) ?? "none"}`;
    console.log(`${indent}  ${input.spec}#${input.ac_id}: ${run}; anchors: ${input.anchor_paths.length === 0 ? "none" : input.anchor_paths.join(", ")}`);
  }
}

function renderComputedFrom(full: RuleStateFull): void {
  console.log(
    `computed_from: head ${full.computed_from.head_sha ?? "unavailable (git)"}, corpus version ${full.computed_from.corpus_version}; ambiguous_ac_ref ${full.ambiguous_ac_ref}`,
  );
}

/** `tree --states` / `tree --rule`: the only baseline verbs that consult git, via a read-only second store handle. */
async function runStatesTree(args: Record<string, unknown>): Promise<void> {
  const json = args.json === true;
  const { app, dbPath } = loadLoreApp();
  const store = new SQLiteStore(dbPath);
  try {
    const svc = requireRuleService(app);
    if (svc === undefined) return;
    const stateService = new RuleStateService(store, new SpawnGitPort(resolveGitRoot(process.cwd())));
    const rule = typeof args.rule === "string" ? args.rule : undefined;
    const full = await stateService.full(rule !== undefined ? { rule } : undefined);
    if (!full.ok) return reportFailure(full.error, json);
    const tree = await svc.listBaselineTree(rule !== undefined ? undefined : (args.root as string | undefined));
    if (!tree.ok) return reportFailure(tree.error, json);

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
        console.log(JSON.stringify({ ok: true, data: { rule: entry, statement: statement ?? null, computed_from: full.value.computed_from, ambiguous_ac_ref: full.value.ambiguous_ac_ref } }, null, 2));
        return;
      }
      console.log(`Leaf: ${entry.leaf}`);
      renderRuleState(entry, "", typeof statement === "string" ? statement : undefined);
      renderComputedFrom(full.value);
      return;
    }

    if (json) {
      const nodes = tree.value.map((n: BaselineTreeEntry) => ({ ...n, rule_states: n.node === "leaf" ? (byLeaf.get(n.slug) ?? []) : [] }));
      console.log(JSON.stringify({ ok: true, data: { tree: nodes, computed_from: full.value.computed_from, ambiguous_ac_ref: full.value.ambiguous_ac_ref } }, null, 2));
      return;
    }
    if (tree.value.length === 0) {
      console.log("No baseline nodes.");
      return;
    }
    for (const entry of tree.value) {
      const indent = "  ".repeat(entry.depth);
      console.log(`${indent}${entry.node} ${entry.label ?? entry.title} (${entry.slug}, ${entry.status})`);
      if (entry.node === "leaf") for (const r of byLeaf.get(entry.slug) ?? []) renderRuleState(r, `${indent}  `);
    }
    renderComputedFrom(full.value);
  } finally {
    store.close();
    app.close();
  }
}

function requireCensusRoot(): string {
  const root = findCensusRoot(process.cwd());
  if (root === undefined) {
    throw new SiteCensusError("command-unresolved", {
      reason: "not inside a lore source checkout (packages/lore/src/adapters/cli/commands not found upward from cwd); the census analyses source, an installed binary has none",
      cwd: process.cwd(),
    });
  }
  return root;
}

function reportCensusFailure(cause: unknown, json: boolean): void {
  if (!(cause instanceof SiteCensusError)) throw cause;
  reportFailure({ code: "VALIDATION_ERROR", field: `census:${cause.reason}`, message: cause.message }, json);
}

interface LeafCoverageReport {
  slug: string;
  commands: string[];
  sites: number;
  gaps: string[];
  not_measured: string[];
  /** Imports the census could not resolve; non-empty means the site list is a lower bound and the leaf is NOT complete. */
  unresolved_imports: string[];
  bootstrap: string[];
  ok: boolean;
}

/**
 * `coverage <leaf|branch>`: census each leaf's declared `commands`, compare with its `site_map`.
 * A leaf declaring no command is NOT ok — completeness of an unmeasured leaf is unproven.
 */
async function runCoverage(target: string, json: boolean): Promise<void> {
  const { app, dbPath } = loadLoreApp();
  const store = new SQLiteStore(dbPath);
  try {
    const rootDir = requireCensusRoot();
    const resolved = await resolveDoc(store, target);
    if (!resolved.ok) return reportFailure(resolved.error, json);
    if (resolved.value.type !== "baseline") {
      return reportFailure({ code: "VALIDATION_ERROR", field: "target", message: `'${target}' is a ${resolved.value.type}, not a baseline node` }, json);
    }
    const all = await store.findMany({ type: "baseline" });
    if (!all.ok) return reportFailure(all.error, json);
    const leaves: DocRecord[] = [];
    const queue: DocRecord[] = [resolved.value];
    while (queue.length > 0) {
      const doc = queue.shift() as DocRecord;
      if (doc.extra["node"] === "leaf") leaves.push(doc);
      else queue.push(...all.value.filter((d) => d.parent_id === doc.id));
    }
    leaves.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    const reports: LeafCoverageReport[] = leaves.map((leaf) => {
      const commands = Array.isArray(leaf.extra["commands"]) ? (leaf.extra["commands"] as string[]) : [];
      const byKey = new Map<string, Site>();
      const bootstrapByKey = new Map<string, Site>();
      const unresolvedByKey = new Map<string, UnresolvedImport>();
      for (const command of commands) {
        const census = listSites({ rootDir, entry: resolveCommandEntry({ rootDir, command }) });
        for (const u of census.unresolvedImports) unresolvedByKey.set(`${u.specifier}\0${u.from}`, u);
        for (const site of census) byKey.set(site.key, site);
        for (const site of census.bootstrap) bootstrapByKey.set(site.key, site);
      }
      const siteMap = (leaf.extra["site_map"] ?? {}) as Record<string, string[]>;
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
        sites: byKey.size,
        gaps: verdict.gaps,
        not_measured: verdict.notMeasured,
        unresolved_imports: verdict.unresolvedImports,
        bootstrap: [...bootstrapByKey.keys()].sort(),
        ok: commands.length > 0 && verdict.ok,
      };
    });
    const ok = reports.length > 0 && reports.every((r) => r.ok);
    if (json) {
      console.log(JSON.stringify({ ok: true, data: { target: resolved.value.slug, complete: ok, leaves: reports } }, null, 2));
    } else {
      if (reports.length === 0) console.log(`${resolved.value.slug}: no leaves under this node.`);
      for (const r of reports) {
        const state = r.commands.length === 0 ? "UNMEASURED (no commands declared; use `lore baseline map --command`)" : r.ok ? "complete" : "INCOMPLETE";
        console.log(`${r.slug}: ${state} - ${r.sites} site(s), ${r.gaps.length} gap(s), ${r.not_measured.length} not_measured, ${r.unresolved_imports.length} unresolved import(s), ${r.bootstrap.length} bootstrap (not counted as gaps)`);
        for (const key of r.unresolved_imports) console.log(`  unresolved  ${key} (census incomplete: sites behind this import are not listed)`);
        for (const key of r.gaps) console.log(`  gap          ${key}`);
        for (const key of r.not_measured) console.log(`  not_measured ${key}`);
        for (const key of r.bootstrap) console.log(`  bootstrap    ${key}`);
      }
    }
    if (!ok) process.exitCode = 1;
  } catch (cause) {
    reportCensusFailure(cause, json);
  } finally {
    store.close();
    app.close();
  }
}

const commonArgs = {
  by: { type: "string", description: "Actor identity (default: resolved from $LORE_ACTOR)" },
  json: { type: "boolean", description: "Output result as JSON" },
} as const;

export default defineCommand({
  meta: { name: "baseline", description: "Build and edit the product-baseline tree (root / branch / leaf nodes)" },
  subCommands: {
    add: defineCommand({
      meta: { name: "add", description: "Create a baseline node under a parent" },
      args: {
        parent: { type: "positional", description: "Parent: a PRD (for --node root) or a baseline root|branch (ID or slug)", required: true },
        node: { type: "string", description: "root | branch | leaf", required: true },
        label: { type: "string", description: "Short display label for the node", required: true },
        title: { type: "string", description: "Document title", required: true },
        "content-file": { type: "string", description: "Read the node body from this file (default: empty body)" },
        ...commonArgs,
      },
      async run({ args }) {
        await withRuleService(async (svc) => {
          let content = "";
          if (args["content-file"] !== undefined) {
            try {
              content = readFileSync(args["content-file"] as string, "utf8");
            } catch (cause) {
              reportFailure(
                { code: "VALIDATION_ERROR", field: "content-file", message: `cannot read ${String(args["content-file"])}: ${cause instanceof Error ? cause.message : String(cause)}` },
                args.json === true,
              );
              return;
            }
          }
          const input: AddNodeInput = {
            node: args.node as AddNodeInput["node"],
            label: args.label as string,
            title: args.title as string,
            content,
          };
          const result = await svc.addNode(args.parent as string, input, { by: resolveActor(args.by as string | undefined) });
          if (!result.ok) return reportFailure(result.error, args.json === true);
          if (args.json) console.log(JSON.stringify({ ok: true, data: { id: result.value.id, slug: result.value.slug, node: input.node } }, null, 2));
          else console.log(`Created baseline ${input.node} ${result.value.slug} (${result.value.id}).`);
        });
      },
    }),
    "set-label": defineCommand({
      meta: { name: "set-label", description: "Set a baseline node's display label" },
      args: {
        node: { type: "positional", description: "Baseline node ID or slug", required: true },
        label: { type: "positional", description: "New label", required: true },
        ...commonArgs,
      },
      async run({ args }) {
        await withRuleService(async (svc) => {
          const result = await svc.setLabel(args.node as string, args.label as string, { by: resolveActor(args.by as string | undefined) });
          if (!result.ok) return reportFailure(result.error, args.json === true);
          if (args.json) console.log(JSON.stringify({ ok: true, data: { slug: result.value.slug, label: args.label } }, null, 2));
          else console.log(`Label of ${result.value.slug} set to '${String(args.label)}'.`);
        });
      },
    }),
    depends: defineCommand({
      meta: { name: "depends", description: "Add / remove depends_on rule ids on a baseline leaf" },
      args: {
        leaf: { type: "positional", description: "Baseline leaf ID or slug", required: true },
        add: { type: "string", description: "[repeatable] Rule id (BR-n) to depend on; must exist" },
        remove: { type: "string", description: "[repeatable] Rule id (BR-n) to stop depending on" },
        ...commonArgs,
      },
      async run({ args }) {
        await withRuleService(async (svc) => {
          const result = await svc.setDependsOn(
            args.leaf as string,
            { add: repeatable(args.add), remove: repeatable(args.remove) },
            { by: resolveActor(args.by as string | undefined) },
          );
          if (!result.ok) return reportFailure(result.error, args.json === true);
          const dependsOn = result.value.extra["depends_on"];
          if (args.json) console.log(JSON.stringify({ ok: true, data: { slug: result.value.slug, depends_on: dependsOn } }, null, 2));
          else console.log(`${result.value.slug} depends_on: ${Array.isArray(dependsOn) && dependsOn.length > 0 ? dependsOn.join(", ") : "(none)"}`);
        });
      },
    }),
    glossary: defineCommand({
      meta: { name: "glossary", description: "Add / remove glossary terms on a baseline root|branch" },
      subCommands: {
        add: defineCommand({
          meta: { name: "add", description: "Define a term on a baseline root|branch" },
          args: {
            node: { type: "positional", description: "Baseline root|branch ID or slug", required: true },
            term: { type: "string", description: "The term", required: true },
            meaning: { type: "string", description: "What it means in this product", required: true },
            note: { type: "string", description: "Optional clarification" },
            ...commonArgs,
          },
          async run({ args }) {
            await withRuleService(async (svc) => {
              const entry = {
                term: args.term as string,
                meaning: args.meaning as string,
                ...(args.note !== undefined ? { note: args.note as string } : {}),
              };
              const result = await svc.glossaryAdd(args.node as string, entry, { by: resolveActor(args.by as string | undefined) });
              if (!result.ok) return reportFailure(result.error, args.json === true);
              if (args.json) console.log(JSON.stringify({ ok: true, data: { slug: result.value.slug, term: entry.term } }, null, 2));
              else console.log(`Defined '${entry.term}' on ${result.value.slug}.`);
            });
          },
        }),
        rm: defineCommand({
          meta: { name: "rm", description: "Remove a glossary term" },
          args: {
            node: { type: "positional", description: "Baseline root|branch ID or slug", required: true },
            term: { type: "string", description: "The exact term to remove", required: true },
            ...commonArgs,
          },
          async run({ args }) {
            await withRuleService(async (svc) => {
              const result = await svc.glossaryRemove(args.node as string, args.term as string, { by: resolveActor(args.by as string | undefined) });
              if (!result.ok) return reportFailure(result.error, args.json === true);
              if (args.json) console.log(JSON.stringify({ ok: true, data: { slug: result.value.slug, term: args.term } }, null, 2));
              else console.log(`Removed '${String(args.term)}' from ${result.value.slug}.`);
            });
          },
        }),
      },
    }),
    map: defineCommand({
      meta: { name: "map", description: "Map census sites of a baseline leaf to rules (or non-business reasons) and declare its commands" },
      args: {
        leaf: { type: "positional", description: "Baseline leaf ID or slug", required: true },
        site: { type: "string", description: "Census site key (file#symbol#code, from `lore baseline sites`) to map; needs --rule or --non-business" },
        rule: { type: "string", description: "[repeatable] Rule id (BR-n) of this leaf that the --site refusal enforces" },
        "non-business": { type: "string", description: "Reason the --site is not business behaviour (stored as non-business:<reason>)" },
        "remove-site": { type: "string", description: "[repeatable] Site key to unmap" },
        command: { type: "string", description: "[repeatable] CLI command name (e.g. 'ac add') this leaf answers for" },
        "remove-command": { type: "string", description: "[repeatable] Command name to drop" },
        ...commonArgs,
      },
      async run({ args }) {
        await withRuleService(async (svc) => {
          const json = args.json === true;
          const by = resolveActor(args.by as string | undefined);
          const site = typeof args.site === "string" ? args.site : undefined;
          const rules = repeatable(args.rule);
          const reason = typeof args["non-business"] === "string" ? args["non-business"] : undefined;
          if (site === undefined && (rules.length > 0 || reason !== undefined)) {
            return reportFailure({ code: "VALIDATION_ERROR", field: "site", message: "--rule / --non-business need --site <key>" }, json);
          }
          if (site !== undefined && (rules.length > 0) === (reason !== undefined)) {
            return reportFailure({ code: "VALIDATION_ERROR", field: "site", message: "--site needs exactly one of --rule BR-n (repeatable) or --non-business <reason>" }, json);
          }
          const change: SiteMapChange = {
            ...(site !== undefined ? { sites: { [site]: reason !== undefined ? [`${NON_BUSINESS_PREFIX}${reason}`] : rules } } : {}),
            removeSites: repeatable(args["remove-site"]),
            addCommands: repeatable(args.command),
            removeCommands: repeatable(args["remove-command"]),
          };
          const noChange = site === undefined && (change.removeSites?.length ?? 0) + (change.addCommands?.length ?? 0) + (change.removeCommands?.length ?? 0) === 0;
          if (noChange) {
            // Authorization-only: reports the claim-scope verdict (AC-BLS2-8) and records nothing.
            const authorized = await svc.authorizeNodeWrite(args.leaf as string, "baseline-map", by);
            if (!authorized.ok) return reportFailure(authorized.error, json);
            const slug = authorized.value.slug;
            if (json) console.log(JSON.stringify({ ok: true, data: { slug, authorized: true, recorded: false } }, null, 2));
            else console.log(`${slug}: site-map write authorized; nothing to record (pass --site/--command to change the map).`);
            return;
          }
          const result = await svc.setSiteMap(args.leaf as string, change, { by });
          if (!result.ok) return reportFailure(result.error, json);
          const siteMap = (result.value.extra["site_map"] ?? {}) as Record<string, string[]>;
          const commands = (result.value.extra["commands"] ?? []) as string[];
          if (json) console.log(JSON.stringify({ ok: true, data: { slug: result.value.slug, site_map: siteMap, commands } }, null, 2));
          else console.log(`${result.value.slug}: ${Object.keys(siteMap).length} site(s) mapped; commands: ${commands.length > 0 ? commands.join(", ") : "(none)"}`);
        });
      },
    }),
    sites: defineCommand({
      meta: { name: "sites", description: "List the failure sites a CLI command can reach (static census, TypeScript compiler API)" },
      args: {
        command: { type: "positional", description: "CLI command name, e.g. 'ac add' (or 'ac-add'); token 1 = commands/<token>.ts, further tokens = nested subcommands", required: true },
        json: { type: "boolean", description: "Output result as JSON" },
      },
      async run({ args }) {
        const json = args.json === true;
        try {
          const rootDir = requireCensusRoot();
          const command = args.command as string;
          const sites = listSites({ rootDir, entry: resolveCommandEntry({ rootDir, command }) });
          const dynamicCount = sites.filter((s) => s.dynamic).length;
          if (json) {
            console.log(JSON.stringify({ ok: true, data: { command, count: sites.length, not_measured: dynamicCount, unresolved_imports: sites.unresolvedImports, sites, bootstrap: sites.bootstrap } }, null, 2));
            if (sites.unresolvedImports.length > 0) process.exitCode = 1;
            return;
          }
          if (sites.unresolvedImports.length > 0) {
            for (const u of sites.unresolvedImports) console.log(`unresolved import ${u.specifier} (from ${u.from}): census INCOMPLETE, sites behind it are not listed`);
            process.exitCode = 1;
          }
          console.log(`${command}: ${sites.length} site(s), ${dynamicCount} not_measured, ${sites.bootstrap.length} bootstrap`);
          for (const site of sites) console.log(`${site.dynamic ? "~" : " "} ${site.key}`);
          for (const site of sites.bootstrap) console.log(`  bootstrap ${site.key}`);
        } catch (cause) {
          reportCensusFailure(cause, json);
        }
      },
    }),
    coverage: defineCommand({
      meta: { name: "coverage", description: "Check that a baseline leaf (or every leaf under a branch) accounts for every census site; exit 0 only when complete" },
      args: {
        target: { type: "positional", description: "Baseline leaf or branch|root ID or slug", required: true },
        json: { type: "boolean", description: "Output result as JSON" },
      },
      async run({ args }) {
        await runCoverage(args.target as string, args.json === true);
      },
    }),
    tree: defineCommand({
      meta: { name: "tree", description: "List the baseline tree (kind, label, status, rule counts)" },
      args: {
        root: { type: "positional", description: "Optional baseline node ID or slug to list only its subtree", required: false },
        states: { type: "boolean", description: "Add each rule's verification state, inputs and computed_from (consults git)" },
        rule: { type: "string", description: "Show one rule (BR-n): citing ACs, state and inputs; implies --states" },
        json: { type: "boolean", description: "Output result as JSON" },
      },
      async run({ args }) {
        if (args.states === true || args.rule !== undefined) {
          await runStatesTree(args);
          return;
        }
        await withRuleService(async (svc) => {
          const result = await svc.listBaselineTree(args.root as string | undefined);
          if (!result.ok) return reportFailure(result.error, args.json === true);
          if (args.json) {
            console.log(JSON.stringify({ ok: true, data: result.value }, null, 2));
            return;
          }
          if (result.value.length === 0) {
            console.log("No baseline nodes.");
            return;
          }
          for (const entry of result.value) {
            const counts = `live ${entry.rules.live} / deprecated ${entry.rules.deprecated} / retired ${entry.rules.retired}`;
            const rules = entry.node === "leaf" ? `  [rules: ${counts}]` : "";
            console.log(`${"  ".repeat(entry.depth)}${entry.node} ${entry.label ?? entry.title} (${entry.slug}, ${entry.status})${rules}`);
          }
        });
      },
    }),
  },
});
