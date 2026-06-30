/**
 * lore phase — manage declared phases on a plan document.
 *
 * Subcommands:
 *   add  <plan> <name> [--description]   Append a new phase (exit 4 on duplicate name).
 *   list <plan>                           List declared phases.
 *   rm   <plan> <name>                   Remove a phase (exit 4 if tasks still reference it).
 *   rename <plan> <old> <new>            Rename phase in plan + all child tasks.
 *
 * All subcommands accept --json for machine-readable output (SPEC-003 §4).
 * Exit codes per SPEC-003 §5:
 *   0 = success
 *   3 = DOC_NOT_FOUND (plan not found)
 *   4 = VALIDATION_ERROR (duplicate phase, unknown phase, tasks blocking rm, etc.)
 *
 * Source: SPEC-023 §4 AC-PHASE-8, AC-PHASE-9, §8 Q4
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError } from "../utils.js";
import type { PlanPhase } from "@lore/core";

export default defineCommand({
  meta: {
    name: "phase",
    description: "Manage declared phases on a plan (add / list / rm / rename)",
  },
  subCommands: {
    add: defineCommand({
      meta: { name: "add", description: "Append a new phase to a plan" },
      args: {
        plan: {
          type: "positional",
          description: "Plan document ID or slug",
          required: true,
        },
        name: {
          type: "positional",
          description: "Phase name (case-sensitive, trimmed)",
          required: true,
        },
        description: {
          type: "string",
          description: "Optional human-readable description for the phase",
        },
        json: {
          type: "boolean",
          description: "Output result as JSON",
        },
      },
      async run({ args }) {
        const { app } = loadLoreApp();
        try {
          // reason: required positional citty args are always string at runtime;
          // citty types them as string|boolean|string[]|undefined for generality.
          const result = await app.phaseService.addPhase(
            args.plan as string,
            args.name as string,
            typeof args.description === "string" ? args.description : undefined,
          );

          if (!result.ok) {
            process.stderr.write(formatError(result.error) + "\n");
            process.exitCode = exitCode(result.error);
            return;
          }

          if (args.json) {
            console.log(JSON.stringify({ ok: true, data: { phases: result.value } }, null, 2));
            return;
          }

          console.log(`Added phase "${args.name}" to plan ${args.plan}`);
          renderPhaseList(result.value);
        } finally {
          app.close();
        }
      },
    }),

    list: defineCommand({
      meta: { name: "list", description: "List declared phases for a plan" },
      args: {
        plan: {
          type: "positional",
          description: "Plan document ID or slug",
          required: true,
        },
        json: {
          type: "boolean",
          description: "Output result as JSON",
        },
      },
      async run({ args }) {
        const { app } = loadLoreApp();
        try {
          // reason: required positional citty args are always string at runtime
          const result = await app.phaseService.listPhases(args.plan as string);

          if (!result.ok) {
            process.stderr.write(formatError(result.error) + "\n");
            process.exitCode = exitCode(result.error);
            return;
          }

          if (args.json) {
            console.log(JSON.stringify({ ok: true, data: { phases: result.value } }, null, 2));
            return;
          }

          if (result.value.length === 0) {
            console.log("No phases declared on this plan.");
            return;
          }

          renderPhaseList(result.value);
        } finally {
          app.close();
        }
      },
    }),

    rm: defineCommand({
      meta: { name: "rm", description: "Remove a declared phase (fails if tasks still reference it)" },
      args: {
        plan: {
          type: "positional",
          description: "Plan document ID or slug",
          required: true,
        },
        name: {
          type: "positional",
          description: "Phase name to remove",
          required: true,
        },
        json: {
          type: "boolean",
          description: "Output result as JSON",
        },
      },
      async run({ args }) {
        const { app } = loadLoreApp();
        try {
          // reason: required positional citty args are always string at runtime
          const result = await app.phaseService.removePhase(args.plan as string, args.name as string);

          if (!result.ok) {
            process.stderr.write(formatError(result.error) + "\n");
            process.exitCode = exitCode(result.error);
            return;
          }

          if (args.json) {
            console.log(JSON.stringify({ ok: true, data: { phases: result.value } }, null, 2));
            return;
          }

          console.log(`Removed phase "${args.name as string}" from plan ${args.plan as string}`);
          if (result.value.length > 0) {
            renderPhaseList(result.value);
          } else {
            console.log("No phases remaining.");
          }
        } finally {
          app.close();
        }
      },
    }),

    rename: defineCommand({
      meta: {
        name: "rename",
        description: "Rename a phase in the plan and all referencing tasks",
      },
      args: {
        plan: {
          type: "positional",
          description: "Plan document ID or slug",
          required: true,
        },
        old: {
          type: "positional",
          description: "Current phase name",
          required: true,
        },
        new: {
          type: "positional",
          description: "New phase name",
          required: true,
        },
        json: {
          type: "boolean",
          description: "Output result as JSON",
        },
      },
      async run({ args }) {
        const { app } = loadLoreApp();
        try {
          // reason: required positional citty args are always string at runtime
          const result = await app.phaseService.renamePhase(
            args.plan as string,
            args.old as string,
            args.new as string,
          );

          if (!result.ok) {
            process.stderr.write(formatError(result.error) + "\n");
            process.exitCode = exitCode(result.error);
            return;
          }

          if (args.json) {
            console.log(JSON.stringify({ ok: true, data: { phases: result.value } }, null, 2));
            return;
          }

          console.log(`Renamed phase "${args.old as string}" → "${args.new as string}" on plan ${args.plan as string}`);
          renderPhaseList(result.value);
        } finally {
          app.close();
        }
      },
    }),
  },
});

// ─── Output Helpers ──────────────────────────────────────────────────────────

/**
 * Render a numbered list of phases to stdout.
 * Example output:
 *   1. Foundation — Core infrastructure setup
 *   2. Build
 */
function renderPhaseList(phases: PlanPhase[]): void {
  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i]!;
    const desc = phase.description ? ` — ${phase.description}` : "";
    console.log(`  ${i + 1}. ${phase.name}${desc}`);
  }
}
