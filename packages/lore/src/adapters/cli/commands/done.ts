/**
 * lore done <task> [--by <name>] — evidence-validated, atomic-from-the-caller's-
 * perspective lifecycle walk to `"archived"` for a task OR phase document
 * (spec-workflow-hardening-evidence-red-vocabulary-claim-worktree §M3, AC-WH-3).
 *
 * Closes the gap the EXECUTE loop (claim → evidence → release) leaves: a released
 * task stays `draft` forever, which readiness's `blocks`-link computation never
 * treats as "met" (only `archived`/`deprecated` are terminal) — sessions were forced
 * into hand-rolled `lore set --status` choreography (three writes) to unblock a
 * dependent task. `lore done` is the ONE command replacing that choreography.
 *
 * Refuses (VALIDATION_ERROR, exit 4) when the target holds no `result: "pass"`
 * evidence entry (`"expected-fail"`/`"fail"`/`"inconclusive"` never count — see
 * `TaskWorkflowService.done`'s own JSDoc) OR a FRESH claim is held by a DIFFERENT
 * actor than `--by`. An already-terminal target is an idempotent NO-OP (exit 0,
 * unchanged doc) — a second `lore done` after a first succeeded never fails.
 *
 * Target-type dispatch (mirrors `commands/release.ts`/`commands/evidence.ts`'s SPEC-056
 * pattern exactly): `TaskWorkflowService.done` is ALWAYS tried FIRST, UNCHANGED — a
 * successful call, a DOC_NOT_FOUND, or any other error stays byte-identical. ONLY when
 * that call fails with its own `VALIDATION_ERROR {field: "type", value: "phase"}` does
 * this adapter retry via `PhaseWorkflowService.done`.
 *
 * Actor resolution (--by flag > $LORE_ACTOR env var > OS username) — see
 * utils.ts::resolveActor.
 *
 * Exit codes: 0 = success (incl. idempotent no-op), 3 = DOC_NOT_FOUND, 4 =
 *   VALIDATION_ERROR (not a task/phase / no passing evidence / fresh foreign claim /
 *   illegal lifecycle step), 5 = STALE_VERSION.
 *
 * Source: spec-workflow-hardening-evidence-red-vocabulary-claim-worktree §M3, AC-WH-3
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, resolveActor } from "../utils.js";
import { requirePhaseWorkflowService } from "../phase-wiring.js";
import { formatDoneMessage, formatLastTaskAdvisory } from "../done-render.js";

export default defineCommand({
  meta: {
    name: "done",
    description:
      "Evidence-validated lifecycle walk to archived — validates passing evidence + no fresh foreign claim",
  },
  args: {
    task: {
      type: "positional",
      description: "Task (or phase) document ID or slug",
      required: true,
    },
    by: {
      type: "string",
      description: "Actor identity; defaults to $LORE_ACTOR env var, then OS username",
    },
    json: {
      type: "boolean",
      description: "Output result as JSON",
    },
  },
  async run({ args }) {
    const { app } = loadLoreApp();
    try {
      const by = resolveActor(typeof args.by === "string" ? args.by : undefined);
      const doneOpts = { by, source: app.callerSurface };

      // reason: SPEC-056-style target-type dispatch (see module header) — try
      // taskWorkflowService FIRST, UNCHANGED; retry via phaseWorkflowService ONLY on
      // its own {field: "type", value: "phase"} rejection.
      let result = await app.taskWorkflowService.done(args.task as string, doneOpts);
      if (
        !result.ok &&
        result.error.code === "VALIDATION_ERROR" &&
        result.error.field === "type" &&
        result.error.value === "phase"
      ) {
        result = await requirePhaseWorkflowService(app).done(args.task as string, doneOpts);
      }

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }

      // reason: DD-2 last-task advisory (spec-plan-closure-must-be-loud-terminality-
      // divergence-silent, AC-CLOSURE-3) — stderr-only side channel, printed in BOTH
      // --json and human-readable modes, never altering stdout's normal success
      // output. No once-per-process guard (unlike resolveActorWithIdentitySource's
      // precedent) — this fires at most once per plan, ever.
      const lastTaskAdvisory = formatLastTaskAdvisory(result.value);
      if (lastTaskAdvisory !== undefined) {
        process.stderr.write(lastTaskAdvisory + "\n");
      }

      if (args.json) {
        console.log(
          JSON.stringify(
            {
              ok: true,
              data: {
                doc: result.value.task,
                already_done: result.value.already_done,
                transitions: result.value.transitions,
              },
            },
            null,
            2,
          ),
        );
        return;
      }

      console.log(formatDoneMessage(result.value));
    } finally {
      app.close();
    }
  },
});
