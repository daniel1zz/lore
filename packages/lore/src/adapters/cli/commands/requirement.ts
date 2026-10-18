/**
 * lore requirement — SPEC-055 structured PRD requirement inventory surface.
 *
 * Subcommands (mirror `lore ac`, one tier up — target is a PRD, not a spec):
 *   add  <prd> <id> --statement <s> --priority <P0|P1|P2> [--migrated-to BR-n]
 *   migrate <prd> <id> <BR-n>   (coverage then derives from the rule's live script citations, BR-983)
 *   list <prd>
 *   rm   <prd> <id> [--force]
 *
 * Thin pipe over `RequirementService`. The inventory is what `lore status
 * --check-requirements` audits against every spec's AC `--covers` refs.
 *
 * Source: SPEC-055 §Scope.
 */

import { defineCommand } from "citty";

import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor } from "../utils.js";
import type { App } from "../../../app.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";
import type { CliIo } from "../output.js";

function requireRequirementService(io: CliIo, app: App) {
  if (app.requirementService === undefined) {
    io.stderr.write("Error: RequirementService is not available in this build.\n");
    return undefined;
  }
  return app.requirementService;
}

export default defineCommand({
  meta: { name: "requirement", description: "Manage a PRD's structured requirement inventory (SPEC-055)" },
  subCommands: {
    add: defineCommand({
      meta: { name: "add", description: "Append a numbered requirement to a PRD" },
      args: {
        prd: { type: "positional", description: "PRD document ID or slug", required: true },
        id: { type: "positional", description: "Requirement id, e.g. R-1 or R-NEG-2", required: true },
        statement: { type: "string", description: "What the requirement asserts", required: true },
        priority: { type: "string", description: "P0 | P1 | P2", required: true },
        "migrated-to": { type: "string", description: "Baseline rule id (BR-n, must be live) this requirement is migrated to" },
        json: { type: "boolean", description: "Output result as JSON" },
      },
      async run(context) {
        const { args } = context;
        const inv = invocationOf(context);
        const { app } = loadLoreApp({ inv });
        try {
          const svc = requireRequirementService(inv.io, app);
          if (svc === undefined) return 1;
          const migratedTo = args["migrated-to"] as string | undefined;
          const result = await svc.addRequirement(
            args.prd as string,
            {
              id: args.id as string,
              statement: args.statement as string,
              priority: args.priority as string,
              ...(migratedTo !== undefined ? { migrated_to: migratedTo } : {}),
            },
            { requireLiveRule: true },
          );
          if (!result.ok) {
            if (args.json) printLine(inv.io.stdout, JSON.stringify({ ok: false, error: result.error }, null, 2));
            else inv.io.stderr.write(formatErrorFor(inv, result.error));
            return exitCode(result.error);
          }
          if (args.json) printLine(inv.io.stdout, JSON.stringify({ ok: true, data: result.value }, null, 2));
          else printLine(inv.io.stdout, `Added requirement ${args.id} (${result.value.length} total).`);
        } finally {
          app.close();
        }
      },
    }),
    migrate: defineCommand({
      meta: { name: "migrate", description: "Mark a requirement as migrated to a live baseline rule (coverage then derives from citations)" },
      args: {
        prd: { type: "positional", description: "PRD document ID or slug", required: true },
        id: { type: "positional", description: "Requirement id to migrate", required: true },
        rule: { type: "positional", description: "Baseline rule id, e.g. BR-12 (must be live)", required: true },
        json: { type: "boolean", description: "Output result as JSON" },
      },
      async run(context) {
        const { args } = context;
        const inv = invocationOf(context);
        const { app } = loadLoreApp({ inv });
        try {
          const svc = requireRequirementService(inv.io, app);
          if (svc === undefined) return 1;
          const result = await svc.migrateRequirement(args.prd as string, args.id as string, args.rule as string);
          if (!result.ok) {
            if (args.json) printLine(inv.io.stdout, JSON.stringify({ ok: false, error: result.error }, null, 2));
            else inv.io.stderr.write(formatErrorFor(inv, result.error));
            return exitCode(result.error);
          }
          if (args.json) printLine(inv.io.stdout, JSON.stringify({ ok: true, data: result.value }, null, 2));
          else printLine(inv.io.stdout, `Migrated requirement ${args.id} to ${args.rule}.`);
        } finally {
          app.close();
        }
      },
    }),
    list: defineCommand({
      meta: { name: "list", description: "List a PRD's declared requirements" },
      args: {
        prd: { type: "positional", description: "PRD document ID or slug", required: true },
        json: { type: "boolean", description: "Output result as JSON" },
      },
      async run(context) {
        const { args } = context;
        const inv = invocationOf(context);
        const { app } = loadLoreApp({ inv });
        try {
          const svc = requireRequirementService(inv.io, app);
          if (svc === undefined) return 1;
          const result = await svc.listRequirements(args.prd as string);
          if (!result.ok) {
            if (args.json) printLine(inv.io.stdout, JSON.stringify({ ok: false, error: result.error }, null, 2));
            else inv.io.stderr.write(formatErrorFor(inv, result.error));
            return exitCode(result.error);
          }
          if (args.json) {
            printLine(inv.io.stdout, JSON.stringify({ ok: true, data: result.value }, null, 2));
          } else if (result.value.length === 0) {
            printLine(inv.io.stdout, "No requirements declared on this PRD.");
          } else {
            for (const r of result.value) printLine(inv.io.stdout, `  [${r.priority}] ${r.id}${r.migrated_to !== undefined ? ` -> ${r.migrated_to}` : ""} — ${r.statement}`);
          }
        } finally {
          app.close();
        }
      },
    }),
    rm: defineCommand({
      meta: { name: "rm", description: "Remove a requirement from a PRD" },
      args: {
        prd: { type: "positional", description: "PRD document ID or slug", required: true },
        id: { type: "positional", description: "Requirement id to remove", required: true },
        force: { type: "boolean", description: "Remove even if a spec AC still references it" },
        json: { type: "boolean", description: "Output result as JSON" },
      },
      async run(context) {
        const { args } = context;
        const inv = invocationOf(context);
        const { app } = loadLoreApp({ inv });
        try {
          const svc = requireRequirementService(inv.io, app);
          if (svc === undefined) return 1;
          const result = await svc.removeRequirement(args.prd as string, args.id as string, {
            force: args.force === true,
          });
          if (!result.ok) {
            if (args.json) printLine(inv.io.stdout, JSON.stringify({ ok: false, error: result.error }, null, 2));
            else inv.io.stderr.write(formatErrorFor(inv, result.error));
            return exitCode(result.error);
          }
          if (args.json) printLine(inv.io.stdout, JSON.stringify({ ok: true, data: result.value }, null, 2));
          else printLine(inv.io.stdout, `Removed requirement ${args.id} (${result.value.length} remain).`);
        } finally {
          app.close();
        }
      },
    }),
  },
});
