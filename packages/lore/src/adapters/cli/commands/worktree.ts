/**
 * lore worktree check <path> [--session <id>] [--json]
 * lore worktree sweep [--apply] [--session <id>] [--json]
 *
 * "May this worktree be removed now" asked of lore's ONE test (spec-one-worktree-removal-test-for-the-guard-lore-done-
 * and-a, D1-D5; BR-1070, BR-1079). Thin pipe over `WorktreeRemovalService` — the clauses live in
 * `service/worktree-removal-test.ts`, never here; the process scan lives in `adapters/real-process-scan-port.ts`.
 *
 * `check` prints a verdict: `removable` | `keep` | `not-measured` (exit 0 for every verdict), with a reason token per failing
 * clause. `sweep` checks every linked worktree of the repository the cwd belongs to; without `--apply` nothing
 * changes; with `--apply` exactly the removable ones are removed (plain `git worktree remove` + `git branch -d`, never forced).
 * A worktree kept ONLY because its owning run has no end (no open task claim names it) carries a `lore run end` hint.
 *
 * The caller's session: `--session <id>` else `CLAUDE_CODE_SESSION_ID` / `CLAUDE_SESSION_ID`; unknown never owns anything.
 * No elapsed time is consulted anywhere (D5).
 *
 * Output: `--json` -> `{ ok: true, data: <check> }` / `{ ok: true, data: { worktrees: [<check> + { removed?, hint?, error? }] } }`.
 * Exit codes: 0 = any verdict; 1 = an `--apply` removal failed; 2 = usage; other codes per `utils.ts::exitCode`.
 */

import { defineLoreCommand, exitCli } from "../cli-exit.js";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor } from "../utils.js";
import { resolveCallerSession } from "../caller-session.js";
import type { WorktreeCheck, WorktreeSweepEntry } from "../../../service/worktree-removal-service.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";
import type { CliIo } from "../output.js";

/** Human rendering of one check. */
function formatCheckLines(check: WorktreeCheck): string[] {
  const lines = [`${check.verdict} ${check.path}${check.reasons.length > 0 ? ` (${check.reasons.join(", ")})` : ""}`];
  if (check.owner !== null) {
    lines.push(
      `  owner: run ${check.owner.run_id} (session ${check.owner.session}, ${check.owner.mine ? "mine" : "not mine"}, session ${
        check.owner.session_ended === null ? "not measured" : check.owner.session_ended ? "ended" : "live"
      })`,
    );
  }
  for (const proc of check.processes) lines.push(`  process ${proc.pid} (${proc.command}) has its cwd inside`);
  return lines;
}

function usageError(io: CliIo, message: string): never {
  io.stderr.write(`Error: ${message}\n`);
  exitCli(2);
}

const sessionArg = {
  type: "string",
  description: "The caller's harness session id (default: CLAUDE_CODE_SESSION_ID / CLAUDE_SESSION_ID); unknown never owns a worktree",
} as const;

export default defineLoreCommand({
  meta: {
    name: "worktree",
    description: "May a worktree be removed now? check one, sweep all (one test for the hook, lore done and the sweep)",
  },
  subCommands: {
    check: defineLoreCommand({
      meta: {
        name: "check",
        description: "Verdict for one worktree: removable | keep | not-measured, with a reason per failing clause",
      },
      args: {
        path: { type: "positional", required: false, description: "Worktree directory" },
        session: sessionArg,
        json: { type: "boolean", description: "Output { ok, data } as JSON" },
      },
      async run(context): Promise<number> {
        const { args } = context;
        const inv = invocationOf(context);
        const path = typeof args.path === "string" ? args.path : "";
        if (path === "") return usageError(inv.io, "lore worktree check requires a <path>");
        const callerSession = resolveCallerSession(typeof args.session === "string" ? args.session : undefined, inv.env) ?? null;
        const { app } = loadLoreApp({ inv });
        try {
          const service = app.worktreeRemovalService;
          if (service === undefined) {
            inv.io.stderr.write("Error: this App was built without a worktree-removal service\n");
            return 1;
          }
          const check = await service.check(path, callerSession);
          if (args.json) printLine(inv.io.stdout, JSON.stringify({ ok: true, data: check }, null, 2));
          else for (const line of formatCheckLines(check)) printLine(inv.io.stdout, line);
        } finally {
          app.close();
        }
        return 0;
      },
    }),
    sweep: defineLoreCommand({
      meta: {
        name: "sweep",
        description: "Check every linked worktree of this repository; --apply removes exactly the removable ones (never forced)",
      },
      args: {
        apply: { type: "boolean", description: "Remove the removable worktrees (default: report only, nothing changes)" },
        session: sessionArg,
        json: { type: "boolean", description: "Output { ok, data: { worktrees } } as JSON" },
      },
      async run(context): Promise<number> {
        const { args } = context;
        const inv = invocationOf(context);
        const callerSession = resolveCallerSession(typeof args.session === "string" ? args.session : undefined, inv.env) ?? null;
        const { app } = loadLoreApp({ inv });
        try {
          const service = app.worktreeRemovalService;
          if (service === undefined) {
            inv.io.stderr.write("Error: this App was built without a worktree-removal service\n");
            return 1;
          }
          const result = await service.sweep({ apply: args.apply === true, callerSession, cwd: inv.cwd });
          if (!result.ok) {
            inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
            return exitCode(result.error);
          }
          const rows: WorktreeSweepEntry[] = result.value;
          if (args.json) {
            printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { worktrees: rows } }, null, 2));
          } else if (rows.length === 0) {
            printLine(inv.io.stdout, "no linked worktrees");
          } else {
            for (const row of rows) {
              const [first, ...rest] = formatCheckLines(row);
              printLine(inv.io.stdout, row.removed === true ? (first ?? "").replace(/^removable /, "removed ") : first);
              for (const line of rest) printLine(inv.io.stdout, line);
              if (row.hint !== undefined) printLine(inv.io.stdout, `  hint: ${row.hint}`);
              if (row.error !== undefined) printLine(inv.io.stdout, `  error: ${row.error}`);
            }
          }
          if (rows.some((row) => row.removed === false)) return 1;
        } finally {
          app.close();
        }
        return 0;
      },
    }),
  },
});
