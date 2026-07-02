/**
 * lore claim <task> [--by <name>] [--branch <branch>] [--steal] — acquire an
 * advisory execution lease on a task.
 *
 * Actor resolution (--by flag > $LORE_ACTOR env var > OS username) — see
 * utils.ts::resolveActor.
 *
 * Semantics (SPEC-025 §8.3):
 *   - No existing claim → acquired.
 *   - Existing claim held by the same actor → refreshed.
 *   - Existing claim is stale (age > workflow.claim_ttl_minutes, default 120) →
 *     claimable without --steal.
 *   - Existing claim is fresh and held by someone else → exit 5 (CLAIM_CONFLICT)
 *     unless --steal is passed.
 *
 * Exit codes: 0 = success, 3 = DOC_NOT_FOUND, 4 = VALIDATION_ERROR (not a task),
 *   5 = CLAIM_CONFLICT | STALE_VERSION.
 *
 * Source: SPEC-025 §4 AC-WF-3, AC-WF-4, AC-WF-5
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, resolveActor } from "../utils.js";

export default defineCommand({
  meta: {
    name: "claim",
    description: "Acquire an advisory execution lease on a task",
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
    branch: {
      type: "string",
      description: "Git branch where the work is happening (optional)",
    },
    steal: {
      type: "boolean",
      description: "Override even a fresh claim held by someone else",
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
      const result = await app.taskWorkflowService.claim(args.task as string, {
        by,
        ...(typeof args.branch === "string" ? { branch: args.branch } : {}),
        steal: args.steal === true,
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

      console.log(`Claimed ${result.value.slug} by ${by} (v${result.value.version})`);
    } finally {
      app.close();
    }
  },
});
