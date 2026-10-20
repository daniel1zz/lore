/**
 * lore session start --human <name> | end | show — the human session (spec-every-write-is-made-by-a-known-party-an-attested-agent-run,
 * BR-1350): `start` registers a run with harness `human` for this checkout (a token file in the user's lore state
 * directory; only the token's hash enters the registry), `end` closes it, `show` (no id) names the open one. A write
 * from this checkout with no harness run is recorded as that person, unless the process carries an agent harness marker.
 *
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
import { hasAgentHarnessMarker, type Invocation } from "@lore/core";
import {
  bindingOfHumanSessionFile,
  deleteHumanSessionFile,
  hashSessionToken,
  HumanSessionFileError,
  newSessionToken,
  readHumanSessionFile,
  writeHumanSessionFile,
  type HumanSessionFile,
} from "../human-session-file.js";
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

const RESERVED_SUBCOMMANDS = new Set(["list", "show", "trail", "start", "end"]);

/** A person's name as typed: 1-64 printable characters (it appears verbatim in audit rows and claims). */
const HUMAN_NAME_PATTERN = /^[^\u0000-\u001f\u007f]{1,64}$/;

/** Refuses a human-session verb with the exit-4 validation family code. */
function refuseHumanSession(io: CliIo, reason: string): number {
  io.stderr.write(`Error: ${reason}\n`);
  return 4;
}

/** The open human session file of this invocation's checkout, or the exit code of the refusal it already wrote. */
function readOwnHumanSession(inv: Invocation): { readonly ok: true; readonly file: HumanSessionFile | null; readonly checkout: string } | { readonly ok: false; readonly code: number } {
  const checkout = inv.paths.projectRoot;
  if (checkout === null) return { ok: false, code: refuseHumanSession(inv.io, "no lore corpus found from this directory, so there is no checkout to bind a human session to") };
  try {
    return { ok: true, file: readHumanSessionFile(inv.env, inv.paths.home, checkout), checkout };
  } catch (error) {
    if (error instanceof HumanSessionFileError) return { ok: false, code: refuseHumanSession(inv.io, error.message) };
    throw error;
  }
}

/**
 * `lore session start --human <name>` (BR-1350): registers a run with harness `human` for this checkout and binds it
 * with a token file in the user's lore state directory (only the token's hash enters the registry). A second start
 * while one is open is refused naming the open one; a process inside an agent harness never starts one.
 * Exit 0 started; 2 missing `--human`; 4 refused (agent harness, bad name, no checkout, already open, unusable file).
 */
async function runSessionStart(
  app: Awaited<ReturnType<typeof loadLoreApp>>["app"],
  args: { human?: unknown; json?: unknown },
  inv: Invocation,
): Promise<ExitReport> {
  if (hasAgentHarnessMarker(inv.env)) {
    return refuseHumanSession(inv.io, "a human session is for a person; this process runs inside an agent harness, whose writes carry an attested run (install the integration with `lore setup`)");
  }
  const name = typeof args.human === "string" ? args.human.trim() : "";
  if (name === "") {
    inv.io.stderr.write("Error: `lore session start` requires --human <name>: lore session start --human <name>\n");
    return 2;
  }
  if (!HUMAN_NAME_PATTERN.test(name)) return refuseHumanSession(inv.io, `--human ${JSON.stringify(name)}: expected 1-64 printable characters`);
  const open = readOwnHumanSession(inv);
  if (!open.ok) return open.code;
  if (open.file !== null) {
    const run = bindingOfHumanSessionFile(open.file).run;
    return refuseHumanSession(inv.io, `a human session is already open in this checkout: ${open.file.name} (run ${run}); \`lore session end\` closes it`);
  }
  if (app.runService === undefined) {
    inv.io.stderr.write("Error: RunService not wired on this App instance.\n");
    return 1;
  }
  const token = newSessionToken();
  const registered = await app.runService.registerParty({ harness: "human", name, tokenHash: hashSessionToken(token) });
  if (!registered.ok) {
    inv.io.stderr.write(formatErrorFor(inv, registered.error) + "\n");
    return exitCode(registered.error);
  }
  try {
    writeHumanSessionFile(inv.env, inv.paths.home, { version: 1, checkout: open.checkout, name, token, started_at: new Date().toISOString() });
  } catch (error) {
    if (error instanceof HumanSessionFileError) return refuseHumanSession(inv.io, error.message);
    throw error;
  }
  if (args.json) {
    printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { name, run: registered.value.id, checkout: open.checkout } }, null, 2));
  } else {
    printLine(inv.io.stdout, `Started human session ${name} (run ${registered.value.id}). Writes from this checkout are recorded as ${name} until \`lore session end\`.`);
  }
  return 0;
}

/**
 * `lore session end`: ends the open human session's run (releasing its claims, BR-1057) and deletes its token file.
 * Exit 0 ended; 3 no open session; 4 unusable file.
 */
async function runSessionEnd(app: Awaited<ReturnType<typeof loadLoreApp>>["app"], inv: Invocation): Promise<ExitReport> {
  const open = readOwnHumanSession(inv);
  if (!open.ok) return open.code;
  if (open.file === null) {
    inv.io.stderr.write("Error: no open human session in this checkout.\n");
    return 3;
  }
  if (app.runService === undefined) {
    inv.io.stderr.write("Error: RunService not wired on this App instance.\n");
    return 1;
  }
  const run = bindingOfHumanSessionFile(open.file).run;
  // reason: the run ends BEFORE the file is deleted, so a failed end leaves the session open and retryable.
  const ended = await app.runService.end(run, "human session ended (lore session end)");
  if (!ended.ok) {
    inv.io.stderr.write(formatErrorFor(inv, ended.error) + "\n");
    return exitCode(ended.error);
  }
  deleteHumanSessionFile(inv.env, inv.paths.home, open.checkout);
  printLine(inv.io.stdout, `Ended human session ${open.file.name} (run ${run}).`);
  return 0;
}

/**
 * `lore session show` with no id: names the open human session of this checkout (the person writes are recorded as).
 * Exit 0 shown; 3 no open session; 4 unusable file.
 */
function runSessionShowHuman(args: { json?: unknown }, inv: Invocation): ExitReport {
  const open = readOwnHumanSession(inv);
  if (!open.ok) return open.code;
  if (open.file === null) {
    inv.io.stderr.write("Error: no open human session in this checkout (`lore session start --human <name>` opens one).\n");
    return 3;
  }
  const run = bindingOfHumanSessionFile(open.file).run;
  if (args.json) {
    printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { name: open.file.name, run, started_at: open.file.started_at, checkout: open.checkout } }, null, 2));
  } else {
    printLine(inv.io.stdout, `Human session: ${open.file.name} (run ${run}, started ${open.file.started_at}, checkout ${open.checkout})`);
  }
  return 0;
}

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
    human: {
      type: "string",
      description: "`start` only: the name you write under in this checkout until `lore session end` (BR-1350)",
    },
  },
  async run(context): Promise<number> {
    const { args } = context;
    const inv = invocationOf(context);
    // reason: a usage error is decided before the corpus is opened, so an unknown verb (e.g. the removed
    // `trail-review`, BR-1349) exits 2 even where no `.lore/` exists.
    if (!RESERVED_SUBCOMMANDS.has(String(args.target))) {
      inv.io.stderr.write(`Error: unknown \`lore session\` subcommand "${String(args.target)}" — expected "start", "end", "list", "show" or "trail".\n`);
      return 2;
    }
    const { app } = loadLoreApp({ inv });
    try {
      if (String(args.target) === "trail") {
        return await runSessionTrail(app, args, inv);
      }
      if (String(args.target) === "start") return await runSessionStart(app, args, inv);
      if (String(args.target) === "end") return await runSessionEnd(app, inv);
      // reason: `show` with no id names the open HUMAN session (BR-1350); with an id it keeps its older meaning, one
      // derived claim session of the corpus (AC-OWN-5).
      if (String(args.target) === "show" && (typeof args.id !== "string" || args.id.length === 0)) {
        return runSessionShowHuman(args, inv);
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
      // reason: an absent id was answered above (`runSessionShowHuman`), so `args.id` is a non-empty string here.
      const id = args.id as string;
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
