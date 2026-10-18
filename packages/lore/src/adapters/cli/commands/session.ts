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
 * `lore session trail-review [--turn] [--json]`    — judge the caller's session's unjudged helper ends (AC-ST-8).
 *
 * Exit codes: 0 = success; 1 = SessionService not wired; 2 = missing/invalid
 *   `<id>` for `show`, or an unrecognized subcommand (CLI usage error); 3 =
 *   `show <id>` matched no session; other codes per `utils.ts::exitCode` on
 *   a store error.
 *
 * Source: spec-multi-session-concurrency-queryable-ownership-checkout §Scope L0, AC-OWN-5.
 */

import { readFileSync, realpathSync } from "node:fs";
import { dirname } from "node:path";
import { defineCommand } from "citty";
import type { Invocation } from "@lore/core";
import { invocationOf } from "../command-invocation.js";
import { loadCoChangeRules, reviewCoChange, type CoChangeFinding, type CoChangeGroup, type GlobMatchFn } from "../../../service/co-change-review.js";
import { reviewHelperScope } from "../../../service/helper-scope-review.js";
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
import { findLoreDbPathQuiet } from "../corpus-resolution.js";
import { loadLoreApp } from "../loader.js";
import { formatTrail, narrowTrail } from "../session-trail-render.js";
import { exitCode, formatError, formatErrorFor } from "../utils.js";

const RESERVED_SUBCOMMANDS = new Set(["list", "show", "trail", "trail-review"]);

/** The trail-access rule id (AC-ST-6) every refusal of `lore session trail` names. */
const TRAIL_ACCESS_RULE = "BR-1143";

/** The `trail-review` payload as `emit` receives it (text rendering only; `--json` prints it as is). */
interface TrailReviewView {
  readonly helpers: readonly { readonly agent_id: string; readonly end_count: number }[];
  readonly findings: readonly { readonly message: string }[];
  readonly not_measured: readonly string[];
  readonly reason?: string;
}

/** `Bun.Glob` matcher, one compiled glob per pattern (the CLI runs under bun; no second glob grammar). */
function createGlobMatcher(): GlobMatchFn {
  const compiled = new Map<string, Bun.Glob>();
  return (pattern, path) => {
    let glob = compiled.get(pattern);
    if (glob === undefined) {
      glob = new Bun.Glob(pattern);
      compiled.set(pattern, glob);
    }
    return glob.match(path);
  };
}

/** File text, or null when the file does not exist; any other fault throws (loadCoChangeRules reports it). */
function readFileOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function formatTrailReview(view: TrailReviewView): string {
  const lines = [`── lore session trail-review (${view.helpers.length} helper end${view.helpers.length === 1 ? "" : "s"} judged) ──`];
  if (view.reason !== undefined) lines.push(`  nothing to judge: ${view.reason}`);
  lines.push(...(view.findings.length === 0 ? ["  no finding"] : view.findings.map((f) => `  - ${f.message}`)));
  lines.push(...view.not_measured.map((reason) => `  not measured: ${reason}`));
  return lines.join("\n");
}

/** Refuses a trail verb (`trail` | `trail-review`): exit 4 naming the trail-access rule. */
function refuseTrailAccess(verb: "trail" | "trail-review", reason: string): void {
  process.stderr.write(`Error: ${reason} (${TRAIL_ACCESS_RULE}: \`lore session ${verb}\` reads only the calling run's own session trail)\n`);
  process.exitCode = 4;
}

/**
 * The session of the caller's VERIFIED attested run, or null after writing the refusal (exit 4 no run / non-`cc:` run;
 * the identity error's own exit code when verification fails).
 * reason: the run is VERIFIED against the registry (unregistered -> null), so "attested" means attested, not merely claimed.
 */
async function resolveCallerSession(inv: Invocation, app: Awaited<ReturnType<typeof loadLoreApp>>["app"], verb: "trail" | "trail-review"): Promise<string | null> {
  const verified = await app.verifiedInvocationIdentity?.();
  if (verified !== undefined && !verified.ok) {
    process.stderr.write(formatErrorFor(inv, verified.error) + "\n");
    process.exitCode = exitCode(verified.error);
    return null;
  }
  const callerRun = verified?.value?.harnessRun ?? null;
  if (callerRun === null) {
    refuseTrailAccess(verb, "no attested run: pass --harness-run or call from an attested harness");
    return null;
  }
  try {
    return sessionOfRun(callerRun);
  } catch (err) {
    if (err instanceof TrailRunIdInvalidError) {
      refuseTrailAccess(verb, `run ${callerRun} is not a claude-code run (cc:<session>[:<agent>])`);
      return null;
    }
    throw err;
  }
}

/** What the co-change judgment adds to the `trail-review` payload. */
interface CoChangeJudgment {
  readonly view: { readonly measured: true; readonly findings: readonly CoChangeFinding[] } | { readonly measured: false; readonly reason: string };
  readonly findings: readonly CoChangeFinding[];
  readonly notMeasured: readonly string[];
}

/**
 * Judges the co-change rules: the main run (from the narrowed turns' `changes.json`), every helper end this review
 * judged, and the turn's unknown-source changes as ONE group. Invalid settings never throw and never stop the other
 * judgments of this run: they come back as `{measured:false, reason}` plus a `not_measured` line (the hook prints it).
 */
function judgeCoChange(input: {
  readonly trail: SessionTrail;
  readonly turn: string | undefined;
  readonly session: string;
  readonly projectRoot: string;
  readonly helperReview: { readonly helpers: readonly { readonly run: string; readonly files: readonly string[] }[] };
}): CoChangeJudgment {
  const rules = loadCoChangeRules(input.projectRoot, readFileOrNull);
  if (!rules.measured) return { view: { measured: false, reason: rules.reason }, findings: [], notMeasured: [`co_change not measured: ${rules.reason}`] };
  const notMeasured: string[] = [];
  const mainRun = `cc:${input.session}`;
  const mainFiles = new Set<string>();
  const unknownFiles = new Set<string>();
  for (const turn of input.trail.turns.filter((t) => input.turn === undefined || t.turn === input.turn)) {
    if (!turn.changes.measured) {
      if (rules.rules.length > 0) notMeasured.push(`co_change: turn ${turn.turn} changes not measured (${turn.changes.reason}); main run and unknown-source group not judged for it`);
      continue;
    }
    for (const change of turn.changes.value) {
      if (change.source.kind === "run" && change.source.run === mainRun) mainFiles.add(change.path);
      else if (change.source.kind === "unknown") unknownFiles.add(change.path);
    }
  }
  const groups: CoChangeGroup[] = [
    { subject: { kind: "run", run: mainRun }, files: [...mainFiles].sort() },
    ...input.helperReview.helpers.map((h): CoChangeGroup => ({ subject: { kind: "run", run: h.run }, files: h.files })),
    { subject: { kind: "unknown" }, files: [...unknownFiles].sort() },
  ];
  const findings = reviewCoChange(rules.rules, groups, createGlobMatcher());
  return { view: { measured: true, findings }, findings, notMeasured };
}

/**
 * `lore session trail-review [--turn <id>] [--json]` — judges the caller's session's helper ends not yet judged
 * (`end_count > judged_end_count`) against the tasks each helper claimed (spec session-trail, Helper scope; AC-ST-8).
 * It NEVER marks a helper judged: that single write belongs to the turn-end hook, after this verb succeeded.
 * Output `{ok, data: {turn?, helpers, findings, not_measured, co_change}}` (`co_change` = `{measured:true, findings}` or `{measured:false, reason}`; its findings are also in `findings`). Exit 0 ok (also with no `.lore/` directory: nothing to
 * judge against, checked BEFORE the corpus is opened); 3 unknown `--turn`; 4 no attested run / no trail; otherwise the
 * service error's code (the hook turns any non-zero exit into a not-measured line).
 */
async function runSessionTrailReview(args: { turn?: unknown; json?: unknown }, inv: Invocation): Promise<void> {
  const emit = (data: Record<string, unknown>): void => {
    if (args.json) console.log(JSON.stringify({ ok: true, data }, null, 2));
    else console.log(formatTrailReview(data as unknown as TrailReviewView));
  };
  const dbPath = findLoreDbPathQuiet(inv);
  if (dbPath === undefined) {
    emit({ helpers: [], findings: [], not_measured: [], reason: "no .lore directory" });
    return;
  }
  const { app } = loadLoreApp({ inv });
  try {
    const session = await resolveCallerSession(inv, app, "trail-review");
    if (session === null) return;
    let trail: SessionTrail | null;
    try {
      trail = readSessionTrail(session, stateBase(inv.env, inv.paths.home));
    } catch (err) {
      if (err instanceof TrailFileInvalidError) {
        process.stderr.write(`Error: ${err.message}\n`);
        process.exitCode = 1;
        return;
      }
      throw err;
    }
    if (trail === null) {
      refuseTrailAccess("trail-review", `no session trail for session ${session} under ${stateBase(inv.env, inv.paths.home)}`);
      return;
    }
    const turn = typeof args.turn === "string" ? args.turn : undefined;
    if (turn !== undefined && !trail.turns.some((t) => t.turn === turn)) {
      process.stderr.write(`Error: session ${session} has no turn "${turn}".\n`);
      process.exitCode = 3;
      return;
    }
    const runService = app.runService;
    if (runService === undefined) {
      process.stderr.write("Error: RunService not wired on this App instance.\n");
      process.exitCode = 1;
      return;
    }
    const review = await reviewHelperScope({
      trail,
      claimedTasks: (run) => runService.claimedTasks(run),
      projectRoot: dirname(dirname(dbPath)),
      realpath: realpathSync,
    });
    if (!review.ok) {
      process.stderr.write(formatErrorFor(inv, review.error) + "\n");
      process.exitCode = exitCode(review.error);
      return;
    }
    const coChange = judgeCoChange({ trail, turn, session, projectRoot: dirname(dirname(dbPath)), helperReview: review.value });
    emit({
      ...(turn !== undefined ? { turn } : {}),
      ...review.value,
      findings: [...review.value.findings, ...coChange.findings],
      not_measured: [...review.value.not_measured, ...coChange.notMeasured],
      co_change: coChange.view,
    });
  } finally {
    app.close();
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
): Promise<void> {
  const refuse = (reason: string): void => refuseTrailAccess("trail", reason);
  const session = await resolveCallerSession(inv, app, "trail");
  if (session === null) return;
  let runFilter: string | undefined;
  if (typeof args.run === "string") {
    try {
      parseRunId(args.run);
    } catch (err) {
      if (err instanceof TrailRunIdInvalidError) {
        refuse(`--run ${args.run} is not a claude-code run (cc:<session>[:<agent>])`);
        return;
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
      process.stderr.write(`Error: ${err.message}\n`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
  if (trail === null) {
    refuse(`no session trail for session ${session} under ${stateBase(inv.env, inv.paths.home)}`);
    return;
  }
  const turn = typeof args.turn === "string" ? args.turn : undefined;
  if (turn !== undefined && !trail.turns.some((t) => t.turn === turn)) {
    process.stderr.write(`Error: session ${session} has no turn "${turn}".\n`);
    process.exitCode = 3;
    return;
  }
  const view = narrowTrail(trail, { ...(turn !== undefined ? { turn } : {}), ...(runFilter !== undefined ? { run: runFilter } : {}) });
  if (args.json) {
    console.log(JSON.stringify({ ok: true, data: view }, null, 2));
  } else {
    console.log(formatTrail(view));
  }
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
    turn: {
      type: "string",
      description: "`trail` | `trail-review`: narrow to / name this turn id",
    },
    run: {
      type: "string",
      description: "`trail` only: narrow to the files this run (cc:<session>[:<agent>]) changed",
    },
  },
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    // reason: trail-review decides whether a corpus exists itself (no `.lore/` is a clean "nothing to judge", not the
    // loader's exit 1), so it must run before `loadLoreApp`.
    if (String(args.target) === "trail-review") {
      await runSessionTrailReview(args, inv);
      return;
    }
    const { app } = loadLoreApp({ inv });
    try {
      if (String(args.target) === "trail") {
        await runSessionTrail(app, args, inv);
        return;
      }
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
        process.stderr.write(formatErrorFor(inv, activeSessionsResult.error) + "\n");
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
