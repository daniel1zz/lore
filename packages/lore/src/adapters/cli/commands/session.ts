/**
 * lore session list|show <id> [--json] — AC-OWN-5 read surface (spec-multi-
 * session-concurrency-queryable-ownership-checkout §Scope L0): joins corpus
 * claims (`SessionService.getActiveSessions`, the SAME corpus-wide
 * derivation `lore bootstrap`'s `active_sessions` uses) with a probed
 * process-liveness verdict (`SessionService.deriveSessionLiveness`) — pid
 * plus process start time, NEVER claim age.
 *
 * `lore session list [--json]`      — every corpus-wide derived session +
 *                                       liveness verdict.
 * `lore session show <id> [--json]` — one session, matched by `session_id`
 *                                       first, falling back to `by` for a
 *                                       legacy session_id-less group.
 *
 * Self-registration: BEFORE querying, this command calls
 * `SessionService.recordOwnHeartbeat` for the CALLING session's OWN
 * `session_id` (when measurable) — an explicit, separately-named COMMAND
 * call, never hidden inside the query methods (CQS, see that method's own
 * JSDoc). This is what makes cross-process liveness answerable at all
 * without a P2 session-lease write path (out of this plan's scope, per the
 * plan doc's own "Out of scope" section): a session's liveness is only ever
 * measurable by a peer once that session has itself run `lore session
 * list|show` at least once on this machine. A session that never does is
 * honestly reported `"unmeasured"`, never fabricated.
 *
 * Exit codes: 0 = success; 1 = SessionService not wired; 2 = missing/invalid
 *   `<id>` for `show`, or an unrecognized subcommand (CLI usage error); 3 =
 *   `show <id>` matched no session; other codes per `utils.ts::exitCode` on
 *   a store error.
 *
 * Source: spec-multi-session-concurrency-queryable-ownership-checkout §Scope L0, AC-OWN-5.
 */

import { hostname } from "node:os";
import { defineCommand } from "citty";
import type { SessionLivenessRecord } from "../../../service/session-service.js";
import { resolveClaimSessionId } from "../../../service/task-workflow-service.js";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError } from "../utils.js";

const RESERVED_SUBCOMMANDS = new Set(["list", "show"]);

/**
 * The reason clause appended to an `"unmeasured"` liveness verdict at the
 * RENDER surface itself — task-ac-own-5-s-oracle-exercises-only-the-pure-
 * verdict-function: this module's header above already documents the
 * self-registration precondition ("a session's liveness is only ever
 * measurable by a peer once that session has itself run `lore session
 * list|show` at least once on this machine"), but a reader of the COMMAND'S
 * OWN OUTPUT never sees this file's JSDoc. Without this clause, bare
 * `"unmeasured"` is indistinguishable from any other possible reading of
 * that word (e.g. "checked, but the verdict came back ambiguous" — a state
 * this three-valued type does not even have, see `LivenessVerdict`); WITH
 * it, the one true cause ("no heartbeat on file yet") is named at the exact
 * place a human or another agent actually reads the verdict.
 */
const UNMEASURED_LIVENESS_REASON = "no heartbeat on file — this session has never run `lore session list|show` on this machine";

/** Compact human-readable rendering of the full session+liveness list. */
function formatSessionList(records: readonly SessionLivenessRecord[]): string {
  const lines: string[] = [`── lore session list (${records.length}) ──`];
  if (records.length === 0) {
    lines.push("  (none)");
    return lines.join("\n");
  }
  for (const record of records) {
    lines.push(formatSessionLine(record));
  }
  return lines.join("\n");
}

/** Compact human-readable rendering of ONE session+liveness record (`show`). */
function formatSessionRecord(record: SessionLivenessRecord): string {
  return [`── lore session show ──`, formatSessionLine(record)].join("\n");
}

function formatSessionLine(record: SessionLivenessRecord): string {
  const idPart = record.session_id !== undefined ? `session ${record.session_id}` : "session (unmeasured)";
  const worktreePart = record.worktree !== undefined ? `, worktree ${record.worktree}` : "";
  const branchesPart = record.branches.length > 0 ? `, branches [${record.branches.join(", ")}]` : "";
  const stalePart = record.stale === true ? ", stale" : "";
  // reason: "unmeasured" alone is printed EXPLICITLY WITH its cause, never
  // bare — see UNMEASURED_LIVENESS_REASON's own doc for why a bare verdict
  // would be indistinguishable from a reading this three-valued type cannot
  // even produce.
  const livenessPart = record.liveness === "unmeasured" ? `unmeasured (${UNMEASURED_LIVENESS_REASON})` : record.liveness;
  return `  - ${record.by} (${idPart}${worktreePart}${branchesPart}) — liveness: ${livenessPart}${stalePart}`;
}

export default defineCommand({
  meta: {
    name: "session",
    description:
      "Corpus-wide sessions joined with probed process liveness: list / show <id> (SPEC-L0, AC-OWN-5). " +
      "Liveness is measurable ONLY for a session that has itself run this command at least once on this machine — a peer that never has reports 'unmeasured'.",
  },
  args: {
    target: {
      type: "positional",
      description: "'list' or 'show'",
      required: true,
    },
    id: {
      type: "positional",
      description: "session_id (or `by`, for a legacy session_id-less group) — required for `show`",
      required: false,
    },
    json: {
      type: "boolean",
      description: "Output result as JSON",
    },
  },
  async run({ args }) {
    const { app } = loadLoreApp();
    try {
      if (app.sessionService === undefined) {
        process.stderr.write("Error: SessionService not wired on this App instance.\n");
        process.exitCode = 1;
        return;
      }
      const sessionService = app.sessionService;

      const target = String(args.target);
      if (!RESERVED_SUBCOMMANDS.has(target)) {
        process.stderr.write(`Error: unknown \`lore session\` subcommand "${target}" — expected "list" or "show".\n`);
        process.exitCode = 2;
        return;
      }

      const currentMachine = hostname();

      // reason: self-registration (module header) — best-effort, skipped
      // entirely when this caller has no measurable session id (e.g. MCP/HTTP
      // callers with no CLAUDE_CODE_SESSION_ID env var). Records `process.ppid`
      // (the parent that invoked THIS `lore` binary — the orchestrating shell/
      // agent process), NEVER `process.pid` — the `lore` CLI process itself is
      // a short-lived subprocess that exits the instant this command returns,
      // so recording ITS OWN pid would make every session report "dead" on
      // the very next probe, moments after reporting "alive" (measured while
      // building this command). `process.ppid` at least outlives one `lore`
      // invocation; still an approximation of "the orchestrator" (SPEC-042's
      // `resolveActorWithSource` session tier and `turn-state.mjs`'s own PPID
      // resolution document the same imprecision for a DIFFERENT purpose —
      // this task's scope stops at "measurably better than the CLI's own
      // pid", full orchestrator-pid capture is P2's session-lease mechanism,
      // out of this plan).
      const sessionIdResult = resolveClaimSessionId(process.env);
      if (sessionIdResult.ok && sessionIdResult.value !== undefined) {
        await sessionService.recordOwnHeartbeat(sessionIdResult.value, process.ppid, currentMachine);
      }

      const activeSessionsResult = await sessionService.getActiveSessions();
      if (!activeSessionsResult.ok) {
        process.stderr.write(formatError(activeSessionsResult.error) + "\n");
        process.exitCode = exitCode(activeSessionsResult.error);
        return;
      }

      const records = await sessionService.deriveSessionLiveness(activeSessionsResult.value, currentMachine);

      if (target === "list") {
        if (args.json) {
          console.log(JSON.stringify({ ok: true, data: { sessions: records } }, null, 2));
        } else {
          console.log(formatSessionList(records));
        }
        return;
      }

      // target === "show"
      const id = typeof args.id === "string" ? args.id : undefined;
      if (id === undefined || id.length === 0) {
        process.stderr.write("Error: `lore session show` requires a session id: lore session show <id>\n");
        process.exitCode = 2;
        return;
      }
      const match = records.find((r) => r.session_id === id) ?? records.find((r) => r.by === id);
      if (match === undefined) {
        process.stderr.write(`Error: no session matching "${id}" found.\n`);
        process.exitCode = 3;
        return;
      }
      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: match }, null, 2));
      } else {
        console.log(formatSessionRecord(match));
      }
    } finally {
      app.close();
    }
  },
});
