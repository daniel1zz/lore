/**
 * lore rule — the dedicated writer of baseline rules (permanent `BR-n` ids).
 *
 * Subcommands (thin pipes over `RuleService`):
 *   add <leaf|standard|debt-registry> --statement <s> --confidence <c> --enforced-by <e> --example <x> [--example <y> ...]
 *       [--current-reality <t> --target-rule <t> (--current-exception AD-n... | --current-exceptions-none) --migration <t>]
 *       Allocate the next permanent id (BR-n on a business leaf, AS-n on an architecture standard, AD-n on a
 *       debt-registry) and append a `live` rule. The four-part standard flags are AS-only, all four or none.
 *   set <BR-n> [--statement ..] [--confidence ..] [--enforced-by ..] [--example ..]
 *              [--current-reality ..] [--target-rule ..] [--current-exception AD-n ... | --current-exceptions-none] [--migration ..]
 *              [--lifecycle retired] [--note <retirement note>] [--move-to <leaf>]
 *       Edit a rule, retire it (retired needs --note; `deprecated` is refused: retire it, or record the retirement
 *       in a spec's change set), or relocate it to another leaf keeping its id.
 *
 *   propose <spec> add --leaf <leaf> --statement <s> --example <e>... --enforced-by <v>
 *   propose <spec> modify <BR-n> [--statement <s>] [--example <e>...] [--enforced-by <v>]
 *   propose <spec> amend <BR-n> [--statement <s>] [--example <e>...] [--enforced-by <v>]
 *       Rewrite THIS spec's own proposed `add` in place (same id and leaf; --example replaces wholesale; must change
 *       something). Refused (exit 4, naming the id) for a live id or one another spec proposes.
 *   propose <spec> retire <BR-n> --note <why>             [--correction "<why>" on a locked spec, BR-1069]
 *       Write the spec's rule change set (`extra.rule_changes`); `add` reserves the next BR-n as `proposed` and
 *       touches no leaf. The baseline takes the change only when the spec lands.
 *   changes <spec> [--json]                                      the spec's change set
 *   apply <spec> [--json]                                        land the change set: exit 0 applied | 4 refused (names the
 *       criteria citing a changed rule without a runner-attested pass; nothing written) | 2 usage. Idempotent. Plan close
 *       runs the same apply; a deprecated spec's proposed ids are retired "never landed: <spec>".
 *
 *   show <BR-n> [--json]                                         statement, leaf, confidence, state, citing criteria
 *                                                                (a proposed id: "proposed by <spec>, not in the baseline")
 *   find --spec <slug> | --file <path> | --text <q> [--include-retired] [--json]   ranked LIVE rule ids
 *   impact <BR-n> [--json]                                       citing criteria, dependent leaves, depends_on cycles
 *
 * `lore set` cannot touch `extra.rules` (CorpusService replace guard) — this is the only writer.
 * Exit codes follow `exitCode(LoreError)`; `--json` emits `{ ok, data | error }`.
 *
 * Source: spec-baseline-slice-1-rules-with-permanent-ids-ac-citations §C3.
 */

import type { Invocation } from "@lore/core";

import { defineCommand } from "citty";
import type { LoreError } from "@lore/core";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor, resolveActor } from "../utils.js";
import type { App } from "../../../app.js";
import type { AddRuleInput, SetRulePatch } from "../../../service/rule-service.js";
import type { ProposeRuleChangeInput, RuleEnforcement } from "../../../service/rule-change-service.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";
import type { CliIo } from "../output.js";
import type { ExitReport } from "../cli-exit.js";

/** citty/mri yields one string for a single occurrence of a repeatable flag, an array for >= 2, `undefined` for none. */
function repeatable(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
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
    setExitCode(1);
    return undefined;
  }
  return app.ruleService;
}

/**
 * The four-part standard fields from flags. `--current-exception` and `--current-exceptions-none`
 * are mutually exclusive; each part is passed only when given (the service enforces all-or-nothing).
 */
function fourPartFromArgs(args: Record<string, unknown>): { ok: true; parts: FourPartFlags } | { ok: false; message: string } {
  const exceptions = repeatable(args["current-exception"]);
  if (exceptions !== undefined && args["current-exceptions-none"] === true) {
    return { ok: false, message: "pass either --current-exception AD-n... or --current-exceptions-none, not both" };
  }
  return {
    ok: true,
    parts: {
      ...(args["current-reality"] !== undefined ? { current_reality: args["current-reality"] as string } : {}),
      ...(args["target-rule"] !== undefined ? { target_rule: args["target-rule"] as string } : {}),
      ...(exceptions !== undefined ? { current_exceptions: exceptions } : args["current-exceptions-none"] === true ? { current_exceptions: [] } : {}),
      ...(args.migration !== undefined ? { migration: args.migration as string } : {}),
    },
  };
}

type FourPartFlags = Pick<AddRuleInput, "current_reality" | "target_rule" | "current_exceptions" | "migration">;

function failUsage(io: CliIo, message: string, json: boolean): ExitReport {
  if (json) printLine(io.stdout, JSON.stringify({ ok: false, error: { code: "VALIDATION_ERROR", field: "args", message } }, null, 2));
  else io.stderr.write(`Error: ${message}\n`);
  return 2;
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
      async run(context) {
        const { args } = context;
        const inv = invocationOf(context);
        const { app } = loadLoreApp({ inv });
        try {
          if (app.ruleReadService === undefined) return failUsage(inv.io, "RuleReadService is not available in this build.", args.json === true);
          const result = await app.ruleReadService.show(args.rule as string);
          if (!result.ok) return reportFailure(inv, result.error, args.json === true);
          if (args.json) return void printLine(inv.io.stdout, JSON.stringify({ ok: true, data: result.value }, null, 2));
          const v = result.value;
          if (v.state === "proposed") {
            // A proposed rule is not part of the baseline: it has no confidence and no leaf yet (spec: change set).
            printLine(inv.io.stdout, `${v.id} [proposed] — proposed by ${v.proposed_by ?? "(unknown spec)"}, not in the baseline\nWill land on ${v.leaf}.\n${v.statement}`);
          } else {
            printLine(inv.io.stdout, `${v.id} [${v.state}, ${v.confidence}] on ${v.leaf}\n${v.statement}`);
          }
          printLine(inv.io.stdout, v.citingCriteria.length === 0 ? "Cited by: (none)" : `Cited by:\n${v.citingCriteria.map((c) => `  ${c.spec} ${c.ac}`).join("\n")}`);
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
        "include-retired": { type: "boolean", description: "Also list retired rules (tombstones); default lists only rules that still describe the product" },
        json: { type: "boolean", description: "Output result as JSON" },
      },
      async run(context) {
        const { args } = context;
        const inv = invocationOf(context);
        const given = [args.spec, args.file, args.text].filter((v) => typeof v === "string");
        if (given.length !== 1) return failUsage(inv.io, "pass exactly one of --spec, --file, --text", args.json === true);
        const { app } = loadLoreApp({ inv });
        try {
          if (app.ruleReadService === undefined) return failUsage(inv.io, "RuleReadService is not available in this build.", args.json === true);
          const query =
            typeof args.spec === "string" ? { spec: args.spec } : typeof args.file === "string" ? { file: args.file } : { text: args.text as string };
          const result = await app.ruleReadService.find(query, { includeTombstones: args["include-retired"] === true });
          if (!result.ok) return reportFailure(inv, result.error, args.json === true);
          if (args.json) return void printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { rules: result.value } }, null, 2));
          printLine(inv.io.stdout, result.value.length === 0 ? "No matching rules." : result.value.join("\n"));
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
      async run(context) {
        const { args } = context;
        const inv = invocationOf(context);
        const { app } = loadLoreApp({ inv });
        try {
          if (app.impactService === undefined) return failUsage(inv.io, "ImpactService is not available in this build.", args.json === true);
          const result = await app.impactService.impact(args.rule as string);
          if (!result.ok) return reportFailure(inv, result.error, args.json === true);
          if (args.json) return void printLine(inv.io.stdout, JSON.stringify({ ok: true, data: result.value }, null, 2));
          const v = result.value;
          // Standing split (spec D7): Living (edited in place) before Records (locked once approved).
          printLine(inv.io.stdout, `Living (${v.living.length}):${v.living.map((l) => `\n  ${l}`).join("")}`);
          printLine(inv.io.stdout, `Records (${v.records.length}):${v.records.map((r) => `\n  ${r.slug} ${r.acId}`).join("")}`);
          printLine(inv.io.stdout, `Citing criteria (${v.citingCriteria.length}):${v.citingCriteria.map((c) => `\n  ${c.spec} ${c.ac}`).join("")}`);
          printLine(inv.io.stdout, `Dependent leaves (${v.dependentLeaves.length}):${v.dependentLeaves.map((l) => `\n  ${l}`).join("")}`);
          printLine(inv.io.stdout, `Cycles (${v.cycles.length}):${v.cycles.map((c) => `\n  ${c.join(" <-> ")}`).join("")}`);
        } finally {
          app.close();
        }
      },
    }),
    propose: defineCommand({
      meta: {
        name: "propose",
        description:
          "Add an entry to a spec's rule change set: `add` reserves the next BR-n (proposed, not in the baseline), `modify` / `retire` name a live rule, `amend` rewrites a proposed entry of this spec",
      },
      args: {
        spec: { type: "positional", description: "Spec document ID or slug", required: true },
        op: { type: "positional", description: "add | modify | retire | amend", required: true },
        rule: { type: "positional", description: "Rule id BR-n (modify | retire | amend; amend names an id this spec proposed)", required: false },
        leaf: { type: "string", description: "[add] Baseline leaf the rule will land on (ID or slug)" },
        statement: { type: "string", description: "[add | modify] The behavioural rule, <= 500 chars" },
        example: { type: "string", description: "[add | modify, repeatable, 1-3] A concrete example, <= 300 chars" },
        "enforced-by": { type: "string", description: "[add | modify] guaranteed | both | prompt-only" },
        note: { type: "string", description: "[retire] Why the rule is no longer true" },
        correction: { type: "string", description: "Fix a LOCKED spec's change set as an audited correction; the value is the reason (BR-1069)" },
        json: { type: "boolean", description: "Output result as JSON" },
      },
      async run(context) {
        const { args } = context;
        const inv = invocationOf(context);
        const json = args.json === true;
        const op = args.op as string;
        const examples = repeatable(args.example);
        let input: ProposeRuleChangeInput;
        if (op === "add") {
          if (args.rule !== undefined) return failUsage(inv.io, "`add` takes no rule id: the registry allocates it", json);
          if (args.leaf === undefined || args.statement === undefined || args["enforced-by"] === undefined) {
            return failUsage(inv.io, "`add` requires --leaf, --statement, --example (1-3) and --enforced-by", json);
          }
          input = {
            op: "add",
            leaf: args.leaf as string,
            statement: args.statement as string,
            examples: examples ?? [],
            enforced_by: args["enforced-by"] as RuleEnforcement,
          };
        } else if (op === "modify" || op === "retire" || op === "amend") {
          if (args.rule === undefined) return failUsage(inv.io, `\`${op}\` requires the rule id: lore rule propose <spec> ${op} <BR-n> ...`, json);
          if (op === "retire") {
            if (args.note === undefined) return failUsage(inv.io, "`retire` requires --note <why>", json);
            input = { op: "retire", id: args.rule as string, note: args.note as string };
          } else {
            input = {
              op,
              id: args.rule as string,
              ...(args.statement !== undefined ? { statement: args.statement as string } : {}),
              ...(examples !== undefined ? { examples } : {}),
              ...(args["enforced-by"] !== undefined
                ? { enforced_by: args["enforced-by"] as RuleEnforcement }
                : {}),
            };
          }
        } else {
          return failUsage(inv.io, `op must be add, modify, retire or amend (got '${op}')`, json);
        }
        const { app } = loadLoreApp({ inv });
        try {
          if (app.ruleChangeService === undefined) return failUsage(inv.io, "RuleChangeService is not available in this build.", json);
          const result = await app.ruleChangeService.propose(args.spec as string, input, {
            by: resolveActor(inv.io, undefined, inv.env, inv.cwd, inv.user),
            ...(args.correction !== undefined ? { correction: { reason: args.correction as string } } : {}),
          });
          if (!result.ok) return reportFailure(inv, result.error, json);
          const { change, doc } = result.value;
          if (json) return void printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { change, spec: doc.slug, version: doc.version } }, null, 2));
          printLine(inv.io.stdout, 
            change.op === "add"
              ? `Reserved ${change.id} (proposed, not in the baseline) for ${change.leaf} in ${doc.slug} (v${doc.version}).`
              : args.op === "amend"
              ? `Amended ${change.id} (proposed, not in the baseline) in ${doc.slug} (v${doc.version}); id and leaf unchanged.`
              : `Recorded ${change.op} of ${change.id} in ${doc.slug} (v${doc.version}); the baseline is unchanged until the spec lands.`,
          );
        } finally {
          app.close();
        }
      },
    }),
    apply: defineCommand({
      meta: {
        name: "apply",
        description:
          "Land a spec's rule change set in the baseline: proposed ids become live, modifies rewrite, retires retire — only when every criterion citing a changed rule has a runner-attested pass (exit 4 otherwise, naming them)",
      },
      args: {
        spec: { type: "positional", description: "Spec document ID or slug", required: true },
        json: { type: "boolean", description: "Output result as JSON" },
      },
      async run(context) {
        const { args } = context;
        const inv = invocationOf(context);
        const json = args.json === true;
        const { app } = loadLoreApp({ inv });
        try {
          if (app.ruleChangeService === undefined) return failUsage(inv.io, "RuleChangeService is not available in this build.", json);
          const result = await app.ruleChangeService.apply(args.spec as string, { by: resolveActor(inv.io, undefined, inv.env, inv.cwd, inv.user) });
          if (!result.ok) return reportFailure(inv, result.error, json);
          const outcome = result.value;
          if (json) return void printLine(inv.io.stdout, JSON.stringify({ ok: true, data: outcome }, null, 2));
          if (outcome.kind === "noop") {
            const why = {
              "no-changes": "has no rule changes",
              "already-applied": "rule changes already landed",
              "already-abandoned": "is deprecated and its proposed rules are already retired",
            }[outcome.reason];
            return void printLine(inv.io.stdout, `${outcome.spec}: nothing to apply (${why}).`);
          }
          const verb = outcome.kind === "applied" ? "Applied rule changes of" : "Retired the proposed rules (never landed) of";
          printLine(inv.io.stdout, `${verb} ${outcome.spec}:`);
          for (const leaf of outcome.leaves) printLine(inv.io.stdout, `  ${leaf.leaf} (v${leaf.version}): ${leaf.rules.join(", ")}`);
        } finally {
          app.close();
        }
      },
    }),
    changes: defineCommand({
      meta: { name: "changes", description: "List a spec's rule change set (what it proposes, modifies and retires)" },
      args: {
        spec: { type: "positional", description: "Spec document ID or slug", required: true },
        json: { type: "boolean", description: "Output result as JSON" },
      },
      async run(context) {
        const { args } = context;
        const inv = invocationOf(context);
        const { app } = loadLoreApp({ inv });
        try {
          if (app.ruleChangeService === undefined) return failUsage(inv.io, "RuleChangeService is not available in this build.", args.json === true);
          const result = await app.ruleChangeService.changes(args.spec as string);
          if (!result.ok) return reportFailure(inv, result.error, args.json === true);
          if (args.json) return void printLine(inv.io.stdout, JSON.stringify({ ok: true, data: result.value }, null, 2));
          const { spec, changes } = result.value;
          if (changes.length === 0) return void printLine(inv.io.stdout, `${spec}: no rule changes.`);
          printLine(inv.io.stdout, `${spec}: ${changes.length} rule change(s)`);
          for (const c of changes) {
            if (c.op === "add") printLine(inv.io.stdout, `  add ${c.id} on ${c.leaf}: ${c.statement}`);
            else if (c.op === "retire") printLine(inv.io.stdout, `  retire ${c.id}: ${c.note}`);
            else printLine(inv.io.stdout, `  modify ${c.id}${c.statement !== undefined ? `: ${c.statement}` : ""}`);
          }
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
        "current-reality": { type: "string", description: "[architecture standard] What the code does today (four-part standard: all four parts or none)" },
        "target-rule": { type: "string", description: "[architecture standard] The rule the code should follow" },
        "current-exception": { type: "string", description: "[architecture standard, repeatable] A live debt entry id (AD-n) that excepts this standard today" },
        "current-exceptions-none": { type: "boolean", description: "[architecture standard] State that the standard has no current exceptions (empty list)" },
        migration: { type: "string", description: "[architecture standard] How the exceptions get closed" },
        json: { type: "boolean", description: "Output result as JSON" },
      },
      async run(context) {
        const { args } = context;
        const inv = invocationOf(context);
        const { app } = loadLoreApp({ inv });
        try {
          const svc = requireRuleService(inv.io, app);
          if (svc === undefined) return;
          const four = fourPartFromArgs(args);
          if (!four.ok) return failUsage(inv.io, four.message, args.json === true);
          const input: AddRuleInput = {
            statement: args.statement as string,
            confidence: args.confidence as AddRuleInput["confidence"],
            enforced_by: args["enforced-by"] as AddRuleInput["enforced_by"],
            examples: repeatable(args.example) ?? [],
            ...four.parts,
          };
          const result = await svc.addRule(args.leaf as string, input, { by: resolveActor(inv.io, undefined, inv.env, inv.cwd, inv.user) });
          if (!result.ok) return reportFailure(inv, result.error, args.json === true);
          if (args.json) {
            printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { ruleId: result.value.ruleId, leaf: result.value.doc.slug, version: result.value.doc.version } }, null, 2));
          } else {
            printLine(inv.io.stdout, `Added ${result.value.ruleId} to ${result.value.doc.slug} (v${result.value.doc.version}).`);
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
        "current-reality": { type: "string", description: "[architecture standard] What the code does today (replaces the stored part)" },
        "target-rule": { type: "string", description: "[architecture standard] The rule the code should follow" },
        "current-exception": { type: "string", description: "[architecture standard, repeatable] Replace the exceptions wholesale with these live debt entry ids (AD-n)" },
        "current-exceptions-none": { type: "boolean", description: "[architecture standard] State that the standard has no current exceptions (empty list)" },
        migration: { type: "string", description: "[architecture standard] How the exceptions get closed" },
        lifecycle: { type: "string", description: "retired (never back to live; `deprecated` is refused — see `lore rule propose <spec> retire`)" },
        note: { type: "string", description: "Retirement note — required with --lifecycle retired, stored as retired_note" },
        "move-to": { type: "string", description: "Destination baseline leaf (ID or slug); the BR-n id is unchanged" },
        json: { type: "boolean", description: "Output result as JSON" },
      },
      async run(context) {
        const { args } = context;
        const inv = invocationOf(context);
        const { app } = loadLoreApp({ inv });
        try {
          const svc = requireRuleService(inv.io, app);
          if (svc === undefined) return;
          const examples = repeatable(args.example);
          const four = fourPartFromArgs(args);
          if (!four.ok) return failUsage(inv.io, four.message, args.json === true);
          const patch: SetRulePatch = {
            ...(args.statement !== undefined ? { statement: args.statement as string } : {}),
            ...(args.confidence !== undefined ? { confidence: args.confidence as AddRuleInput["confidence"] } : {}),
            ...(args["enforced-by"] !== undefined ? { enforced_by: args["enforced-by"] as AddRuleInput["enforced_by"] } : {}),
            ...(examples !== undefined ? { examples } : {}),
            ...(args.lifecycle !== undefined ? { lifecycle: args.lifecycle as NonNullable<SetRulePatch["lifecycle"]> } : {}),
            ...(args.note !== undefined ? { note: args.note as string } : {}),
            ...(args["move-to"] !== undefined ? { moveTo: args["move-to"] as string } : {}),
            ...four.parts,
          };
          const result = await svc.setRule(args.rule as string, patch, { by: resolveActor(inv.io, undefined, inv.env, inv.cwd, inv.user) });
          if (!result.ok) return reportFailure(inv, result.error, args.json === true);
          if (args.json) {
            printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { rule: result.value.rule, leaf: result.value.doc.slug, version: result.value.doc.version } }, null, 2));
          } else {
            printLine(inv.io.stdout, `Updated ${result.value.rule.id} [${result.value.rule.lifecycle}] on ${result.value.doc.slug} (v${result.value.doc.version}).`);
          }
        } finally {
          app.close();
        }
      },
    }),
  },
});
