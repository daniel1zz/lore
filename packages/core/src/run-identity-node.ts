/**
 * Per-invocation identity resolution (spec-every-write-is-made-by-a-known-party-an-attested-agent-run end state 1-3;
 * BR-1055, BR-1032, BR-1350, BR-1351).
 *
 * Purpose: turn one CLI invocation's argv + env into an {@link InvocationIdentity}: the known party it writes as
 * (an attested agent run, or the human session registered for this checkout) or the reason it has none, and hand
 * back argv with the harness-owned `--harness-run <id>` removed.
 *
 * Public surface: {@link resolveInvocationIdentity}, {@link RunIdentityArgumentError}, {@link UnknownPartyError},
 * {@link HumanSessionBinding}, {@link InvocationResolution}, {@link refusalNamingHowToBecomeKnown}.
 *
 * @invariant There are exactly two sources here: the `--harness-run` flag (an agent run the integration vouched for,
 *   source `run`) and a human session (source `human`). The explicit `--by` layer, the environment session-id name,
 *   the working-copy name and the computer user name are gone: no name is ever supplied by the writer.
 * @invariant A process carrying an agent harness marker (`hasAgentHarnessMarker`) NEVER uses a human session: an
 *   agent does not write under a person's session (BR-1350).
 * @invariant `--harness-run` must name an AGENT run (`cc:...`); a `human:` / `api-key:` / `dashboard:` run id cannot
 *   be claimed from the command line, so no caller can write as a person by naming that person's run.
 *
 * Side-effect class: pure given its arguments (env and the human-session lookup are supplied). Lives under
 * `@lore/core/node` for the same barrel-isolation reason as the rest of the node-only identity files.
 */

import type { LoreError } from "./errors.js";
import {
  HARNESS_RUN_FLAG,
  hasAgentHarnessMarker,
  isAgentRunId,
  nameOfAgentRun,
  type InvocationIdentity,
  type RunId,
} from "./run-identity.js";

/** An invocation's `--harness-run` flag was malformed (missing, empty or not an agent run). */
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

/** Value of a `--flag <v>` / `--flag=<v>` token at `index`, or null when the token is another flag. */
function readFlagAt(argv: readonly string[], index: number, flag: string): { value: string; consumed: number } | null {
  const token = argv[index];
  if (token === flag) {
    const value = argv[index + 1];
    if (value === undefined) throw new RunIdentityArgumentError(flag, "requires a value");
    return { value, consumed: 2 };
  }
  if (token !== undefined && token.startsWith(`${flag}=`)) {
    return { value: token.slice(flag.length + 1), consumed: 1 };
  }
  return null;
}

/**
 * Resolve the identity of one lore invocation.
 *
 * @param argv - Command-line tokens after the program name; not mutated.
 * @param env - Environment to look for an agent harness marker in (`Invocation.env`).
 * @param humanSession - Looks up the human session registered for this checkout; called ONLY when the invocation
 *   carries no harness run and no agent harness marker. `null` = no open session.
 * @returns the identity and argv with `--harness-run <id>` removed.
 * @throws {RunIdentityArgumentError} when `--harness-run` has no value, an empty value, or names a run that is not
 *   an agent run.
 * @example
 *   resolveInvocationIdentity(["claim", "t", "--harness-run", "cc:S1"], {}, () => null)
 *   // => { identity: { harnessRun: "cc:S1", claimed: "agent:session-s1", claimedSource: "run" }, argv: ["claim", "t"] }
 * @example
 *   resolveInvocationIdentity(["set", "x"], {}, () => ({ name: "dana", run: "human:0123456789abcdef" }))
 *   // => { identity: { harnessRun: "human:0123456789abcdef", claimed: "dana", claimedSource: "human" }, argv: ["set", "x"] }
 */
export function resolveInvocationIdentity(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  humanSession: () => HumanSessionBinding | null,
): InvocationResolution {
  const remaining: string[] = [];
  let harnessRun: string | null = null;

  for (let i = 0; i < argv.length; ) {
    const runFlag = readFlagAt(argv, i, HARNESS_RUN_FLAG);
    if (runFlag !== null) {
      if (runFlag.value.trim() === "") throw new RunIdentityArgumentError(HARNESS_RUN_FLAG, "value must not be empty");
      if (!isAgentRunId(runFlag.value)) {
        throw new RunIdentityArgumentError(HARNESS_RUN_FLAG, `${JSON.stringify(runFlag.value)} is not an agent run (expected a run id such as cc:<session>)`);
      }
      harnessRun = runFlag.value;
      i += runFlag.consumed;
      continue;
    }
    // reason: `--by` stays in the returned argv untouched — a few commands give it their own meaning (`ac supersede`,
    // `feed`); it is NOT identity and never reaches the resolution below (BR-1055).
    remaining.push(argv[i] as string);
    i++;
  }

  if (harnessRun !== null) {
    const run = harnessRun as RunId;
    let name: string;
    try {
      name = nameOfAgentRun(run);
    } catch (cause) {
      throw new RunIdentityArgumentError(HARNESS_RUN_FLAG, cause instanceof Error ? cause.message : String(cause));
    }
    return { identity: { harnessRun: run, claimed: name, claimedSource: "run" }, argv: remaining };
  }

  if (hasAgentHarnessMarker(env)) {
    return {
      identity: unresolvedIdentity(refusalNamingHowToBecomeKnown("This process runs inside an agent harness but carries no attested run, and an agent never writes under a person's session.")),
      argv: remaining,
    };
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
