/**
 * Binds `ReviewTriggerService` to the real App and the detached process spawn (BR-1379).
 *
 * Purpose: the CLI-side wiring of the post-landing review batch: the trigger/start service for `lore integrate`, the
 *   store lease for the batch process, and the detached `lore assess --where needs-review --file-issues --close` spawn.
 * Public surface: buildReviewTriggerService, buildReviewLease, spawnDetachedReviewBatch, REVIEW_BATCH_ARGS.
 * Invariants:
 *   - The spawn is detached with no inherited streams; its output goes to `<corpus>/review-batch.log` (append), so a
 *     failure of the unattended batch stays readable. The landing never waits for the child.
 *   - The child runs as the CALLER's attested run (`--harness-run <run>`); with no plain run id nothing is spawned
 *     and the start fails loud (an unattested batch's writes would be refused mid-run).
 *   - The binary spawned is the running one (compiled: `execPath`; source: `execPath` + `Bun.main`), never a PATH lookup.
 * Side-effect class: IO (process spawn, log file append, App reads).
 */

import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { join } from "node:path";
import { err, ok, type LoreError, type Result } from "@lore/core";
import type { App } from "../../app.js";
import { ReviewBatchLease } from "../../service/review-batch-lease.js";
import type { ListCompletePlans } from "../../service/check-stats-service.js";
import { ReviewTriggerService } from "../../service/review-batch-service.js";

/** The batch command line (after the program): the spec's `lore assess --where needs-review --file-issues --close`. */
export const REVIEW_BATCH_ARGS: readonly string[] = ["assess", "--where", "needs-review", "--file-issues", "--close"];

const PLAIN_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9:._-]*$/;

/** The lease for one batch process; `holder` identifies it (actor plus pid). */
export function buildReviewLease(app: App, holder: string): ReviewBatchLease | undefined {
  return app.reviewLeaseStore === undefined ? undefined : new ReviewBatchLease(app.reviewLeaseStore, holder);
}

/**
 * Spawns the detached batch.
 *
 * @param opts.cwd - the corpus's project root (the batch runs against the live corpus)
 * @param opts.corpusDir - the `.lore` directory the log is appended in
 * @param opts.execPath / opts.isCompiled / opts.env - from the Invocation
 * @param opts.harnessRun - the caller's attested run
 * @returns the child's pid, or the refusal
 */
export function spawnDetachedReviewBatch(opts: {
  readonly cwd: string;
  readonly corpusDir: string;
  readonly execPath: string;
  readonly isCompiled: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly harnessRun: string | undefined;
}): Result<{ readonly pid: number | undefined }, LoreError> {
  if (opts.harnessRun === undefined || !PLAIN_RUN_ID.test(opts.harnessRun)) {
    return err({
      code: "VALIDATION_ERROR",
      field: "identity",
      message: "the review batch runs as the caller's attested run and this invocation has none (or its run id is not a plain run id): no batch was started",
      rule: "BR-1379",
    });
  }
  const entry = opts.isCompiled ? [] : [(globalThis as { Bun?: { main?: string } }).Bun?.main];
  if (entry.some((e) => e === undefined)) {
    return err({ code: "VALIDATION_ERROR", field: "entry", message: "cannot determine the lore entry script to spawn the review batch from", rule: "BR-1379" });
  }
  const log = openSync(join(opts.corpusDir, "review-batch.log"), "a");
  try {
    const child = spawn(opts.execPath, [...(entry as string[]), ...REVIEW_BATCH_ARGS, "--harness-run", opts.harnessRun], {
      cwd: opts.cwd,
      env: Object.fromEntries(Object.entries(opts.env).filter((kv): kv is [string, string] => kv[1] !== undefined)),
      detached: true,
      stdio: ["ignore", log, log],
    });
    child.unref();
    return ok({ pid: child.pid });
  } finally {
    closeSync(log);
  }
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
    return ok(complete.value.map((e) => ({ plan: e.plan, planId: e.planId, completeAt: e.completeAt, awaitingOwner: e.need === "awaiting-owner" })));
  };
}

/** The spawn a read-only caller binds: a read never starts a batch. */
export function refuseSpawnForRead(): Result<{ readonly pid: number | undefined }, LoreError> {
  return err({ code: "VALIDATION_ERROR", field: "spawn", message: "a read never spawns a review batch", rule: "BR-1379" });
}

/**
 * The trigger/start service over the real App.
 *
 * @param spawnBatch - the detached spawn (`spawnDetachedReviewBatch` bound to the invocation)
 * @param holder - this process's lease holder id
 */
export function buildReviewTriggerService(
  app: App,
  holder: string,
  spawnBatch: () => Result<{ readonly pid: number | undefined }, LoreError>,
): ReviewTriggerService | undefined {
  const lease = buildReviewLease(app, holder);
  const decisions = app.decisionReadService;
  if (lease === undefined || decisions === undefined) return undefined;
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
    linkedOpenIssueTitles: (planId) => app.corpusService.listLinkedOpenIssueTitles(planId),
    isLeaseLive: () => lease.isLive(),
    spawnBatch,
  });
}
