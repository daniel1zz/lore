/**
 * lore phase — manage declared phases on a plan document (SPEC-023 legacy) AND the
 * SPEC-056 phase execution model surface (status/checklist/track) for `phase` docs.
 *
 * Legacy plan-phase subcommands (SPEC-023 — operate on `plan.extra.phases[]`, a
 * NAME-array on the plan, NOT a `phase` doc):
 *   add  <plan> <name> [--description]   Append a new phase (exit 4 on duplicate name).
 *   list <plan>                           List declared phases.
 *   rm   <plan> <name>                   Remove a phase (exit 4 if tasks still reference it).
 *   rename <plan> <old> <new>            Rename phase in plan + all child tasks.
 *
 * SPEC-056 phase-execution-model subcommands (operate on an actual `phase` DOCUMENT —
 * a distinct positional target from the legacy subcommands above):
 *   status <phase> [--json]                     Computed completion scorecard.
 *   checklist add <phase> <id> --statement <s> --bind <script|manual> [--oracle <k> --command <cmd>]
 *   checklist list <phase> [--json]
 *   checklist drop <phase> <id> --reason <text>
 *   checklist check <phase> <id>
 *   checklist edit <phase> <id> --statement <new>
 *   track add <phase> --note <text>
 *   track list <phase> [--json]
 *
 * All subcommands accept --json for machine-readable output (SPEC-003 §4).
 * Exit codes per SPEC-003 §5 (legacy plan-phase + checklist/track subcommands):
 *   0 = success
 *   3 = DOC_NOT_FOUND (plan/phase not found)
 *   4 = VALIDATION_ERROR (duplicate phase, unknown phase, tasks blocking rm, not a
 *       phase document, malformed checklist/track entry, unknown item id, etc.)
 *   5 = STALE_VERSION
 *
 * `status`'s exit code is a DISTINCT, business-outcome convention — see that
 * subcommand's own JSDoc below (mirrors `lore verify`'s exit-1-vs-LoreError split).
 *
 * Source: SPEC-023 §4 AC-PHASE-8, AC-PHASE-9, §8 Q4; SPEC-056 §Module Boundary;
 *   task-skill-implement-cli-mcp-surfaces-checklist-ref-evidence
 */

import { ulid } from "ulidx";
import { setExitCode } from "../run-scope.js";
import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, formatErrorFor, resolveActor } from "../utils.js";
import { requirePhaseChecklistService, getPhaseStatus } from "../phase-wiring.js";
import type { PlanPhase, ChecklistItem } from "@lore/core";
import type { PhaseStatusPayload } from "../../../flows/phase-status-flow.js";
import { invocationOf } from "../command-invocation.js";

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
      async run(context) {
        const { args } = context;
        const inv = invocationOf(context);
        const { app } = loadLoreApp({ inv });
        try {
          // reason: required positional citty args are always string at runtime;
          // citty types them as string|boolean|string[]|undefined for generality.
          const result = await app.phaseService.addPhase(
            args.plan as string,
            args.name as string,
            typeof args.description === "string" ? args.description : undefined,
          );

          if (!result.ok) {
            process.stderr.write(formatErrorFor(inv, result.error) + "\n");
            setExitCode(exitCode(result.error));
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
      async run(context) {
        const { args } = context;
        const inv = invocationOf(context);
        const { app } = loadLoreApp({ inv });
        try {
          // reason: required positional citty args are always string at runtime
          const result = await app.phaseService.listPhases(args.plan as string);

          if (!result.ok) {
            process.stderr.write(formatErrorFor(inv, result.error) + "\n");
            setExitCode(exitCode(result.error));
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
      async run(context) {
        const { args } = context;
        const inv = invocationOf(context);
        const { app } = loadLoreApp({ inv });
        try {
          // reason: required positional citty args are always string at runtime
          const result = await app.phaseService.removePhase(args.plan as string, args.name as string);

          if (!result.ok) {
            process.stderr.write(formatErrorFor(inv, result.error) + "\n");
            setExitCode(exitCode(result.error));
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
      async run(context) {
        const { args } = context;
        const inv = invocationOf(context);
        const { app } = loadLoreApp({ inv });
        try {
          // reason: required positional citty args are always string at runtime
          const result = await app.phaseService.renamePhase(
            args.plan as string,
            args.old as string,
            args.new as string,
          );

          if (!result.ok) {
            process.stderr.write(formatErrorFor(inv, result.error) + "\n");
            setExitCode(exitCode(result.error));
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

    // ── SPEC-056 phase execution model ───────────────────────────────────

    status: defineCommand({
      meta: {
        name: "status",
        description: "Computed completion scorecard for a phase document (SPEC-056)",
      },
      args: {
        phase: {
          type: "positional",
          description: "Phase document ID or slug",
          required: true,
        },
        json: {
          type: "boolean",
          description: "Output result as JSON",
        },
      },
      /**
       * Exit codes (business-outcome convention, NOT a LoreError mapping — mirrors
       * `lore verify`'s exit-1-vs-LoreError split):
       *   0 = phase state is "done"
       *   1 = phase state is "pending" or "active" (not done)
       *   2 = phase state is "vacuous" (nothing declared to complete)
       * A resolution/validation failure (not found, not a phase doc, no parent plan)
       * still maps through the normal exitCode()/formatError() LoreError pipeline
       * (3/4/5), independent of the three codes above.
       */
      async run(context) {
        const { args } = context;
        const inv = invocationOf(context);
        const { app } = loadLoreApp({ inv });
        try {
          const nowIso = new Date().toISOString();
          const result = await getPhaseStatus(app, args.phase as string, nowIso);

          if (!result.ok) {
            process.stderr.write(formatErrorFor(inv, result.error) + "\n");
            setExitCode(exitCode(result.error));
            return;
          }

          if (args.json) {
            console.log(JSON.stringify({ ok: true, data: result.value }, null, 2));
          } else {
            renderPhaseStatus(result.value);
          }
          setExitCode(result.value.exit_code);
        } finally {
          app.close();
        }
      },
    }),

    checklist: defineCommand({
      meta: {
        name: "checklist",
        description: "Manage a phase document's checklist items (add / list / drop / check / edit)",
      },
      subCommands: {
        add: defineCommand({
          meta: { name: "add", description: "Append a new checklist item to a phase" },
          args: {
            phase: { type: "positional", description: "Phase document ID or slug", required: true },
            id: { type: "positional", description: "Checklist item id (e.g. CHK-1)", required: true },
            statement: { type: "string", description: "What this item asserts", required: true },
            bind: { type: "string", description: "Bind kind: script | manual", required: true },
            oracle: { type: "string", description: "Oracle kind (script bind only)" },
            command: { type: "string", description: "Exact command that will be run (script bind only)" },
            json: { type: "boolean", description: "Output result as JSON" },
          },
          async run(context) {
            const { args } = context;
            const inv = invocationOf(context);
            const { app } = loadLoreApp({ inv });
            try {
              const service = requirePhaseChecklistService(app);
              const bindKind = args.bind as string;
              const bind =
                bindKind === "script"
                  ? { kind: "script", oracle: args.oracle, command: args.command }
                  : { kind: bindKind };
              const result = await service.addChecklistItem(args.phase as string, {
                id: args.id,
                statement: args.statement,
                bind,
              });

              if (!result.ok) {
                process.stderr.write(formatErrorFor(inv, result.error) + "\n");
                setExitCode(exitCode(result.error));
                return;
              }

              if (args.json) {
                console.log(JSON.stringify({ ok: true, data: { checklist: result.value } }, null, 2));
                return;
              }
              console.log(`Added checklist item "${args.id as string}" to phase ${args.phase as string}`);
              renderChecklist(result.value);
            } finally {
              app.close();
            }
          },
        }),

        list: defineCommand({
          meta: { name: "list", description: "List a phase's declared checklist items" },
          args: {
            phase: { type: "positional", description: "Phase document ID or slug", required: true },
            json: { type: "boolean", description: "Output result as JSON" },
          },
          async run(context) {
            const { args } = context;
            const inv = invocationOf(context);
            const { app } = loadLoreApp({ inv });
            try {
              const service = requirePhaseChecklistService(app);
              const result = await service.listChecklist(args.phase as string);

              if (!result.ok) {
                process.stderr.write(formatErrorFor(inv, result.error) + "\n");
                setExitCode(exitCode(result.error));
                return;
              }

              if (args.json) {
                console.log(JSON.stringify({ ok: true, data: { checklist: result.value } }, null, 2));
                return;
              }
              if (result.value.length === 0) {
                console.log("No checklist items declared on this phase.");
                return;
              }
              renderChecklist(result.value);
            } finally {
              app.close();
            }
          },
        }),

        drop: defineCommand({
          meta: { name: "drop", description: "Mark a checklist item as dropped (requires --reason)" },
          args: {
            phase: { type: "positional", description: "Phase document ID or slug", required: true },
            id: { type: "positional", description: "Checklist item id", required: true },
            reason: { type: "string", description: "Why this item is being dropped (required)", required: true },
            json: { type: "boolean", description: "Output result as JSON" },
          },
          async run(context) {
            const { args } = context;
            const inv = invocationOf(context);
            const { app } = loadLoreApp({ inv });
            try {
              const service = requirePhaseChecklistService(app);
              const by = resolveActor(undefined, inv.env, inv.cwd, inv.user);
              const result = await service.dropChecklistItem(args.phase as string, args.id as string, {
                by,
                reason: args.reason as string,
              });

              if (!result.ok) {
                process.stderr.write(formatErrorFor(inv, result.error) + "\n");
                setExitCode(exitCode(result.error));
                return;
              }

              if (args.json) {
                console.log(JSON.stringify({ ok: true, data: { checklist: result.value } }, null, 2));
                return;
              }
              console.log(`Dropped checklist item "${args.id as string}" on phase ${args.phase as string}`);
              renderChecklist(result.value);
            } finally {
              app.close();
            }
          },
        }),

        check: defineCommand({
          meta: { name: "check", description: "Self-attest a manual-bind checklist item as checked" },
          args: {
            phase: { type: "positional", description: "Phase document ID or slug", required: true },
            id: { type: "positional", description: "Checklist item id", required: true },
            json: { type: "boolean", description: "Output result as JSON" },
          },
          async run(context) {
            const { args } = context;
            const inv = invocationOf(context);
            const { app } = loadLoreApp({ inv });
            try {
              const service = requirePhaseChecklistService(app);
              const by = resolveActor(undefined, inv.env, inv.cwd, inv.user);
              const result = await service.checkChecklistItem(args.phase as string, args.id as string, { by });

              if (!result.ok) {
                process.stderr.write(formatErrorFor(inv, result.error) + "\n");
                setExitCode(exitCode(result.error));
                return;
              }

              if (args.json) {
                console.log(JSON.stringify({ ok: true, data: { checklist: result.value } }, null, 2));
                return;
              }
              console.log(`Checked checklist item "${args.id as string}" on phase ${args.phase as string} by ${by}`);
              renderChecklist(result.value);
            } finally {
              app.close();
            }
          },
        }),

        edit: defineCommand({
          meta: { name: "edit", description: "Edit a checklist item's statement (voids any existing self-attestation)" },
          args: {
            phase: { type: "positional", description: "Phase document ID or slug", required: true },
            id: { type: "positional", description: "Checklist item id", required: true },
            statement: { type: "string", description: "New statement text", required: true },
            json: { type: "boolean", description: "Output result as JSON" },
          },
          async run(context) {
            const { args } = context;
            const inv = invocationOf(context);
            const { app } = loadLoreApp({ inv });
            try {
              const service = requirePhaseChecklistService(app);
              const result = await service.editChecklistStatement(
                args.phase as string,
                args.id as string,
                args.statement as string,
              );

              if (!result.ok) {
                process.stderr.write(formatErrorFor(inv, result.error) + "\n");
                setExitCode(exitCode(result.error));
                return;
              }

              if (args.json) {
                console.log(JSON.stringify({ ok: true, data: { checklist: result.value } }, null, 2));
                return;
              }
              console.log(`Edited checklist item "${args.id as string}" statement on phase ${args.phase as string}`);
              renderChecklist(result.value);
            } finally {
              app.close();
            }
          },
        }),
      },
    }),

    track: defineCommand({
      meta: {
        name: "track",
        // reason: Scope-Alt (task-skill-implement-cli-mcp-surfaces-checklist-ref-evidence)
        // — track CLI rendering is deliberately minimal (list only, plain text).
        description: "Manage a phase document's informational work-log entries (add / list)",
      },
      subCommands: {
        add: defineCommand({
          meta: { name: "add", description: "Append a new track note to a phase" },
          args: {
            phase: { type: "positional", description: "Phase document ID or slug", required: true },
            note: { type: "string", description: "Note text", required: true },
            json: { type: "boolean", description: "Output result as JSON" },
          },
          async run(context) {
            const { args } = context;
            const inv = invocationOf(context);
            const { app } = loadLoreApp({ inv });
            try {
              const service = requirePhaseChecklistService(app);
              const by = resolveActor(undefined, inv.env, inv.cwd, inv.user);
              const result = await service.addTrackNote(args.phase as string, {
                id: ulid(),
                note: args.note as string,
                by,
                at: new Date().toISOString(),
              });

              if (!result.ok) {
                process.stderr.write(formatErrorFor(inv, result.error) + "\n");
                setExitCode(exitCode(result.error));
                return;
              }

              if (args.json) {
                console.log(JSON.stringify({ ok: true, data: { track: result.value } }, null, 2));
                return;
              }
              console.log(`Added track note to phase ${args.phase as string}`);
            } finally {
              app.close();
            }
          },
        }),

        // reason: minimal (plain-text, no badges) — Scope-Alt above.
        list: defineCommand({
          meta: { name: "list", description: "List a phase's track notes (minimal rendering)" },
          args: {
            phase: { type: "positional", description: "Phase document ID or slug", required: true },
            json: { type: "boolean", description: "Output result as JSON" },
          },
          async run(context) {
            const { args } = context;
            const inv = invocationOf(context);
            const { app } = loadLoreApp({ inv });
            try {
              const service = requirePhaseChecklistService(app);
              const result = await service.listTrack(args.phase as string);

              if (!result.ok) {
                process.stderr.write(formatErrorFor(inv, result.error) + "\n");
                setExitCode(exitCode(result.error));
                return;
              }

              if (args.json) {
                console.log(JSON.stringify({ ok: true, data: { track: result.value } }, null, 2));
                return;
              }
              if (result.value.length === 0) {
                console.log("No track notes on this phase.");
                return;
              }
              for (const item of result.value) {
                console.log(`  [${item.at}] ${item.by}: ${item.note}`);
              }
            } finally {
              app.close();
            }
          },
        }),
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

/** Render a phase status scorecard to stdout (SPEC-056). */
function renderPhaseStatus(payload: PhaseStatusPayload): void {
  console.log(`Phase: ${payload.phase_title} (${payload.phase_slug})`);
  console.log(`Plan: ${payload.plan_slug}`);
  console.log(`State: ${payload.state}`);
  console.log(`AC scope: ${payload.ac_scope.attested}/${payload.ac_scope.total} attested`);
  console.log(`Checklist: ${payload.checklist.satisfied}/${payload.checklist.total} satisfied`);
  console.log(`Blocking: ${payload.blocking.length > 0 ? payload.blocking.join(", ") : "(none)"}`);
  console.log(
    `Dropped: ${payload.checklist.dropped_named.length > 0 ? payload.checklist.dropped_named.join(", ") : "(none)"}`,
  );
  if (payload.claim !== null) {
    console.log(`Claim: ${payload.claim.by}${payload.claim.stale ? " (stale)" : ""}`);
  } else {
    console.log("Claim: (none)");
  }
}

/**
 * Render a numbered list of checklist items to stdout.
 * Example output:
 *   1. [✔] CHK-1 — manual smoke test passes
 *   2. [ ] CHK-2 — unit suite green (script:test)
 *   3. [dropped] CHK-3 — deprecated check
 */
function renderChecklist(items: ChecklistItem[]): void {
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    let marker: string;
    if (item.dropped !== undefined) {
      marker = "dropped";
    } else if (item.bind.kind === "manual") {
      marker = item.checked !== undefined ? "✔" : " ";
    } else {
      marker = item.result === "pass" ? "✔" : item.result === "fail" ? "✘" : " ";
    }
    const bindNote = item.bind.kind === "script" ? ` (script:${item.bind.oracle})` : "";
    console.log(`  ${i + 1}. [${marker}] ${item.id} — ${item.statement}${bindNote}`);
  }
}
