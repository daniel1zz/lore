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
import { defineCommand } from "citty";
import { AiConfigSchema, BASELINE_TREES, ruleIdPrefixOfNode } from "@lore/core";
import type { AIProvider, BaselineTree, DocRecord, Invocation, LoreError } from "@lore/core";
import { invocationOf } from "../command-invocation.js";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, resolveActor } from "../utils.js";
import type { App } from "../../../app.js";
import type { AddNodeInput, BaselineTreeEntry, SiteMapChange } from "../../../service/rule-service.js";
import { NON_BUSINESS_PREFIX, computeLeafCoverage } from "../../../service/leaf-coverage.js";
import { buildOwnerLeafIndex } from "../../../service/owned-by.js";
import { resolveDoc } from "../../../service/resolve.js";
import { SiteCensusError, type UnresolvedImport, findCensusRoot, listSites, resolveCommandEntry } from "../../../service/site-census.js";
import type { Site } from "../../../service/site-census.js";
import { RuleStateService } from "../../../service/rule-state-service.js";
import type { RuleStateEntry, RuleStateFull } from "../../../service/rule-state-service.js";
import { SpawnGitPort, resolveGitRoot } from "../../../service/rule-state-git-port.js";
import { SQLiteStore } from "../../../store/sqlite-store.js";
import { buildProviderRegistry } from "../../../ai/registry.js";
import { adoptCommand } from "./baseline-adopt.js";
import { runFidelity } from "../../../service/fidelity-sample.js";
import type { FidelityRecord } from "../../../service/fidelity-sample.js";

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
async function withRuleService(inv: Invocation, body: (svc: NonNullable<App["ruleService"]>) => Promise<void>): Promise<void> {
  const { app } = loadLoreApp({ inv });
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
async function runStatesTree(args: Record<string, unknown>, inv: Invocation): Promise<void> {
  const json = args.json === true;
  const { app, dbPath } = loadLoreApp({ inv });
  const store = new SQLiteStore(dbPath);
  try {
    const svc = requireRuleService(app);
    if (svc === undefined) return;
    const stateService = new RuleStateService(store, new SpawnGitPort(resolveGitRoot(inv.cwd)));
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
      const nodes = tree.value.map((n: BaselineTreeEntry) => ({ ...n, rule_states: byLeaf.get(n.slug) ?? [] }));
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
      // reason: byLeaf is keyed by the rule-holding doc (business leaf or architecture standard, BR-670); any other node has no entry.
      for (const r of byLeaf.get(entry.slug) ?? []) renderRuleState(r, `${indent}  `);
    }
    renderComputedFrom(full.value);
  } finally {
    store.close();
    app.close();
  }
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
async function runCoverage(target: string, json: boolean, inv: Invocation): Promise<void> {
  const { app, dbPath } = loadLoreApp({ inv });
  const store = new SQLiteStore(dbPath);
  try {
    const rootDir = requireCensusRoot(inv);
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
    const ownerLeaves = buildOwnerLeafIndex(all.value);
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
        ownerLeaves,
      });
      return {
        slug: leaf.slug,
        commands,
        sites: byKey.size,
        gaps: verdict.gaps,
        not_measured: verdict.notMeasured,
        unresolved_imports: verdict.unresolvedImports ?? [],
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
function reportFidelityFailure(error: LoreError, json: boolean): void {
  reportFailure(error, json);
  if (error.code === "VALIDATION_ERROR") process.exitCode = 2;
}

/** `fidelity`: validate flags, resolve the AI provider (never skipping the judge), run, store, print. */
async function runFidelityCommand(args: Record<string, unknown>, inv: Invocation): Promise<void> {
  const json = args.json === true;
  const fail = (field: string, message: string): void => reportFidelityFailure({ code: "VALIDATION_ERROR", field, message }, json);
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
    const registry = buildProviderRegistry(config?.ai ?? AiConfigSchema.parse({}));
    if (!registry.ok) return reportFidelityFailure(registry.error, json);
    const provider: AIProvider | undefined = registry.value.providers.get(registry.value.active);
    if (provider === undefined) return fail("ai", `active AI provider '${registry.value.active}' is not registered`);

    const result = await runFidelity({ store, ai: provider, size, seed, judges, exclusions: args.exclusions === true, repoRoot: inv.cwd });
    if (!result.ok) return reportFidelityFailure(result.error, json);
    const record = result.value;
    const share = record.mode === "exclusions" ? `${((record.wrong_share ?? 0) * 100).toFixed(1)}% wrong` : `${(record.faithful_share * 100).toFixed(1)}% faithful`;
    const created = await app.corpusService.create({
      type: "knowledge",
      title: `Baseline fidelity (${record.mode}) seed ${String(record.seed)}: ${share}`,
      extra: { sub_type: "research" },
      content: renderFidelityContent(record),
    });
    if (!created.ok) return reportFidelityFailure(created.error, json);
    if (json) {
      console.log(JSON.stringify({ ok: true, data: { record, doc: { id: created.value.id, slug: created.value.slug } } }, null, 2));
      return;
    }
    console.log(`Stored ${created.value.slug}: ${share} of ${record.size} sampled (pool ${record.pool}, seed ${String(record.seed)}, ${record.judges} judge(s), ${record.disagreements.length} disagreement(s)).`);
    console.log(`not_seen: ${record.not_seen}`);
    for (const v of record.verdicts) {
      if (v.verdict === "not_seen") console.log(`  ${v.n}. NOT SEEN ${(v.unseen_paths ?? []).join(", ")} - ${v.key} - ${v.reason}`);
      else console.log(`  ${v.n}. ${v.verdict === "faithful" ? "ok " : "BAD"} ${v.key} - ${v.reason}`);
    }
    for (const c of record.catch_all) console.log(`  catch-all ${c.rule_id}: cited by ${c.citing_criteria.length} criteria`);
  } finally {
    store.close();
    app.close();
  }
}

const commonArgs = {
  json: { type: "boolean", description: "Output result as JSON" },
} as const;

export default defineCommand({
  meta: { name: "baseline", description: "Build and edit the product-baseline tree (root / branch / leaf nodes)" },
  subCommands: {
    add: defineCommand({
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
        await withRuleService(inv, async (svc) => {
          if (args.tree !== undefined && !(BASELINE_TREES as readonly string[]).includes(args.tree as string)) {
            reportFailure(
              { code: "VALIDATION_ERROR", field: "tree", message: `--tree must be one of ${BASELINE_TREES.join(" | ")} (got '${String(args.tree)}')`, value: args.tree },
              args.json === true,
            );
            return;
          }
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
          const tree = (args.tree as BaselineTree | undefined) ?? "business";
          const input: AddNodeInput = {
            ...(args.tree !== undefined ? { tree } : {}),
            node: args.node as AddNodeInput["node"],
            label: args.label as string,
            title: args.title as string,
            content,
          };
          const result = await svc.addNode(args.parent as string, input, { by: resolveActor(undefined, inv.env, inv.cwd) });
          if (!result.ok) return reportFailure(result.error, args.json === true);
          if (args.json) console.log(JSON.stringify({ ok: true, data: { id: result.value.id, slug: result.value.slug, node: input.node, tree } }, null, 2));
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
      async run(context) {
        const { args } = context;
        const inv = invocationOf(context);
        await withRuleService(inv, async (svc) => {
          const result = await svc.setLabel(args.node as string, args.label as string, { by: resolveActor(undefined, inv.env, inv.cwd) });
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
      async run(context) {
        const { args } = context;
        const inv = invocationOf(context);
        await withRuleService(inv, async (svc) => {
          const result = await svc.setDependsOn(
            args.leaf as string,
            { add: repeatable(args.add), remove: repeatable(args.remove) },
            { by: resolveActor(undefined, inv.env, inv.cwd) },
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
          async run(context) {
            const { args } = context;
            const inv = invocationOf(context);
            await withRuleService(inv, async (svc) => {
              const entry = {
                term: args.term as string,
                meaning: args.meaning as string,
                ...(args.note !== undefined ? { note: args.note as string } : {}),
              };
              const result = await svc.glossaryAdd(args.node as string, entry, { by: resolveActor(undefined, inv.env, inv.cwd) });
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
          async run(context) {
            const { args } = context;
            const inv = invocationOf(context);
            await withRuleService(inv, async (svc) => {
              const result = await svc.glossaryRemove(args.node as string, args.term as string, { by: resolveActor(undefined, inv.env, inv.cwd) });
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
      async run(context) {
        const { args } = context;
        const inv = invocationOf(context);
        await withRuleService(inv, async (svc) => {
          const json = args.json === true;
          const by = resolveActor(undefined, inv.env, inv.cwd);
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
      async run(context) {
        const { args } = context;
        const inv = invocationOf(context);
        const json = args.json === true;
        try {
          const rootDir = requireCensusRoot(inv);
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
      async run(context) {
        const { args } = context;
        const inv = invocationOf(context);
        await runCoverage(args.target as string, args.json === true, inv);
      },
    }),
    fidelity: defineCommand({
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
        await runFidelityCommand(args, inv);
      },
    }),
    adopt: adoptCommand,
    tree: defineCommand({
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
          await runStatesTree(args, inv);
          return;
        }
        await withRuleService(inv, async (svc) => {
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
            // reason: BR-674 / #125 — counts follow the node kinds that hold rules (business leaf, architecture
            // standard, debt-registry), decided by core's ruleIdPrefixOfNode, never by `node === "leaf"`.
            const holdsRules = ruleIdPrefixOfNode({ tree: entry.tree, node: entry.node }) !== undefined;
            const rules = holdsRules ? `  [rules: ${counts}]` : "";
            const kind = entry.tree === "architecture" ? `architecture ${entry.node}` : entry.node;
            console.log(`${"  ".repeat(entry.depth)}${kind} ${entry.label ?? entry.title} (${entry.slug}, ${entry.status})${rules}`);
          }
        });
      },
    }),
  },
});
