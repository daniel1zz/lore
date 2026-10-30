/**
 * Binds `ReviewTriggerService` to the real App and the detached process spawn (BR-1379).
 *
 * Purpose: the CLI-side wiring of the post-landing review batch: the trigger/start service for `lore integrate`, the
 *   keyed store leases of the process, and the detached `lore assess --where needs-review --file-issues --close` spawn.
 * Public surface: buildReviewTriggerService, buildReviewLeases, spawnDelegatedJob, spawnDetachedReviewBatch,
 *   buildReviewBatchStarter, buildPlanCloseTrigger (the automatic plan close, AC-DCS2-11), REVIEW_BATCH_ARGS, REVIEW_BATCH_JOB.
 * Invariants:
 *   - ONE batch per process: a process that already started a review batch for a corpus while it still runs reuses it, so the several steps of
 *     a landing that ask for the batch (the archive that completes a plan, the landing's last step, the branch landing's seam) start one.
 *   - The spawn is detached with no inherited output stream; its output goes to `<corpus>/review-batch.log` (append), so a
 *     failure of the unattended batch stays readable. The landing never waits for the job to finish.
 *   - The job runs as a CHILD run its VERIFIED caller registered for it (#501, `service/delegated-run.ts`): the job outlives
 *     `lore integrate` and is re-parented to pid 1, so it cannot descend from the caller's harness; its own process is the
 *     child run's harness. The child run is in the job's `LORE_HARNESS_RUN` (never argv), and the job reads stdin before its
 *     first write: the caller sends `go` only after the run is registered. An unverified caller spawns nothing.
 *   - The binary spawned is the running one (compiled: `execPath`; source: `execPath` + `Bun.main`), never a PATH lookup.
 * Side-effect class: IO (process spawn, log file append, process-table read, run registration, App reads).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { HARNESS_RUN_ENV, err, ok, type LoreError, type PlanBundle, type Result } from "@lore/core";
import type { PlanCloseTrigger } from "../../service/task-workflow-service.js";
import type { App } from "../../app.js";
import { createRealProcessTablePort } from "../process-table-port.js";
import {
  DELEGATED_JOB_ENV,
  START_GATE_LINE,
  delegatedRunPlan,
  registerDelegatedRun,
  verifiedCallerOf,
  type DelegatedRunRegistry,
  type DelegatingCaller,
} from "../../service/delegated-run.js";
import { ReviewLeases } from "../../service/review-batch-lease.js";
import type { ListCompletePlans } from "../../service/check-stats-service.js";
import { ReviewTriggerService } from "../../service/review-batch-service.js";

/** The batch command line (after the program): the spec's `lore assess --where needs-review --file-issues --close`. */
export const REVIEW_BATCH_ARGS: readonly string[] = ["assess", "--where", "needs-review", "--file-issues", "--close"];

/** The review batch's job name: its child run's agent type. */
export const REVIEW_BATCH_JOB = "review-batch";

/** The keyed leases of one process (plan, suite, issue keys, BR-1511); `holder` identifies it (actor plus pid). */
export function buildReviewLeases(app: App, holder: string): ReviewLeases | undefined {
  return app.reviewLeaseStore === undefined ? undefined : new ReviewLeases(app.reviewLeaseStore, holder);
}

/** Spec of one delegated detached job. */
export interface DelegatedJobSpec {
  /** Job name: the child run's agent type and the `LORE_DELEGATED_JOB` value. */
  readonly name: string;
  /** The job's lore command line (after the program). */
  readonly args: readonly string[];
  readonly cwd: string;
  /** Append-mode log file receiving the job's stdout and stderr, so a failure of the unattended job stays readable. */
  readonly logPath: string;
  readonly execPath: string;
  readonly isCompiled: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The run registry the child run is written to; `undefined` fails loud (nothing is spawned). */
  readonly runService: DelegatedRunRegistry | undefined;
  /** The caller's claimed run and its verification outcome; an unverified caller cannot delegate. */
  readonly caller: DelegatingCaller;
}

function spawnRefusal(field: string, message: string): LoreError {
  return { code: "VALIDATION_ERROR", field, message, rule: "BR-1379" };
}

/**
 * Spawns a detached lore job that writes under a CHILD run delegated by the verified caller (AC-DJ-1, #501).
 *
 * Order, each step a precondition of the next (spec design D1/D2): verify the caller; plan the child run id; spawn the job
 * detached with stdin piped (the start gate: the job reads stdin before its first write) and the child run in its
 * `LORE_HARNESS_RUN`; measure the job's start time; register the child run (harness process = the job itself, parent =
 * the caller); only then send `go`. A failure after the spawn kills the job, so none is left running.
 *
 * @returns the job's pid and child run id, or the refusal (a caller that did not verify is VALIDATION_ERROR, exit 4)
 */
export async function spawnDelegatedJob(spec: DelegatedJobSpec): Promise<Result<{ readonly pid: number; readonly run: string }, LoreError>> {
  const verified = verifiedCallerOf(spec.caller);
  if (!verified.ok) return verified;
  if (spec.runService === undefined) {
    return err(spawnRefusal("run-service", `no run registry is available, so the ${spec.name} job cannot get a run: nothing was started`));
  }
  const nonce = randomBytes(5).toString("hex");
  const plan = delegatedRunPlan(verified.value, spec.name, nonce);
  if (!plan.ok) return plan;
  const entry = spec.isCompiled ? [] : [(globalThis as { Bun?: { main?: string } }).Bun?.main];
  if (entry.some((e) => e === undefined)) {
    return err(spawnRefusal("entry", `cannot determine the lore entry script to spawn the ${spec.name} job from`));
  }
  const log = openSync(spec.logPath, "a");
  let child: ChildProcess;
  try {
    child = spawn(spec.execPath, [...(entry as string[]), ...spec.args], {
      cwd: spec.cwd,
      // reason: the CHILD run travels in the job's environment, never argv (AC-RV-11); once the caller exits the job does not
      // descend from it, so the job is its own harness (registered below) instead of the caller's descendant (#501)
      env: {
        ...Object.fromEntries(Object.entries(spec.env).filter((kv): kv is [string, string] => kv[1] !== undefined)),
        [HARNESS_RUN_ENV]: plan.value.runId,
        [DELEGATED_JOB_ENV]: spec.name,
      },
      detached: true,
      // reason: the piped stdin is the start gate (spec D2): the job writes nothing until `go` arrives, EOF means abort
      stdio: ["pipe", log, log],
    });
  } finally {
    closeSync(log);
  }
  child.on("error", () => undefined); // reason: a failed spawn is reported through `pid === undefined` below, not as an unhandled event
  const pid = child.pid;
  if (pid === undefined) return err(spawnRefusal("spawn", `the ${spec.name} job could not be started (${spec.execPath})`));
  const abort = (error: LoreError): Result<never, LoreError> => {
    child.kill("SIGKILL");
    return err(error);
  };
  let startTime: string | null;
  try {
    const inspected = await createRealProcessTablePort({ env: spec.env, cwd: spec.cwd }).inspect(pid);
    startTime = inspected === null || inspected.zombie ? null : inspected.startTime;
  } catch (cause) {
    return abort(spawnRefusal("process", `cannot measure the ${spec.name} job's start time: ${cause instanceof Error ? cause.message : String(cause)}`));
  }
  if (startTime === null) return abort(spawnRefusal("process", `the ${spec.name} job (pid ${String(pid)}) exited before its run could be registered`));
  const registered = await registerDelegatedRun(spec.runService, spec.caller, { name: spec.name, nonce, pid, startTime });
  if (!registered.ok) return abort(registered.error);
  const gate = child.stdin;
  if (gate === null) return abort(spawnRefusal("spawn", `the ${spec.name} job has no start gate`));
  const sent = await new Promise<Error | null>((resolve) => {
    gate.once("error", (error) => resolve(error));
    gate.end(`${START_GATE_LINE}\n`, () => resolve(null));
  });
  if (sent !== null) return abort(spawnRefusal("spawn", `the ${spec.name} job did not receive its start signal: ${sent.message}`));
  child.unref();
  return ok({ pid, run: registered.value.id });
}

/**
 * Spawns the detached post-integrate review batch as a delegated job (BR-1379, #501).
 *
 * @param opts.cwd - the corpus's project root (the batch runs against the live corpus)
 * @param opts.corpusDir - the `.lore` directory the log is appended in
 * @param opts.execPath / opts.isCompiled / opts.env - from the Invocation
 * @param opts.runService - the run registry the batch's child run is written to
 * @param opts.caller - the integrating caller's claimed run and its verification outcome
 * @returns the job's pid, or the refusal
 */
export async function spawnDetachedReviewBatch(opts: {
  readonly cwd: string;
  readonly corpusDir: string;
  readonly execPath: string;
  readonly isCompiled: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly runService: DelegatedRunRegistry | undefined;
  readonly caller: DelegatingCaller;
}): Promise<Result<{ readonly pid: number | undefined }, LoreError>> {
  // reason: AC-PCR-3 "one batch" — a landing process asks for the batch from more than one step (the archive that completes a plan, the
  // landing's own last step, the branch landing's plan-close seam); the first spawn serves them all while that batch is still running.
  const earlier = batchStartedByThisProcess.get(opts.corpusDir);
  if (earlier !== undefined && processIsAlive(earlier)) return ok({ pid: earlier });
  const spawned = await spawnDelegatedJob({
    name: REVIEW_BATCH_JOB,
    args: REVIEW_BATCH_ARGS,
    cwd: opts.cwd,
    logPath: join(opts.corpusDir, "review-batch.log"),
    execPath: opts.execPath,
    isCompiled: opts.isCompiled,
    env: opts.env,
    runService: opts.runService,
    caller: opts.caller,
  });
  if (spawned.ok) batchStartedByThisProcess.set(opts.corpusDir, spawned.value.pid);
  return spawned.ok ? ok({ pid: spawned.value.pid }) : spawned;
}

/** The pid of the review batch this process started, per corpus directory (see {@link spawnDetachedReviewBatch}). */
const batchStartedByThisProcess = new Map<string, number>();

/** Whether a process with this pid exists (signal 0 sends nothing); an unreadable answer other than "no such process" counts as alive. */
function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/** What {@link buildPlanCloseTrigger} needs of the invocation that archives. */
export interface PlanCloseTriggerInput {
  readonly app: App;
  /** The corpus database path; the project root and the corpus directory derive from it. */
  readonly dbPath: string;
  readonly execPath: string;
  readonly isCompiled: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The acting identity (names the review lease holder). */
  readonly actor: string;
  /** The caller's claimed run and its verification outcome: an unverified caller cannot delegate a run to the batch. */
  readonly caller: DelegatingCaller;
}

/**
 * The starter behind every trigger of the automatic plan close: the existing `ReviewTriggerService.start` over the detached, delegated
 * spawn. One call computes the trigger set and, when it is non-empty, starts ONE detached batch (plans another batch holds are skipped by its per-plan lease, BR-1511) and returns at
 * once; a start that could not happen is a line, never a failure of the caller.
 *
 * @returns a function from the plan's slug and the reason it is asked (one phrase) to the line the caller prints; `undefined` when this
 *   composition cannot compute the trigger set (no lease store or decision reader), so nothing can be started
 */
export function buildReviewBatchStarter(input: PlanCloseTriggerInput): ((planSlug: string, why: string) => Promise<string>) | undefined {
  const corpusDir = dirname(resolvePath(input.dbPath));
  const projectRoot = dirname(corpusDir);
  const trigger = buildReviewTriggerService(input.app, `${input.actor}:plan-close:${String(process.pid)}`, () =>
    spawnDetachedReviewBatch({
      cwd: projectRoot,
      corpusDir,
      execPath: input.execPath,
      isCompiled: input.isCompiled,
      env: input.env,
      // reason: #501 — the batch outlives this process, so it gets a child run registered by THIS (verified) caller
      runService: input.app.runService,
      caller: input.caller,
    }),
  );
  if (trigger === undefined) return undefined;
  return async (planSlug, why) => {
    const started = await trigger.start();
    if (!started.ok) return `plan close: WARNING: the review batch for ${planSlug} was not started: ${started.error.code}${"message" in started.error ? ` ${started.error.message}` : ""}`;
    switch (started.value.state) {
      case "empty":
        return `plan close: ${planSlug} ${why}; no plan needs review`;
      case "started":
        return `plan close: ${planSlug} ${why}; the review batch started${started.value.pid !== undefined ? ` (pid ${String(started.value.pid)})` : ""} and closes it in the background`;
    }
  };
}

/**
 * The trigger of the automatic plan close for the archiving command (AC-DCS2-11): {@link buildReviewBatchStarter} behind
 * `TaskWorkflowService.done`'s last-archive hook.
 *
 * @returns `undefined` when no batch can be started in this composition, so no trigger is wired
 */
export function buildPlanCloseTrigger(input: PlanCloseTriggerInput): PlanCloseTrigger | undefined {
  const start = buildReviewBatchStarter(input);
  return start === undefined ? undefined : { afterLastArchive: (planSlug) => start(planSlug, "has no task left") };
}

/**
 * The complete-plan reader `CheckStatsService` takes (bootstrap's complete line, `lore checks stats`): the trigger
 * service's one classification, narrowed to the acceptance view's shape.
 *
 * @param trigger - from {@link buildReviewTriggerService}
 */
export function buildCompletePlanLister(trigger: ReviewTriggerService): ListCompletePlans {
  return async () => {
    const complete = await trigger.listCompletePlans();
    if (!complete.ok) return complete;
    return ok(complete.value.map((e) => ({ plan: e.plan, planId: e.planId, completeAt: e.completeAt, awaitingOwner: e.need === "awaiting-owner", ...(e.reviewProblem !== undefined ? { reviewProblem: e.reviewProblem } : {}) })));
  };
}

/** The spawn a read-only caller binds: a read never starts a batch. */
export function refuseSpawnForRead(): Result<{ readonly pid: number | undefined }, LoreError> {
  return err({ code: "VALIDATION_ERROR", field: "spawn", message: "a read never spawns a review batch", rule: "BR-1379" });
}

/**
 * The trigger/start service over the real App.
 *
 * @param _holder - unused: the trigger takes no lease any more (BR-1511); kept so every call site stays unchanged
 * @param spawnBatch - the detached spawn (`spawnDetachedReviewBatch` bound to the invocation)
 */
export function buildReviewTriggerService(
  app: App,
  _holder: string,
  spawnBatch: () => Result<{ readonly pid: number | undefined }, LoreError> | Promise<Result<{ readonly pid: number | undefined }, LoreError>>,
): ReviewTriggerService | undefined {
  const decisions = app.decisionReadService;
  const retired = app.retiredAcService;
  if (decisions === undefined) return undefined;
  return new ReviewTriggerService({
    listPlans: async () => {
      const listed = await app.corpusService.listFull({ type: "plan" });
      return listed.ok ? ok(listed.value.docs) : listed;
    },
    getPlanBundle: (ref) => app.corpusService.getPlanBundle(ref),
    listReviewDocs: (planId) => app.corpusService.listMilestoneReviewDocs(planId),
    pendingDecisionSubjects: async () => {
      const pending = await decisions.readPending();
      return pending.ok ? ok(new Set(pending.value.map((p) => p.subject_id))) : pending;
    },
    issueCoverage: (planId, failed) => app.corpusService.coverageOfFailedDimensions(planId, failed),
    ...(retired !== undefined ? { hasStaleOwnerDecision: (bundle: PlanBundle) => retired.hasStalePendingDecision(bundle) } : {}),
    spawnBatch,
  });
}
