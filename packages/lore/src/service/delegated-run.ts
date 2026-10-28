/**
 * Delegated runs: a detached lore job writes under a CHILD run its verified caller registered for it
 * (spec-a-detached-lore-job-writes-under-a-child-run-delegated-by, AC-DJ-1, resolves #501).
 *
 * Purpose: since #418 a run is believed only when the writing process descends from the run's registered harness process.
 * A job that outlives its caller (the post-integrate review batch) is re-parented to pid 1 and would be refused. The fix is
 * delegated identity: the caller, whose own run verified, registers a child run whose harness process IS the job process
 * (`verifyRunAncestry` starts its walk at the writing process, so a process that is its own harness verifies, no change to
 * the walk) and whose parent is the caller's run. A stdin start gate keeps the job from writing before that run exists.
 *
 * Public surface: {@link verifiedCallerOf}, {@link delegatedRunPlan}, {@link registerDelegatedRun}, {@link awaitStartGate},
 * {@link endDelegatedJobRun}, {@link DELEGATED_JOB_ENV}, {@link START_GATE_LINE}.
 *
 * @invariant I1 (security): only a caller whose own run verified can register a child run. {@link registerDelegatedRun} takes
 *   the result of `verifyInvocationIdentity` (run through the ancestry probe) and refuses anything else. It has no CLI or HTTP
 *   surface: `lore run register --parent` is NOT a way to mint a delegated run, so an unverified process cannot mint one.
 * @invariant I2: the child's parent run is the verified caller's run, never a value the job supplies.
 * @invariant I3: the job writes nothing before its run is registered ({@link awaitStartGate}); a job whose stdin ends
 *   without the gate line exits having written nothing.
 * @invariant I4: the job ends its child run when it exits ({@link endDelegatedJobRun}); a job killed with SIGKILL has a dead
 *   harness pid, which the run-reap service already treats as run death.
 * Side-effect class: stateful (one run row through the injected registry; the gate reads one stream).
 */
import { err, HARNESS_ADAPTERS, isAgentRunId, ok, type InvocationIdentity, type LoreError, type Result, type RunId, type RunRecord } from "@lore/core";
import type { RegisterDelegatedRunInput, RunEndResult } from "./run-service.js";

/** Environment value naming the delegated job a lore process is (the job's name); set by the spawning caller, read by the entry. It names a job, never a party: identity stays in `LORE_HARNESS_RUN`. */
export const DELEGATED_JOB_ENV = "LORE_DELEGATED_JOB";

/** The line the caller writes to the job's stdin once the child run exists. */
export const START_GATE_LINE = "go";

/** Job names and nonces become part of a run id (`cc:<session>:<job>-<nonce>`), so they must be plain. */
const PLAIN_PART = /^[A-Za-z0-9._-]+$/;

/** What a caller hands over: the run its invocation claimed and the outcome of verifying it (registry plus process ancestry). */
export interface DelegatingCaller {
  /** The run the invocation named (`inv.identity.harnessRun`), `null` when it named none. */
  readonly claimedRun: string | null;
  /** The output of `verifyInvocationIdentity` with an ancestry probe (`app.verifiedInvocationIdentity()`). */
  readonly verified: Result<InvocationIdentity | undefined, LoreError>;
}

/** A caller whose run verified: the only value a child run can be minted from. */
export interface VerifiedCaller {
  readonly run: RunId;
}

/** The registry a delegated run is written to (`RunService`). */
export interface DelegatedRunRegistry {
  registerDelegated(input: RegisterDelegatedRunInput): Promise<Result<RunRecord, LoreError>>;
}

/** The run registry's end verb (`RunService.end`). */
export interface DelegatedRunEnder {
  end(runId: string, reason: string): Promise<Result<RunEndResult, LoreError>>;
}

/** The run id and its derivation parts, before the job exists. */
export interface DelegatedRunPlan {
  readonly runId: RunId;
  readonly harness: string;
  readonly sessionId: string;
  readonly agentId: string;
}

/** The facts of the spawned job process, measured by the caller. */
export interface DelegatedJobProcess {
  readonly name: string;
  /** Random part of the child run id; the caller puts the planned id in the job's environment before spawning. */
  readonly nonce: string;
  readonly pid: number;
  readonly startTime: string;
}

function refusal(claimedRun: string | null, cause?: string): LoreError {
  const base = `delegated run refused: caller run ${claimedRun ?? "(none)"} is not verified`;
  return { code: "VALIDATION_ERROR", field: "delegated-run", message: cause === undefined ? base : `${base}: ${cause}` };
}

/**
 * The caller as a verified run, or the refusal.
 *
 * @param caller - the claimed run and the verification outcome
 * @returns ok(the verified caller) only when the verification succeeded for an agent run that is the claimed run;
 *   VALIDATION_ERROR `delegated run refused: caller run <id> is not verified` (exit 4) otherwise: unknown, ended or
 *   foreign-harness run, an unverifiable composition (verification result absent), a human or key identity.
 */
export function verifiedCallerOf(caller: DelegatingCaller): Result<VerifiedCaller, LoreError> {
  if (!caller.verified.ok) {
    const cause = caller.verified.error;
    return err(refusal(caller.claimedRun, "message" in cause ? cause.message : cause.code));
  }
  const identity = caller.verified.value;
  if (identity === undefined || identity.harnessRun === null || identity.claimedSource !== "run") return err(refusal(caller.claimedRun));
  if (identity.harnessRun !== caller.claimedRun || !isAgentRunId(identity.harnessRun)) return err(refusal(caller.claimedRun));
  return ok({ run: identity.harnessRun });
}

/**
 * The child run id of a job, derived from the caller's session: `cc:<session>:<job>-<nonce>`.
 *
 * @param caller - a verified caller (a helper's run `cc:<session>:<agent>` still yields the same session)
 * @param name - the job name, which is also the child's agent type
 * @param nonce - plain random text making this job's run unique
 * @throws never; a malformed part is a VALIDATION_ERROR
 */
export function delegatedRunPlan(caller: VerifiedCaller, name: string, nonce: string): Result<DelegatedRunPlan, LoreError> {
  const adapter = Object.values(HARNESS_ADAPTERS).find((candidate) => caller.run.startsWith(candidate.runIdPrefix));
  if (adapter === undefined) return err(refusal(caller.run, "its harness is not a shipped agent integration"));
  const sessionId = caller.run.slice(adapter.runIdPrefix.length).split(":")[0] ?? "";
  if (!PLAIN_PART.test(name) || !PLAIN_PART.test(nonce) || !PLAIN_PART.test(sessionId)) {
    return err({ code: "VALIDATION_ERROR", field: "delegated-run", message: `a delegated run needs a plain session, job name and nonce (got ${JSON.stringify([sessionId, name, nonce])})` });
  }
  const agentId = `${name}-${nonce}`;
  return ok({ runId: adapter.derive({ sessionId, agentId }), harness: adapter.harness, sessionId, agentId });
}

/**
 * Register the child run of a spawned job: its harness process is the job's own pid and start time, its parent is the caller.
 *
 * @param registry - the run registry (`RunService`)
 * @param callerCheck - the caller's claimed run and its verification outcome; anything but a verified agent run is refused
 * @param job - the spawned job's name, nonce, pid and measured start time
 * @returns ok(the stored child run); the refusal of {@link verifiedCallerOf}; the registry's own error
 */
export async function registerDelegatedRun(
  registry: DelegatedRunRegistry,
  callerCheck: DelegatingCaller,
  job: DelegatedJobProcess,
): Promise<Result<RunRecord, LoreError>> {
  const verified = verifiedCallerOf(callerCheck);
  if (!verified.ok) return verified;
  const caller = verified.value;
  const plan = delegatedRunPlan(caller, job.name, job.nonce);
  if (!plan.ok) return plan;
  return registry.registerDelegated({
    harness: plan.value.harness,
    sessionId: plan.value.sessionId,
    agentId: plan.value.agentId,
    agentType: job.name,
    parentRunId: caller.run,
    process: { pid: job.pid, startTime: job.startTime, worktree: null },
  });
}

/**
 * Job side of the start gate: wait until the caller sends {@link START_GATE_LINE} on stdin.
 *
 * @param stdin - the job's input stream
 * @returns `true` once the gate line arrived; `false` when the stream ended without it (the job must then write nothing)
 */
export async function awaitStartGate(stdin: AsyncIterable<string | Uint8Array>): Promise<boolean> {
  const decoder = new TextDecoder();
  let pending = "";
  for await (const chunk of stdin) {
    pending += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    if (lines.some((line) => line.trim() === START_GATE_LINE)) return true;
  }
  return (pending + decoder.decode()).trim() === START_GATE_LINE;
}

/**
 * Job side of the run end: end the child run the job carried.
 *
 * @param ender - the run registry (`RunService`)
 * @param run - the job's run (`LORE_HARNESS_RUN`)
 * @param job - the job name, recorded in the end reason
 */
export function endDelegatedJobRun(ender: DelegatedRunEnder, run: string, job: string): Promise<Result<RunEndResult, LoreError>> {
  return ender.end(run, `delegated job ${job} exited`);
}
