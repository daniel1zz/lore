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
 * `lore session trail [--turn] [--run] [--json]`   — the caller's own session trail (AC-ST-6).
 *
 * Exit codes: 0 = success; 1 = SessionService not wired; 2 = missing/invalid
 *   `<id>` for `show`, or an unrecognized subcommand (CLI usage error); 3 =
 *   `show <id>` matched no session; other codes per `utils.ts::exitCode` on
 *   a store error.
 *
 * Source: spec-multi-session-concurrency-queryable-ownership-checkout §Scope L0, AC-OWN-5.
 */

import { defineLoreCommand } from "../cli-exit.js";
import type { Invocation } from "@lore/core";
import { invocationOf } from "../command-invocation.js";
import type { SessionLivenessRecord } from "../../../service/session-service.js";
import { resolveClaimSessionId } from "../../../service/task-workflow-service.js";
import {
  parseRunId,
  readSessionTrail,
  sessionOfRun,
  stateBase,
  TrailFileInvalidError,
  TrailRunIdInvalidError,
  type SessionTrail,
} from "@lore/core/node";
import { loadLoreApp } from "../loader.js";
import { formatTrail, narrowTrail } from "../session-trail-render.js";
import { exitCode, formatErrorFor } from "../utils.js";
import { printLine } from "../output.js";
import type { CliIo } from "../output.js";
import type { ExitReport } from "../cli-exit.js";

const RESERVED_SUBCOMMANDS = new Set(["list", "show", "trail"]);

/** The trail-access rule id (AC-ST-6) every refusal of `lore session trail` names. */
const TRAIL_ACCESS_RULE = "BR-1143";

/** Refuses `lore session trail`: exit 4 naming the trail-access rule. */
function refuseTrailAccess(io: CliIo, reason: string): number {
  io.stderr.write(`Error: ${reason} (${TRAIL_ACCESS_RULE}: \`lore session trail\` reads only the calling run's own session trail)\n`);
  return 4;
}

/**
 * The session of the caller's VERIFIED attested run, or the exit code of the refusal it already wrote (4 no run /
 * non-`cc:` run; the identity error's own exit code when verification fails).
 * reason: the run is VERIFIED against the registry (unregistered -> null), so "attested" means attested, not merely claimed.
 */
async function resolveCallerSession(
  inv: Invocation,
  app: Awaited<ReturnType<typeof loadLoreApp>>["app"],
): Promise<{ readonly ok: true; readonly session: string } | { readonly ok: false; readonly code: number }> {
  const verified = await app.verifiedInvocationIdentity?.();
  if (verified !== undefined && !verified.ok) {
    inv.io.stderr.write(formatErrorFor(inv, verified.error) + "\n");
    return { ok: false, code: exitCode(verified.error) };
  }
  const callerRun = verified?.value?.harnessRun ?? null;
  if (callerRun === null) {
    return { ok: false, code: refuseTrailAccess(inv.io, "no attested run: pass --harness-run or call from an attested harness") };
  }
  try {
    return { ok: true, session: sessionOfRun(callerRun) };
  } catch (err) {
    if (err instanceof TrailRunIdInvalidError) {
      return { ok: false, code: refuseTrailAccess(inv.io, `run ${callerRun} is not a claude-code run (cc:<session>[:<agent>])`) };
    }
    throw err;
  }
}

/**
 * `lore session trail [--turn <id>] [--run <id>] [--json]` — the CALLER's own session trail (spec D12:
 * no `--session`; the session is the attested `cc:<session>[:<agent>]` run's session part).
 * Exit 0 ok; 3 unknown `--turn`; 4 no attested run / non-`cc:` run / no trail for the session / bad `--run`.
 */
async function runSessionTrail(
  app: Awaited<ReturnType<typeof loadLoreApp>>["app"],
  args: { turn?: unknown; run?: unknown; json?: unknown },
  inv: Invocation,
): Promise<ExitReport> {
  const refuse = (reason: string): number => refuseTrailAccess(inv.io, reason);
  const caller = await resolveCallerSession(inv, app);
  if (!caller.ok) return caller.code;
  const session = caller.session;
  let runFilter: string | undefined;
  if (typeof args.run === "string") {
    try {
      parseRunId(args.run);
    } catch (err) {
      if (err instanceof TrailRunIdInvalidError) {
        return refuse(`--run ${args.run} is not a claude-code run (cc:<session>[:<agent>])`);
      }
      throw err;
    }
    runFilter = args.run;
  }
  let trail: SessionTrail | null;
  try {
    trail = readSessionTrail(session, stateBase(inv.env, inv.paths.home));
  } catch (err) {
    if (err instanceof TrailFileInvalidError) {
      inv.io.stderr.write(`Error: ${err.message}\n`);
      return 1;
    }
    throw err;
  }
  if (trail === null) {
    return refuse(`no session trail for session ${session} under ${stateBase(inv.env, inv.paths.home)}`);
  }
  const turn = typeof args.turn === "string" ? args.turn : undefined;
  if (turn !== undefined && !trail.turns.some((t) => t.turn === turn)) {
    inv.io.stderr.write(`Error: session ${session} has no turn "${turn}".\n`);
    return 3;
  }
  const view = narrowTrail(trail, { ...(turn !== undefined ? { turn } : {}), ...(runFilter !== undefined ? { run: runFilter } : {}) });
  if (args.json) {
    printLine(inv.io.stdout, JSON.stringify({ ok: true, data: view }, null, 2));
  } else {
    printLine(inv.io.stdout, formatTrail(view));
  }
  return 0;
}

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

export default defineLoreCommand({
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
    turn: {
      type: "string",
      description: "`trail` only: narrow to this turn id",
    },
    run: {
      type: "string",
      description: "`trail` only: narrow to the files this run (cc:<session>[:<agent>]) changed",
    },
  },
  async run(context): Promise<number> {
    const { args } = context;
    const inv = invocationOf(context);
    // reason: a usage error is decided before the corpus is opened, so an unknown verb (e.g. the removed
    // `trail-review`, BR-1349) exits 2 even where no `.lore/` exists.
    if (!RESERVED_SUBCOMMANDS.has(String(args.target))) {
      inv.io.stderr.write(`Error: unknown \`lore session\` subcommand "${String(args.target)}" — expected "list", "show" or "trail".\n`);
      return 2;
    }
    const { app } = loadLoreApp({ inv });
    try {
      if (String(args.target) === "trail") {
        return await runSessionTrail(app, args, inv);
      }
      if (app.sessionService === undefined) {
        inv.io.stderr.write("Error: SessionService not wired on this App instance.\n");
        return 1;
      }
      const sessionService = app.sessionService;

      const target = String(args.target);

      const currentMachine = inv.host;

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
      // `resolveActorWithSource` session tier documents the same imprecision
      // for a DIFFERENT purpose (turn-state.mjs no longer uses a PPID) —
      // this task's scope stops at "measurably better than the CLI's own
      // pid", full orchestrator-pid capture is P2's session-lease mechanism,
      // out of this plan).
      const sessionIdResult = resolveClaimSessionId(inv.env);
      if (sessionIdResult.ok && sessionIdResult.value !== undefined) {
        await sessionService.recordOwnHeartbeat(sessionIdResult.value, process.ppid, currentMachine);
      }

      const activeSessionsResult = await sessionService.getActiveSessions();
      if (!activeSessionsResult.ok) {
        inv.io.stderr.write(formatErrorFor(inv, activeSessionsResult.error) + "\n");
        return exitCode(activeSessionsResult.error);
      }

      const records = await sessionService.deriveSessionLiveness(activeSessionsResult.value, currentMachine);

      if (target === "list") {
        if (args.json) {
          printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { sessions: records } }, null, 2));
        } else {
          printLine(inv.io.stdout, formatSessionList(records));
        }
        return 0;
      }

      // target === "show"
      const id = typeof args.id === "string" ? args.id : undefined;
      if (id === undefined || id.length === 0) {
        inv.io.stderr.write("Error: `lore session show` requires a session id: lore session show <id>\n");
        return 2;
      }
      const match = records.find((r) => r.session_id === id) ?? records.find((r) => r.by === id);
      if (match === undefined) {
        inv.io.stderr.write(`Error: no session matching "${id}" found.\n`);
        return 3;
      }
      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: true, data: match }, null, 2));
      } else {
        printLine(inv.io.stdout, formatSessionRecord(match));
      }
    } finally {
      app.close();
    }
    return 0;
  },
});
