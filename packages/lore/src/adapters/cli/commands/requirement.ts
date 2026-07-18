/**
 * lore requirement — SPEC-055 structured PRD requirement inventory surface.
 *
 * Subcommands (mirror `lore ac`, one tier up — target is a PRD, not a spec):
 *   add  <prd> <id> --statement <s> --priority <P0|P1|P2>
 *   list <prd>
 *   rm   <prd> <id> [--force]
 *
 * Thin pipe over `RequirementService`. The inventory is what `lore status
 * --check-requirements` audits against descendant spec AC `--covers` refs.
 *
 * Source: SPEC-055 §Scope.
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError } from "../utils.js";
import type { App } from "../../../app.js";

function requireRequirementService(app: App) {
  if (app.requirementService === undefined) {
    process.stderr.write("Error: RequirementService is not available in this build.\n");
    process.exitCode = 1;
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
        json: { type: "boolean", description: "Output result as JSON" },
      },
      async run({ args }) {
        const { app } = loadLoreApp();
        try {
          const svc = requireRequirementService(app);
          if (svc === undefined) return;
          const result = await svc.addRequirement(args.prd as string, {
            id: args.id as string,
            statement: args.statement as string,
            priority: args.priority as string,
          });
          if (!result.ok) {
            if (args.json) console.log(JSON.stringify({ ok: false, error: result.error }, null, 2));
            else process.stderr.write(formatError(result.error));
            process.exitCode = exitCode(result.error);
            return;
          }
          if (args.json) console.log(JSON.stringify({ ok: true, data: result.value }, null, 2));
          else console.log(`Added requirement ${args.id} (${result.value.length} total).`);
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
      async run({ args }) {
        const { app } = loadLoreApp();
        try {
          const svc = requireRequirementService(app);
          if (svc === undefined) return;
          const result = await svc.listRequirements(args.prd as string);
          if (!result.ok) {
            if (args.json) console.log(JSON.stringify({ ok: false, error: result.error }, null, 2));
            else process.stderr.write(formatError(result.error));
            process.exitCode = exitCode(result.error);
            return;
          }
          if (args.json) {
            console.log(JSON.stringify({ ok: true, data: result.value }, null, 2));
          } else if (result.value.length === 0) {
            console.log("No requirements declared on this PRD.");
          } else {
            for (const r of result.value) console.log(`  [${r.priority}] ${r.id} — ${r.statement}`);
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
        force: { type: "boolean", description: "Remove even if a descendant spec AC still references it" },
        json: { type: "boolean", description: "Output result as JSON" },
      },
      async run({ args }) {
        const { app } = loadLoreApp();
        try {
          const svc = requireRequirementService(app);
          if (svc === undefined) return;
          const result = await svc.removeRequirement(args.prd as string, args.id as string, {
            force: args.force === true,
          });
          if (!result.ok) {
            if (args.json) console.log(JSON.stringify({ ok: false, error: result.error }, null, 2));
            else process.stderr.write(formatError(result.error));
            process.exitCode = exitCode(result.error);
            return;
          }
          if (args.json) console.log(JSON.stringify({ ok: true, data: result.value }, null, 2));
          else console.log(`Removed requirement ${args.id} (${result.value.length} remain).`);
        } finally {
          app.close();
        }
      },
    }),
  },
});
