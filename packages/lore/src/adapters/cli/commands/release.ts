/**
 * lore release <task> [--by <name>] [--reason <text>] [--force] — clear the
 * advisory execution lease on a task.
 *
 * Actor resolution (--by flag > $LORE_ACTOR env var > OS username) — see
 * utils.ts::resolveActor.
 *
 * Release by the current holder always succeeds. Release by a non-holder
 * requires --force. `--reason` (e.g. a failure summary) lands in the version
 * history entry — visible via `lore log <task>`.
 *
 * Exit codes: 0 = success, 3 = DOC_NOT_FOUND, 4 = VALIDATION_ERROR (not a task /
 *   no active claim), 5 = CLAIM_CONFLICT | STALE_VERSION.
 *
 * Source: SPEC-025 §4 AC-WF-6
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, resolveActor } from "../utils.js";

export default defineCommand({
  meta: {
    name: "release",
    description: "Clear the advisory execution lease on a task",
  },
  args: {
    task: {
      type: "positional",
      description: "Task document ID or slug",
      required: true,
    },
    by: {
      type: "string",
      description: "Actor identity; defaults to $LORE_ACTOR env var, then OS username",
    },
    reason: {
      type: "string",
      description: "Free-text reason (e.g. failure summary), recorded in version history",
    },
    force: {
      type: "boolean",
      description: "Release even when --by is not the current holder",
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
      const result = await app.taskWorkflowService.release(args.task as string, {
        by,
        ...(typeof args.reason === "string" ? { reason: args.reason } : {}),
        force: args.force === true,
        source: app.callerSurface,
      });

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }

      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: { doc: result.value } }, null, 2));
        return;
      }

      console.log(`Released ${result.value.slug} by ${by} (v${result.value.version})`);
    } finally {
      app.close();
    }
  },
});
