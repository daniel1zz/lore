/**
 * Per-invocation identity resolution (spec-every-write-is-made-by-a-known-party-an-attested-agent-run end state 1-3;
 * BR-1055, BR-1032, BR-1350, BR-1351).
 *
 * Purpose: turn one CLI invocation's argv + env into an {@link InvocationIdentity}: the known party it writes as
 * (an attested agent run, or the human session registered for this checkout) or the reason it has none; and decide,
 * from the registry row and the process ancestry, whether a named run is believed ({@link verifyRunAncestry}).
 *
 * Public surface: {@link resolveInvocationIdentity}, {@link verifyRunAncestry}, {@link RunIdentityArgumentError},
 * {@link UnknownPartyError}, {@link HumanSessionBinding}, {@link InvocationResolution}, {@link RunAncestryVerdict},
 * {@link refusalNamingHowToBecomeKnown}, {@link harnessRunFlagRetired}.
 *
 * @invariant There are exactly two sources here: the per-call `LORE_HARNESS_RUN` value (an agent run the integration
 *   vouched for, source `run`) and a human session (source `human`). The retired `--harness-run` flag is refused with
 *   exit 2, never read. No name is ever supplied by the writer.
 * @invariant A process carrying an agent harness marker (`hasAgentHarnessMarker`) NEVER uses a human session: an
 *   agent does not write under a person's session (BR-1350).
 * @invariant The value must name an AGENT run (`cc:...`); a `human:` / `api-key:` / `dashboard:` run id cannot be
 *   claimed, so no caller can write as a person by naming that person's run.
 * @invariant A named run is believed only when the process descends from the run's registered harness process, pid
 *   AND start time (spec-a-lore-call-s-run-identity-is-injected-per-bash-call-and, D19: per session, not finer).
 *
 * Side-effect class: pure given its arguments (env, the human-session lookup, the settings probe and the process
 * table are supplied). Lives under `@lore/core/node` for the same barrel-isolation reason as the rest of the
 * node-only identity files.
 */

import type { LoreError } from "./errors.js";
import {
  HARNESS_RUN_ENV,
  HARNESS_RUN_FLAG,
  hasAgentHarnessMarker,
  isAgentRunId,
  nameOfAgentRun,
  type InvocationIdentity,
  type RunId,
} from "./run-identity.js";

/** An invocation's run carrier was refused as a usage error (the retired flag, or a value that is not an agent run). */
export class RunIdentityArgumentError extends Error {
  readonly flag: string;
  readonly reason: string;

  constructor(flag: string, reason: string) {
    super(`${flag}: ${reason}`);
    this.name = "RunIdentityArgumentError";
    this.flag = flag;
    this.reason = reason;
  }
}

/** The human session registered for a checkout, as the entry reads it: who it is and the run it writes under. */
export interface HumanSessionBinding {
  readonly name: string;
  readonly run: RunId;
}

/**
 * The refusal text of a write with no known party (BR-1351): names how a person and an agent integration each
 * become one. `lead` says why this write has none.
 */
export function refusalNamingHowToBecomeKnown(lead: string): string {
  return (
    `${lead} Every write is made by a known party: ` +
    "a person registers with `lore session start --human <name>`; " +
    "an agent integration is installed with `lore setup` so its writes carry an attested run."
  );
}

/**
 * A write found its invocation without a known party (no attested run, no applicable human session) or naming a run
 * the registry does not know. A refusal, never a wiring defect: `loreError` is VALIDATION_ERROR (exit 4 on the CLI).
 */
export class UnknownPartyError extends Error {
  readonly loreError: Extract<LoreError, { code: "VALIDATION_ERROR" }>;

  constructor(message: string) {
    super(message);
    this.name = "UnknownPartyError";
    this.loreError = { code: "VALIDATION_ERROR", field: "identity", message };
  }
}

/** Result of {@link resolveInvocationIdentity}. */
export interface InvocationResolution {
  readonly identity: InvocationIdentity;
  /** Input argv with `--harness-run <id>` removed; a new array, the input is never mutated. */
  readonly argv: string[];
}

/** Value of a `--flag <v>` / `--flag=<v>` token at `index` ("" when valueless), or null when the token is another flag. */
function readFlagAt(argv: readonly string[], index: number, flag: string): { value: string; consumed: number } | null {
  const token = argv[index];
  if (token === flag) return { value: argv[index + 1] ?? "", consumed: 2 };
  if (token !== undefined && token.startsWith(`${flag}=`)) return { value: token.slice(flag.length + 1), consumed: 1 };
  return null;
}

/**
 * The refusal of the retired `--harness-run` flag (exit 2 at the entry): names the per-call value that replaced it.
 * reason: the flag was a text-rewrite carrier; keeping it as a second carrier would need a precedence rule for no
 * gain (spec D3, ADR adr-a-bash-call-s-run-identity-travels-in-a-per-call).
 */
export function harnessRunFlagRetired(): RunIdentityArgumentError {
  return new RunIdentityArgumentError(
    HARNESS_RUN_FLAG,
    `is retired. A lore call's run now travels in the per-call environment value ${HARNESS_RUN_ENV}, which the agent integration's hook sets for every Bash call; do not pass it by hand.`,
  );
}

/**
 * Cause of a refusal when the process runs inside an agent harness, the Bash hook is installed, and still no run
 * value arrived. Never names `lore setup`: setup is already done (#418 consequence 2).
 */
export const ENV_REMOVED_CAUSE =
  `This process runs inside an agent harness but ${HARNESS_RUN_ENV} is not set, although the Bash hook that sets it is installed: ` +
  "the value was removed between the Bash call and lore (for example `sudo` resetting the environment or `env -i`), or the hook failed on this call. " +
  "An agent never writes under a person's session.";

/** Cause of a refusal when the process runs inside an agent harness and the Bash hook is not installed. */
const HOOK_MISSING_CAUSE = "This process runs inside an agent harness but carries no attested run, and an agent never writes under a person's session.";

/** Stable machine names of the refusals of {@link verifyRunAncestry}. */
export type RunAncestryRefusalCause =
  | "unknown-run"
  | "run-ended"
  | "no-harness-pid"
  | "harness-not-ancestor"
  | "harness-pid-reused"
  | "process-table-unreadable";

/** Outcome of {@link verifyRunAncestry}: accepted, or refused with a stable `cause` and the human `error` text. */
export type RunAncestryVerdict = { readonly ok: true } | { readonly ok: false; readonly cause: RunAncestryRefusalCause; readonly error: string };

/** The part of a registry row (`RunLifecycle`) the ancestry check reads. */
export interface RunAncestryRecord {
  readonly endedAt: string | null;
  readonly endReason: string | null;
  readonly process: { readonly pid: number | null; readonly startTime: string | null };
}

/** The process-table reads the ancestry check needs; a THROW means the table could not be read. */
export interface RunAncestryTable {
  /** Parent pid of `pid`; `null` when `pid` does not exist or has no parent (pid 1). */
  parentOf(pid: number): Promise<number | null>;
  /** Start time (ISO-8601, second precision) of `pid`; `null` when it does not exist. */
  startTimeOf(pid: number): Promise<string | null>;
}

/** Upper bound of the walk: a parent cycle in a corrupt table ends the walk instead of looping. */
const MAX_ANCESTOR_HOPS = 256;

function refuseAncestry(cause: RunAncestryRefusalCause, error: string): RunAncestryVerdict {
  return { ok: false, cause, error };
}

/**
 * Decide whether the process at `selfPid` may write as `run`: the run is registered, still open, and its registered
 * harness process (pid AND start time) is `selfPid` or one of its ancestors. Never fails open: an unreadable process
 * table is a refusal.
 *
 * @param input.run - the id named by `LORE_HARNESS_RUN` (CLI) or `harness_run` (tool server)
 * @param input.record - the registry row of `run`; `null` = the registry does not know it
 * @param input.table - process-table reads, see {@link RunAncestryTable}
 * @param input.selfPid - where the walk starts (production passes `process.pid`)
 * @example
 *   await verifyRunAncestry({ run: "cc:S", record, table, selfPid: process.pid }) // => { ok: true }
 */
export async function verifyRunAncestry(input: {
  readonly run: string;
  readonly record: RunAncestryRecord | null;
  readonly table: RunAncestryTable;
  readonly selfPid: number;
}): Promise<RunAncestryVerdict> {
  const { run, record, table, selfPid } = input;
  if (record === null) return refuseAncestry("unknown-run", `unknown run ${run}`);
  if (record.endedAt !== null) {
    return refuseAncestry("run-ended", `run ${run} ended at ${record.endedAt} (${record.endReason ?? "no reason recorded"})`);
  }
  const harnessPid = record.process.pid;
  const registeredStart = record.process.startTime;
  if (harnessPid === null || registeredStart === null) {
    return refuseAncestry(
      "no-harness-pid",
      `run ${run} was registered before lore recorded harness processes; resume or restart the session so it re-registers`,
    );
  }
  try {
    const walk: { pid: number }[] = [{ pid: selfPid }];
    for (let hop = 0; hop < MAX_ANCESTOR_HOPS; hop++) {
      const last = walk[walk.length - 1] as { pid: number };
      if (last.pid === harnessPid) break; // reason: the harness is found; its own ancestors are never needed
      const parent = await table.parentOf(last.pid);
      if (parent === null || parent <= 0 || walk.some((entry) => entry.pid === parent)) break;
      walk.push({ pid: parent });
    }
    const visited = walk.find((entry) => entry.pid === harnessPid);
    if (visited === undefined) {
      return refuseAncestry("harness-not-ancestor", `this process does not descend from run ${run}'s harness process ${harnessPid}`);
    }
    const startTime = await table.startTimeOf(visited.pid);
    if (startTime === null) {
      return refuseAncestry("process-table-unreadable", `process table unreadable: the start time of harness process ${harnessPid} could not be read`);
    }
    if (startTime !== registeredStart) {
      return refuseAncestry(
        "harness-pid-reused",
        `harness pid ${harnessPid} now belongs to another process (started ${startTime}, run registered ${registeredStart})`,
      );
    }
    return { ok: true };
  } catch (cause) {
    return refuseAncestry("process-table-unreadable", cause instanceof Error ? cause.message : String(cause));
  }
}

/**
 * Resolve the identity of one lore invocation.
 *
 * @param argv - Command-line tokens after the program name; not mutated.
 * @param env - Environment: carries the per-call run value `LORE_HARNESS_RUN` and the agent harness marker.
 * @param humanSession - Looks up the human session registered for this checkout; called ONLY when the invocation
 *   carries no run value and no agent harness marker. `null` = no open session.
 * @param isBashHookInstalled - Whether the effective agent settings register the Bash PreToolUse run hook; called
 *   ONLY to name the cause when an agent harness marker is present and no run value arrived.
 * @returns the identity and a copy of argv. The run is NOT yet verified against the registry or the ancestry.
 * @throws {RunIdentityArgumentError} when argv names the retired `--harness-run` flag, or the env value is not an
 *   agent run id.
 * @example
 *   resolveInvocationIdentity(["claim", "t"], { LORE_HARNESS_RUN: "cc:S1" }, () => null, () => true)
 *   // => { identity: { harnessRun: "cc:S1", claimed: "agent:session-s1", claimedSource: "run" }, argv: ["claim", "t"] }
 */
export function resolveInvocationIdentity(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  humanSession: () => HumanSessionBinding | null,
  isBashHookInstalled: () => boolean,
): InvocationResolution {
  for (let i = 0; i < argv.length; i++) {
    const runFlag = readFlagAt(argv, i, HARNESS_RUN_FLAG);
    if (runFlag !== null) throw harnessRunFlagRetired();
  }
  // reason: `--by` stays in the returned argv untouched — a few commands give it their own meaning (`ac supersede`,
  // `feed`); it is NOT identity and never reaches the resolution below (BR-1055).
  const remaining = [...argv];

  const value = env[HARNESS_RUN_ENV];
  if (value !== undefined && value.trim() !== "") {
    if (!isAgentRunId(value)) {
      throw new RunIdentityArgumentError(HARNESS_RUN_ENV, `${JSON.stringify(value)} is not an agent run (expected a run id such as cc:<session>)`);
    }
    const run = value as RunId;
    let name: string;
    try {
      name = nameOfAgentRun(run);
    } catch (cause) {
      throw new RunIdentityArgumentError(HARNESS_RUN_ENV, cause instanceof Error ? cause.message : String(cause));
    }
    return { identity: { harnessRun: run, claimed: name, claimedSource: "run" }, argv: remaining };
  }

  if (hasAgentHarnessMarker(env)) {
    const hookInstalled = isBashHookInstalled();
    if (hookInstalled) return { identity: unresolvedIdentity(ENV_REMOVED_CAUSE), argv: remaining };
    return { identity: unresolvedIdentity(refusalNamingHowToBecomeKnown(HOOK_MISSING_CAUSE)), argv: remaining };
  }
  const session = humanSession();
  if (session !== null) {
    return { identity: { harnessRun: session.run, claimed: session.name, claimedSource: "human" }, argv: remaining };
  }
  return {
    identity: unresolvedIdentity(refusalNamingHowToBecomeKnown("This write has no attested agent run and no open human session in this checkout.")),
    argv: remaining,
  };
}

/** An identity with no known party and the refusal `reason` its writes end with. */
export function unresolvedIdentity(reason: string): InvocationIdentity {
  return { harnessRun: null, claimed: null, claimedSource: null, unresolvedReason: reason };
}
