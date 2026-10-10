/**
 * lore worktree sweep [--apply] [--json] — report (and optionally remove) the git worktrees that
 * claims of ARCHIVED/DEPRECATED tasks recorded and that are now safe to remove (issue #106;
 * rules BR-961 / BR-962; spec lore-owns-worktree-cleanup-archive-removes-the-task-s, AC-WTC-2).
 *
 * Thin pipe over `TaskWorkflowService.sweepWorktrees` — the BR-961 predicate lives in
 * `service/worktree-cleanup.ts`, never here. Without `--apply` nothing changes (report only);
 * with `--apply` exactly the `remove` rows are removed (plain `git worktree remove` + `git branch -d`,
 * never forced). A worktree no claim recorded is never listed.
 *
 * Output: `--json` -> `{ ok: true, data: { rows: [{ task, worktree, decision, reason }] } }`
 * (decision: remove | keep | not-measured | gone); text -> one line per row:
 * `<decision> <task> <worktree> (<reason>)`.
 *
 * Quiet window: `LORE_WORKTREE_QUIET_MINUTES` (default 30; malformed -> exit 4).
 *
 * Exit codes: 0 = success (incl. kept / not-measured rows); 1 = an `--apply` removal failed
 *   (its row is `not-measured` with a `remove-failed:` reason); 4 = malformed
 *   `LORE_WORKTREE_QUIET_MINUTES`; other codes per `utils.ts::exitCode`.
 *
 * Source: issue #106; BR-961, BR-962.
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, resolveActor } from "../utils.js";
import type { WorktreeSweepRow } from "../../../service/task-workflow-service.js";

/** One human line per sweep row. */
function formatSweepRow(row: WorktreeSweepRow): string {
  return `${row.decision} ${row.task} ${row.worktree} (${row.reason})`;
}

export default defineCommand({
  meta: {
    name: "worktree",
    description: "Worktree housekeeping for archived tasks (sweep)",
  },
  subCommands: {
    sweep: defineCommand({
      meta: {
        name: "sweep",
        description:
          "List claim-recorded worktrees of archived/deprecated tasks with a remove/keep/not-measured/gone decision; --apply removes the remove rows",
      },
      args: {
        apply: {
          type: "boolean",
          description: "Remove the worktrees decided `remove` (default: report only, nothing changes)",
        },
        by: {
          type: "string",
          description: "Actor identity recorded on the audit row of each removal; defaults to $LORE_ACTOR, then OS username",
        },
        json: {
          type: "boolean",
          description: "Output { ok, data: { rows } } as JSON",
        },
      },
      async run({ args }) {
        const { app } = loadLoreApp();
        try {
          const by = resolveActor(typeof args.by === "string" ? args.by : undefined);
          const result = await app.taskWorkflowService.sweepWorktrees({ apply: args.apply === true, by });
          if (!result.ok) {
            process.stderr.write(formatError(result.error) + "\n");
            process.exitCode = exitCode(result.error);
            return;
          }
          const rows = result.value;
          if (args.json) {
            console.log(JSON.stringify({ ok: true, data: { rows } }, null, 2));
          } else if (rows.length === 0) {
            console.log("no claim-recorded worktrees of archived/deprecated tasks");
          } else {
            for (const row of rows) console.log(formatSweepRow(row));
          }
          if (rows.some((row) => row.reason.startsWith("remove-failed:"))) process.exitCode = 1;
        } finally {
          app.close();
        }
      },
    }),
  },
});
