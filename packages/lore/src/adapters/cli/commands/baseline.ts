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
 *   tree [root]     Minimal listing (node kind, label, status, rule tallies). The per-rule
 *                   state view (`--states`, `--rule`) belongs to the RuleStateService slice.
 *
 * `lore set` cannot touch `extra.node|label|depends_on|glossary` (CorpusService replace
 * guard) — these verbs are the only writers. Exit codes follow `exitCode(LoreError)`.
 *
 * Source: spec-baseline-slice-1-rules-with-permanent-ids-ac-citations §C3 (§C7 for `tree`).
 */

import { readFileSync } from "node:fs";
import { defineCommand } from "citty";
import type { LoreError } from "@lore/core";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, resolveActor } from "../utils.js";
import type { App } from "../../../app.js";
import type { AddNodeInput } from "../../../service/rule-service.js";

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
    tree: defineCommand({
      meta: { name: "tree", description: "List the baseline tree (kind, label, status, rule counts)" },
      args: {
        root: { type: "positional", description: "Optional baseline node ID or slug to list only its subtree", required: false },
        json: { type: "boolean", description: "Output result as JSON" },
      },
      async run({ args }) {
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
