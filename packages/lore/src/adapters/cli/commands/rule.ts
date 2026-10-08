/**
 * lore rule — the dedicated writer of baseline rules (permanent `BR-n` ids).
 *
 * Subcommands (thin pipes over `RuleService`):
 *   add <leaf> --statement <s> --confidence <c> --enforced-by <e> --example <x> [--example <y> ...]
 *       Allocate the next permanent id and append a `live` rule to a baseline leaf.
 *   set <BR-n> [--statement ..] [--confidence ..] [--enforced-by ..] [--example ..]
 *              [--lifecycle deprecated|retired] [--note <retirement note>] [--move-to <leaf>]
 *       Edit a rule, move it forward through its lifecycle (never back to live; retired needs
 *       --note), or relocate it to another leaf keeping its id.
 *
 *   show <BR-n> [--json]                                         statement, leaf, confidence, state, citing criteria
 *   find --spec <slug> | --file <path> | --text <q> [--json]     ranked rule ids
 *   impact <BR-n> [--json]                                       citing criteria, dependent leaves, depends_on cycles
 *
 * `lore set` cannot touch `extra.rules` (CorpusService replace guard) — this is the only writer.
 * Exit codes follow `exitCode(LoreError)`; `--json` emits `{ ok, data | error }`.
 *
 * Source: spec-baseline-slice-1-rules-with-permanent-ids-ac-citations §C3.
 */

import { defineCommand } from "citty";
import type { LoreError } from "@lore/core";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, resolveActor } from "../utils.js";
import type { App } from "../../../app.js";
import type { AddRuleInput, SetRulePatch } from "../../../service/rule-service.js";

/** citty/mri yields one string for a single occurrence of a repeatable flag, an array for >= 2, `undefined` for none. */
function repeatable(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
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

function failUsage(message: string, json: boolean): void {
  if (json) console.log(JSON.stringify({ ok: false, error: { code: "VALIDATION_ERROR", field: "args", message } }, null, 2));
  else process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 2;
}

export default defineCommand({
  meta: { name: "rule", description: "Add, edit and read baseline rules (permanent BR-n ids)" },
  subCommands: {
    show: defineCommand({
      meta: { name: "show", description: "Show a rule: statement, leaf, confidence, state and every citing criterion" },
      args: {
        rule: { type: "positional", description: "Rule id, e.g. BR-12", required: true },
        json: { type: "boolean", description: "Output result as JSON" },
      },
      async run({ args }) {
        const { app } = loadLoreApp();
        try {
          if (app.ruleReadService === undefined) return failUsage("RuleReadService is not available in this build.", args.json === true);
          const result = await app.ruleReadService.show(args.rule as string);
          if (!result.ok) return reportFailure(result.error, args.json === true);
          if (args.json) return void console.log(JSON.stringify({ ok: true, data: result.value }, null, 2));
          const v = result.value;
          console.log(`${v.id} [${v.state}, ${v.confidence}] on ${v.leaf}\n${v.statement}`);
          console.log(v.citingCriteria.length === 0 ? "Cited by: (none)" : `Cited by:\n${v.citingCriteria.map((c) => `  ${c.spec} ${c.ac}`).join("\n")}`);
        } finally {
          app.close();
        }
      },
    }),
    find: defineCommand({
      meta: { name: "find", description: "Find rule ids by --spec <slug>, --file <path> or --text <q> (exactly one)" },
      args: {
        spec: { type: "string", description: "Rules cited by this spec (slug or id)" },
        file: { type: "string", description: "Rules cited by specs whose code anchors include this file" },
        text: { type: "string", description: "Rules whose statement contains this text (case-insensitive)" },
        json: { type: "boolean", description: "Output result as JSON" },
      },
      async run({ args }) {
        const given = [args.spec, args.file, args.text].filter((v) => typeof v === "string");
        if (given.length !== 1) return failUsage("pass exactly one of --spec, --file, --text", args.json === true);
        const { app } = loadLoreApp();
        try {
          if (app.ruleReadService === undefined) return failUsage("RuleReadService is not available in this build.", args.json === true);
          const query =
            typeof args.spec === "string" ? { spec: args.spec } : typeof args.file === "string" ? { file: args.file } : { text: args.text as string };
          const result = await app.ruleReadService.find(query);
          if (!result.ok) return reportFailure(result.error, args.json === true);
          if (args.json) return void console.log(JSON.stringify({ ok: true, data: { rules: result.value } }, null, 2));
          console.log(result.value.length === 0 ? "No matching rules." : result.value.join("\n"));
        } finally {
          app.close();
        }
      },
    }),
    impact: defineCommand({
      meta: { name: "impact", description: "Impact of changing or retiring a rule: citing criteria, dependent leaves, cycles" },
      args: {
        rule: { type: "positional", description: "Rule id, e.g. BR-12", required: true },
        json: { type: "boolean", description: "Output result as JSON" },
      },
      async run({ args }) {
        const { app } = loadLoreApp();
        try {
          if (app.impactService === undefined) return failUsage("ImpactService is not available in this build.", args.json === true);
          const result = await app.impactService.impact(args.rule as string);
          if (!result.ok) return reportFailure(result.error, args.json === true);
          if (args.json) return void console.log(JSON.stringify({ ok: true, data: result.value }, null, 2));
          const v = result.value;
          console.log(`Citing criteria (${v.citingCriteria.length}):${v.citingCriteria.map((c) => `\n  ${c.spec} ${c.ac}`).join("")}`);
          console.log(`Dependent leaves (${v.dependentLeaves.length}):${v.dependentLeaves.map((l) => `\n  ${l}`).join("")}`);
          console.log(`Cycles (${v.cycles.length}):${v.cycles.map((c) => `\n  ${c.join(" <-> ")}`).join("")}`);
        } finally {
          app.close();
        }
      },
    }),
    add: defineCommand({
      meta: { name: "add", description: "Append a new live rule to a baseline leaf; prints the allocated BR-n id" },
      args: {
        leaf: { type: "positional", description: "Baseline leaf document ID or slug", required: true },
        statement: { type: "string", description: "The behavioural rule, <= 500 chars, no implementation detail", required: true },
        confidence: { type: "string", description: "established | undecided | unconfirmed | observed", required: true },
        "enforced-by": { type: "string", description: "guaranteed | both | prompt-only", required: true },
        example: { type: "string", description: "[repeatable, 1-3 required] A concrete example, <= 300 chars" },
        by: { type: "string", description: "Actor identity (default: resolved from $LORE_ACTOR)" },
        json: { type: "boolean", description: "Output result as JSON" },
      },
      async run({ args }) {
        const { app } = loadLoreApp();
        try {
          const svc = requireRuleService(app);
          if (svc === undefined) return;
          const input = {
            statement: args.statement as string,
            confidence: args.confidence as AddRuleInput["confidence"],
            enforced_by: args["enforced-by"] as AddRuleInput["enforced_by"],
            examples: repeatable(args.example) ?? [],
          };
          const result = await svc.addRule(args.leaf as string, input, { by: resolveActor(args.by as string | undefined) });
          if (!result.ok) return reportFailure(result.error, args.json === true);
          if (args.json) {
            console.log(JSON.stringify({ ok: true, data: { ruleId: result.value.ruleId, leaf: result.value.doc.slug, version: result.value.doc.version } }, null, 2));
          } else {
            console.log(`Added ${result.value.ruleId} to ${result.value.doc.slug} (v${result.value.doc.version}).`);
          }
        } finally {
          app.close();
        }
      },
    }),
    set: defineCommand({
      meta: { name: "set", description: "Edit a rule, advance its lifecycle (forward-only) or move it to another leaf" },
      args: {
        rule: { type: "positional", description: "Rule id, e.g. BR-12", required: true },
        statement: { type: "string", description: "Replace the statement" },
        confidence: { type: "string", description: "established | undecided | unconfirmed | observed" },
        "enforced-by": { type: "string", description: "guaranteed | both | prompt-only" },
        example: { type: "string", description: "[repeatable] Replace the examples wholesale (1-3)" },
        lifecycle: { type: "string", description: "deprecated | retired (forward-only; never back to live)" },
        note: { type: "string", description: "Retirement note — required with --lifecycle retired, stored as retired_note" },
        "move-to": { type: "string", description: "Destination baseline leaf (ID or slug); the BR-n id is unchanged" },
        by: { type: "string", description: "Actor identity (default: resolved from $LORE_ACTOR)" },
        json: { type: "boolean", description: "Output result as JSON" },
      },
      async run({ args }) {
        const { app } = loadLoreApp();
        try {
          const svc = requireRuleService(app);
          if (svc === undefined) return;
          const examples = repeatable(args.example);
          const patch: SetRulePatch = {
            ...(args.statement !== undefined ? { statement: args.statement as string } : {}),
            ...(args.confidence !== undefined ? { confidence: args.confidence as AddRuleInput["confidence"] } : {}),
            ...(args["enforced-by"] !== undefined ? { enforced_by: args["enforced-by"] as AddRuleInput["enforced_by"] } : {}),
            ...(examples !== undefined ? { examples } : {}),
            ...(args.lifecycle !== undefined ? { lifecycle: args.lifecycle as NonNullable<SetRulePatch["lifecycle"]> } : {}),
            ...(args.note !== undefined ? { note: args.note as string } : {}),
            ...(args["move-to"] !== undefined ? { moveTo: args["move-to"] as string } : {}),
          };
          const result = await svc.setRule(args.rule as string, patch, { by: resolveActor(args.by as string | undefined) });
          if (!result.ok) return reportFailure(result.error, args.json === true);
          if (args.json) {
            console.log(JSON.stringify({ ok: true, data: { rule: result.value.rule, leaf: result.value.doc.slug, version: result.value.doc.version } }, null, 2));
          } else {
            console.log(`Updated ${result.value.rule.id} [${result.value.rule.lifecycle}] on ${result.value.doc.slug} (v${result.value.doc.version}).`);
          }
        } finally {
          app.close();
        }
      },
    }),
  },
});
