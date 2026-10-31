/**
 * ReviewBatchService (ReviewTriggerService + ReviewBatchRunner) — the trigger set after a landing and the batch that turns complete plans into accepted ones
 * (spec-plans-close-themselves-level-triggered-reconciliation-of, BR-1379).
 *
 * Purpose: (1) {@link ReviewTriggerService.computeTriggerSet}: from stored plan progress, the complete plans that need a
 *   review, a retry of their issue filing, a close, or an owner-resolved settle; (2) {@link ReviewTriggerService.start}:
 *   the landing's one cheap question "is there work" answered by starting ONE detached batch for the whole machine: it takes
 *   `batch:<machine>` atomically or starts nothing (BR-1532);
 *   (3) {@link ReviewBatchRunner.runBatch}: the batch itself; each plan's review runs under its own lease `plan:<id>` (BR-1511),
 *   so a plan another batch holds is skipped and named; {@link ReviewBatchRunner.runMachineBatch} wraps it in the machine's batch
 *   lease and the re-read loop that picks up plans landed during the run.
 * Public surface: {@link classifyPlan}, {@link PlanReviewNeed}, {@link ReviewTriggerDeps}, {@link ReviewRunDeps}, {@link ReviewTriggerService}, {@link ReviewBatchRunner},
 *   {@link BatchPlanRow}, {@link BATCH_ERROR_AUDIT_ACTION}, {@link MachineBatchPorts}, {@link MachineBatchRun}, {@link BatchLeasePort}.
 * Invariants:
 *   - Level-triggered: a plan is in the trigger set because of its CURRENT state (complete, not archived, and its
 *     latest valid review does not match the current fingerprint / its filing or close is unfinished / its owner
 *     decision is resolved), never because of an event.
 *   - Awaiting owner (a current review lists retired ACs and the decision is still pending) is NOT in the set, unless that decision no longer matches the plan's current retired list (then it is, so settle withdraws it); the
 *     plan stays complete, not archived, and is not an anomaly.
 *   - Each plan is judged at most once per fingerprint: a review row at the current fingerprint is never re-judged;
 *     an errored attempt is an audit row (`milestone-batch-error`), not a review, so it does not count and the next
 *     batch judges the plan again. The audit row never touches the plan's version or fingerprint.
 *   - A filing error keeps the stored verdict: the plan stays complete and the next batch retries only the filing.
 *   - The full suite is measured at most once per batch, and only when a plan actually needs a judgment.
 *   - A pass archives as accepted; a fail archives as accepted with known defects after its findings are filed by
 *     root cause (BR-1372 plan close reads the linked open issues); retired ACs wait for the one owner decision.
 *   - Gates (`correctness_vs_acs`, `regression`, `security`): a gate that failed or is not-measured is filed like any
 *     failure but the plan stays open (`kept-open`, exit 0, status unchanged) unless the plan accepted that gate with a
 *     decision (`gate_accepted` known defect, BR-1500); `na` never blocks. Non-gate failures still close as known defects.
 *   - The batch measures nothing per landing (spec D1, BR-1379): it runs no suite and attests no criterion at a landing commit.
 *     A current review is re-made only when (a) the plan's own state changed (its own task landed), (b) a gate that keeps the
 *     plan open is `not-measured` on regression (the suite could not complete: the next batch retries), or (c) a landing on
 *     main since the review's assessed commit changed a file its failing facts name (`failing_fact_files`); an unrelated
 *     landing triggers nothing, and a hand `lore assess` always reviews.
 *   - Re-judging a `not-measured` regression is retried only when a retry can change it (the suite or a single-file run could not
 *     complete); a task with no landing record or an unmappable landing waits for the plan's own landing, a landing touching its
 *     failing facts, or a manual `lore assess`.
 *   - The landing never waits for a review: {@link ReviewTriggerService.start} only reads state and spawns.
 *   - One batch per machine (BR-1532): `start` spawns only while holding `batch:<machine>`; a batch loop revisits a plan only at a changed fingerprint.
 * Side-effect class: IO through injected ports (services never import each other; the CLI adapter binds the real ones).
 *
 * Reference: GitHub merge queue (one batched check run for many queued items).
 * @spec_ref spec-plans-close-themselves-level-triggered-reconciliation-of (AC-PCR-3, AC-PCR-4, AC-PCR-5, BR-1379)
 */

import { acceptedGatesOf, pendingAcceptancesOf, type GateAcceptanceLog } from "./gate-acceptance-service.js";
import { blockingGates, err, filableDimensions, milestoneReviewSchema, ok, regressionRetryCanChange, type DocRecord, type LoreError, type MilestoneReview, type PlanBundle, type Result } from "@lore/core";
import { readStoredPlanProgress } from "../store/plan-progress.js";
import { MILESTONE_REVIEW_SUB_TYPE, planStateFingerprint, selectLatestMilestoneReview, type PlanRetirementState } from "./milestone-review.js";
import type { MilestoneReviewResult } from "./milestone-review-service.js";
import type { SuiteRun } from "./milestone-review-inputs.js";
import { retirementSubjectId } from "./retired-ac-service.js";
import type { IssueFilingService } from "./issue-filing-service.js";
import type { DimensionCoverage } from "./milestone-review-inputs.js";
import { rootCauseOf, type FailedFinding, type RootCause } from "./root-cause-fingerprint.js";
import { UNKNOWN_MACHINE_ID, batchLeaseKey, leaseLostError, type LeaseHandle, type LeaseOutcome } from "./review-batch-lease.js";

// reason: the constant lives in the pure acceptance view (bootstrap and checks stats read the same rows); re-exported so existing importers keep one name.
export { BATCH_ERROR_AUDIT_ACTION } from "./plan-acceptance-view.js";

/** What a complete plan needs next. */
export type PlanReviewNeed =
  | "none"
  | "review"
  | "owner-resolved"
  | "filing"
  | "close"
  | "awaiting-owner";

/** The facts {@link classifyPlan} decides from. */
export interface PlanReviewFacts {
  readonly status: DocRecord["status"];
  readonly progressState: "in-progress" | "complete" | "empty";
  readonly fingerprint: string;
  readonly latest?: { readonly fingerprint: string; readonly overall: "pass" | "fail"; readonly retiredCount: number };
  /** A pending owner decision exists for the plan's retirement subject. */
  readonly ownerPending: boolean;
  /** The latest review failed and some failed finding has no open linked issue yet. */
  readonly filingIncomplete: boolean;
  /** The latest review failed a dimension whose only linked issue is now closed: the fix is new input (#394). */
  readonly coveringIssueFixed: boolean;
  /** The stored review at the current fingerprint cannot be filed (see {@link unfileableReviewError}): it is not a valid review. */
  readonly unfileableReview?: string;
}

/**
 * What a plan needs, from its current state alone.
 *
 * @returns `none` for anything not complete and open; `review` when no valid review matches the current fingerprint;
 *   `awaiting-owner` / `owner-resolved` for a current review that lists retired ACs; `filing` for a failing current
 *   review whose issues are not all filed; `close` for a current review with nothing left but the close.
 */
export function classifyPlan(facts: PlanReviewFacts): PlanReviewNeed {
  if (facts.progressState !== "complete" || facts.status === "archived" || facts.status === "deprecated") return "none";
  if (facts.latest === undefined || facts.latest.fingerprint !== facts.fingerprint) return "review";
  // reason: a stored review that cannot be filed is not a review (spec "Error"; #349): the next batch judges the plan again.
  if (facts.unfileableReview !== undefined) return "review";
  // reason: a closed covering issue means the defect was fixed; the unchanged plan fingerprint must not keep the old verdict (#394).
  if (facts.latest.overall === "fail" && facts.coveringIssueFixed && facts.latest.retiredCount === 0) return "review";
  if (facts.latest.retiredCount > 0) return facts.ownerPending ? "awaiting-owner" : "owner-resolved";
  if (facts.latest.overall === "fail" && facts.filingIncomplete) return "filing";
  return "close";
}

/** The ports the batch itself reads through (the runner never decides what is in the trigger set). */
export type ReviewRunDeps = Pick<ReviewTriggerDeps, "getPlanBundle" | "listReviewDocs" | "issueCoverage"> & {
  /** The decision log reader the acceptance predicate reads (required: a composition with none wired passes `unwiredGateAcceptanceLog()`, which fails the close loud). */
  readonly acceptanceLog: GateAcceptanceLog;
};

/** The ports the trigger side reads through and the landing's start writes through (a spawn). */
export interface ReviewTriggerDeps {
  /** Every live plan. */
  readonly listPlans: () => Promise<Result<DocRecord[], LoreError>>;
  readonly getPlanBundle: (planRef: string) => Promise<Result<PlanBundle, LoreError>>;
  /** The plan's knowledge docs of sub_type milestone-review. */
  readonly listReviewDocs: (planId: string) => Promise<Result<DocRecord[], LoreError>>;
  /** Subject ids with an open pending decision (pure read; nothing is appended). */
  readonly pendingDecisionSubjects: () => Promise<Result<ReadonlySet<string>, LoreError>>;
  /** True when the plan's pending owner decision lists retirements that differ from its current list (pure read); absent = not wired. */
  readonly hasStaleOwnerDecision?: (bundle: PlanBundle) => Promise<Result<boolean, LoreError>>;
  /** The plan-close coverage predicate (`CorpusService.coverageOfFailedDimensions`): which failed dimensions an open linked issue's record covers. */
  readonly issueCoverage: (planId: string, failed: readonly string[]) => Promise<Result<DimensionCoverage, LoreError>>;
  /**
   * Starts the detached batch process; returns once it is spawned (never waits for it). `handoff` names the batch lease the
   * starter holds on the child's behalf: the child takes it over by compare-and-set on `handoff.holder` before it works.
   */
  readonly spawnBatch: (handoff: BatchHandoff | undefined) => Result<{ readonly pid: number | undefined }, LoreError> | Promise<Result<{ readonly pid: number | undefined }, LoreError>>;
  /** The machine's batch lease (BR-1532). Absent only in a bare construction (and the read-only ones, which never start a batch): `start` then spawns with no handoff. */
  readonly batchLease?: BatchLeasePort;
}

/** The batch lease a landing took for the batch it spawns: the key and the starter's exact holder name. */
export interface BatchHandoff {
  readonly key: string;
  readonly holder: string;
}

/** The slice of `ReviewLeases` the trigger and the batch loop use for `batch:<machine>`. */
export interface BatchLeasePort {
  /** The machine id of the key (`unknown` when this process has no identity). */
  readonly machineId: () => Promise<string>;
  /** Atomic take of `key`. */
  readonly acquire: (key: string) => Promise<Result<LeaseOutcome, LoreError>>;
}

/** The trigger set: the plans that need work, with what they need. */
export interface TriggerEntry {
  readonly plan: string;
  readonly need: Exclude<PlanReviewNeed, "none" | "awaiting-owner">;
}

/** A complete, unarchived plan and what it needs next. */
export interface CompletePlanEntry {
  readonly plan: string;
  readonly planId: string;
  readonly need: Exclude<PlanReviewNeed, "none">;
  /** The stored `progress.at` of the write that made the plan complete. */
  readonly completeAt: string;
  /** Why the plan's stored review is not a valid review (unfileable), when that is why it needs a review. */
  readonly reviewProblem?: string;
}

/**
 * What the landing's start did. `started`: this landing took `batch:<machine>` and spawned the batch (`key` names it;
 * `machineUnknown` = the key is the shared `batch:unknown`). `covered`: another live holder has the key, nothing was
 * spawned, and that batch re-reads the trigger set after it releases.
 */
export type StartOutcome =
  | { readonly state: "empty" }
  | { readonly state: "started"; readonly triggered: number; readonly pid: number | undefined; readonly key?: string; readonly machineUnknown?: boolean }
  | { readonly state: "covered"; readonly triggered: number; readonly key: string; readonly machineUnknown: boolean; readonly holder: string; readonly expires_at: string };

/** The ports `runBatch` drives. */
export interface BatchRunPorts {
  /** Takes the lease `plan:<planId>` (BR-1511); `busy` names the other holder and its expiry. */
  readonly acquirePlanLease: (planId: string) => Promise<Result<LeaseOutcome, LoreError>>;
  /** Carries out an answered owner decision and raises the one pending decision; `undefined` when not wired. */
  readonly settleRetirement: (bundle: PlanBundle) => Promise<Result<PlanRetirementState | undefined, LoreError>>;
  /** Measures the batch's one full-suite run. */
  readonly measureSuite: (planRefs: readonly string[]) => Promise<SuiteRun | undefined>;
  /**
   * The files changed on main since `commit` (the review's assessed commit). The batch re-reviews a kept-open plan when one
   * of them is a file its failing facts name. Optional: absent, no landing can trigger a re-review (nothing is guessed).
   */
  readonly changedFilesSince?: (commit: string) => Promise<Result<readonly string[], LoreError>>;
  /** Judges one plan and stores the review. */
  readonly reviewPlan: (planRef: string, suite: SuiteRun | undefined) => Promise<Result<MilestoneReviewResult, LoreError>>;
  /** Archives the plan through the gated close (coverage reads the plan's known defects, each issue by number). */
  readonly closePlan: (planRef: string) => Promise<Result<void, LoreError>>;
  /**
   * Retries the issue writes earlier closes recorded as pending and records the outcome on a new audit row (BR-1510).
   * Runs FIRST in every batch, whichever plans it reviews; `undefined` when not wired (bare constructions).
   */
  readonly retryPendingIssueWrites?: () => Promise<Result<unknown, LoreError>>;
  /** Records an errored attempt as an audit row (never a review). */
  readonly recordError: (error: BatchErrorRecord) => Promise<Result<void, LoreError>>;
  readonly filing: IssueFilingService | undefined;
  readonly now: () => string;
  /**
   * `batch` (default, `--where`): a plan whose current review stands is skipped as "already reviewed". `direct` (plan ids given):
   * the plan is always judged again (BR-1379, BR-1511).
   */
  readonly mode?: "batch" | "direct";
}

/** One errored attempt, as stored in the audit row. */
export interface BatchErrorRecord {
  readonly planId: string;
  readonly planSlug: string;
  readonly fingerprint: string;
  readonly stage: "settle" | "review" | "filing" | "close";
  readonly message: string;
  readonly at: string;
}

/** One plan's outcome in a batch. */
export interface BatchPlanRow {
  readonly plan: string;
  /** `kept-open`: a gate failed or is not-measured; its issue is filed and the plan stays as it was (not an error). */
  readonly outcome: "accepted" | "accepted-with-known-defects" | "kept-open" | "awaiting-owner" | "error" | "skipped";
  readonly reviewed: boolean;
  readonly review?: string;
  readonly failed: readonly string[];
  readonly issues: readonly number[];
  readonly detail: string;
  readonly stage?: BatchErrorRecord["stage"];
  /** Set on a `skipped` row whose plan lease another holder had: who held it and until when (BR-1511). */
  readonly held?: { readonly holder: string; readonly expires_at: string };
}

/** The batch result: one row per selected plan (plus an error row when the pending-issue-write retry could not read). */
export interface BatchRun {
  readonly state: "ran";
  readonly suiteRuns: number;
  readonly rows: readonly BatchPlanRow[];
}

/**
 * True when the batch selected plans and every one of them was skipped because another holder had its lease: it ran
 * nothing, so its caller exits 75 rather than 0 (BR-1511).
 */
export function skippedEveryPlan(run: BatchRun, selected: number): boolean {
  return selected > 0 && run.rows.filter((row) => row.held !== undefined).length === selected;
}

function messageOf(error: LoreError): string {
  return "message" in error && typeof error.message === "string" ? error.message : error.code;
}

/** The trigger side: reads state, never writes (see the module header). */
export class ReviewTriggerService {
  constructor(private readonly deps: ReviewTriggerDeps) {}

  /**
   * The plans that need work now. Reads stored progress; computes no review.
   *
   * @returns entries in plan order; awaiting-owner plans (decision still pending) are excluded
   */
  async computeTriggerSet(): Promise<Result<TriggerEntry[], LoreError>> {
    const complete = await this.listCompletePlans();
    if (!complete.ok) return complete;
    const set: TriggerEntry[] = [];
    for (const entry of complete.value) {
      if (entry.need !== "awaiting-owner") set.push({ plan: entry.plan, need: entry.need });
    }
    return ok(set);
  }

  /**
   * Every complete, unarchived plan with what it needs next (awaiting-owner included) and when it became complete.
   * The ONE classification the trigger set, bootstrap's complete line and `lore checks stats` all read.
   *
   * @returns entries in plan order
   */
  async listCompletePlans(): Promise<Result<CompletePlanEntry[], LoreError>> {
    const plans = await this.deps.listPlans();
    if (!plans.ok) return plans;
    const pending = await this.deps.pendingDecisionSubjects();
    if (!pending.ok) return pending;
    const set: CompletePlanEntry[] = [];
    for (const plan of plans.value) {
      const progress = readStoredPlanProgress(plan.extra);
      if (progress === null || progress.state !== "complete" || plan.status === "archived" || plan.status === "deprecated") continue;
      const bundle = await this.deps.getPlanBundle(plan.id);
      if (!bundle.ok) return bundle;
      const facts = await planFactsOf(this.deps, bundle.value, progress.state, pending.value);
      if (!facts.ok) return facts;
      let need = classifyPlan(facts.value);
      if (need === "awaiting-owner" && this.deps.hasStaleOwnerDecision !== undefined) {
        // reason: a pending owner decision that no longer matches the plan's retired list is withdrawn by the batch's settle;
        // without this the plan never reaches settle and the stale question stays in `lore pending` (#354).
        const stale = await this.deps.hasStaleOwnerDecision(bundle.value);
        if (!stale.ok) return stale;
        if (stale.value) need = "owner-resolved";
      }
      if (need !== "none") set.push({ plan: plan.slug, planId: plan.id, need, completeAt: progress.at, ...(facts.value.unfileableReview !== undefined ? { reviewProblem: facts.value.unfileableReview } : {}) });
    }
    return ok(set);
  }

  /**
   * The landing's step: compute the trigger set; when non-empty take `batch:<machine>` with the store's atomic acquire and
   * start ONE detached batch holding it on the child's behalf (BR-1532). When another live holder has the key nothing is
   * started: that batch re-reads the trigger set after it releases, so it covers this landing. An empty set starts
   * nothing. No review runs here.
   *
   * Two landings at once: both acquire atomically, exactly one holds the key and spawns; the other is `covered`. The child
   * takes the lease over from the starter by compare-and-set (`ReviewLeases.acquireHandedOff`), so no instant exists where
   * the key is free between the starter and the child; a child that never starts leaves a lease whose holder is dead,
   * which the next landing takes at once (BR-1514) or at expiry.
   */
  async start(): Promise<Result<StartOutcome, LoreError>> {
    const set = await this.computeTriggerSet();
    if (!set.ok) return set;
    if (set.value.length === 0) return ok({ state: "empty" });
    const port = this.deps.batchLease;
    if (port === undefined) {
      // reason: an optional DI port, absent only in bare constructions (the repo's pattern: `app.ts` wires, a bare `new X(deps)` stays
      // unleased). The spawn receives `undefined` as its handoff and the production spawn (`spawnDetachedReviewBatch`) refuses it, so
      // a composition that forgot the port cannot start a batch; `lore integrate`'s wiring is asserted by review-machine-cap.test.ts.
      const spawned = await this.deps.spawnBatch(undefined);
      if (!spawned.ok) return spawned;
      return ok({ state: "started", triggered: set.value.length, pid: spawned.value.pid });
    }
    const machine = await port.machineId();
    const key = batchLeaseKey(machine);
    const machineUnknown = machine === UNKNOWN_MACHINE_ID;
    const taken = await port.acquire(key);
    if (!taken.ok) return taken;
    if (taken.value.state === "busy") {
      return ok({ state: "covered", triggered: set.value.length, key, machineUnknown, holder: taken.value.holder, expires_at: taken.value.expires_at });
    }
    const handle = taken.value.handle;
    let handedOff = false;
    try {
      // reason: the spawn registers the batch's child run before it returns (#501), so it is awaited
      const spawned = await this.deps.spawnBatch({ key, holder: handle.holder });
      if (!spawned.ok) return spawned;
      handle.handOff();
      handedOff = true;
      return ok({ state: "started", triggered: set.value.length, pid: spawned.value.pid, key, machineUnknown });
    } finally {
      // reason: a spawn that failed (or threw) started no batch, so the key must not stay held for 10 minutes.
      if (!handedOff) await handle.release();
    }
  }
}

/** The ports of a machine batch: the per-plan ports plus the batch lease and the trigger-set re-read. */
export interface MachineBatchPorts {
  readonly batch: BatchRunPorts;
  /** The batch lease this process holds on entry (taken by the starter's handoff or by a hand run). */
  readonly lease: LeaseHandle;
  /** Atomic re-take of the batch lease after a release; `busy` = another batch started and will see the plans. */
  readonly retakeLease: () => Promise<Result<LeaseOutcome, LoreError>>;
  /** The trigger set now, as plan slugs. */
  readonly readTriggerSet: () => Promise<Result<readonly string[], LoreError>>;
}

/** What {@link ReviewBatchRunner.runMachineBatch} did over all its passes. */
export interface MachineBatchRun extends BatchRun {
  readonly passes: number;
  /** Plans selected over all passes (the denominator of {@link skippedEveryPlan}). */
  readonly selected: number;
  /** `drained`: no plan was left to visit; `covered`: the re-take found another batch, which will see what is left. */
  readonly ended: "drained" | "covered";
  readonly coveredBy?: { readonly holder: string; readonly expires_at: string };
}

/** Stands for a plan whose bundle could not be read when its fingerprint was recorded; equal reads of it never loop. */
const UNREADABLE_FINGERPRINT = "unreadable";

/** The batch side: runs under the store lease (see the module header). */
export class ReviewBatchRunner {
  constructor(private readonly deps: ReviewRunDeps) {}

  /**
   * Runs the batch for `planRefs`: per plan, under that plan's lease (BR-1511), settle the owner decision, judge when no
   * valid review matches the current fingerprint, file by root cause when the review failed, then close. A plan whose
   * lease another holder has is skipped and named; the batch goes on to the next plan.
   *
   * @returns one row per plan (a held plan is a `skipped` row carrying `held`); an error only when the store fails
   */
  async runBatch(planRefs: readonly string[], ports: BatchRunPorts): Promise<Result<BatchRun, LoreError>> {
    return ok(await this.runPlans(planRefs, ports));
  }

  /**
   * The batch of a machine (BR-1532): runs `planRefs` under the batch lease the caller already holds, then releases the lease,
   * re-reads the trigger set and continues (re-taking the lease atomically) only for a plan not handled in this run or whose
   * plan-state fingerprint differs from the one recorded when it was handled.
   *
   * Termination: each plan's fingerprint is recorded BEFORE its pass; a plan held by another holder, or kept open with a
   * not-measured gate, stays in the trigger set but its fingerprint is unchanged, so it is not visited again; a further pass
   * therefore needs a landing (a changed fingerprint or a new plan) that happened during the run. A failed re-take means
   * another batch started and will see what is left. The lease is released on every exit path.
   *
   * @returns the rows of every pass; an error only when the trigger set cannot be read
   */
  async runMachineBatch(planRefs: readonly string[], ports: MachineBatchPorts): Promise<Result<MachineBatchRun, LoreError>> {
    const visited = new Map<string, string>();
    const rows: BatchPlanRow[] = [];
    let suiteRuns = 0;
    let passes = 0;
    let selected = 0;
    let lease = ports.lease;
    let refs: readonly string[] = planRefs;
    try {
      for (;;) {
        for (const ref of refs) visited.set(ref, await this.fingerprintOf(ref));
        const pass = await this.runPlans(refs, ports.batch);
        passes += 1;
        selected += refs.length;
        suiteRuns += pass.suiteRuns;
        rows.push(...pass.rows);
        // reason: the lease is released BEFORE the re-read, so a landing whose start attempt saw it live is always covered:
        // its plan state was stored before that attempt, hence is visible to the re-read below (BR-1532).
        await lease.release();
        const set = await ports.readTriggerSet();
        if (!set.ok) return set;
        const next: string[] = [];
        for (const slug of set.value) {
          const seen = visited.get(slug);
          if (seen === undefined || seen !== (await this.fingerprintOf(slug))) next.push(slug);
        }
        if (next.length === 0) return ok({ state: "ran", suiteRuns, rows, passes, selected, ended: "drained" });
        const retaken = await ports.retakeLease();
        if (!retaken.ok) return retaken;
        if (retaken.value.state === "busy") {
          return ok({ state: "ran", suiteRuns, rows, passes, selected, ended: "covered", coveredBy: { holder: retaken.value.holder, expires_at: retaken.value.expires_at } });
        }
        lease = retaken.value.handle;
        refs = next;
      }
    } finally {
      await lease.release();
    }
  }

  /** The plan-state fingerprint of `ref` now ({@link UNREADABLE_FINGERPRINT} when its bundle cannot be read). */
  private async fingerprintOf(ref: string): Promise<string> {
    const bundle = await this.deps.getPlanBundle(ref);
    return bundle.ok ? planStateFingerprint(bundle.value.plan, bundle.value.tasks, bundle.value.spec) : UNREADABLE_FINGERPRINT;
  }

  private async runPlans(planRefs: readonly string[], ports: BatchRunPorts): Promise<BatchRun> {
    const rows: BatchPlanRow[] = [];
    // reason: BR-1510 — a pending GitHub write of an earlier close is retried before anything else, so it never waits
    // on this batch's plans; a failed retry read is a visible row, never a silent drop.
    if (ports.retryPendingIssueWrites !== undefined) {
      const retried = await ports.retryPendingIssueWrites();
      if (!retried.ok) rows.push({ plan: "(pending issue writes)", outcome: "error", reviewed: false, failed: [], issues: [], detail: `retry: ${messageOf(retried.error)}` });
    }
    let suite: SuiteRun | undefined;
    let suiteRuns = 0;
    const measureOnce = async (): Promise<SuiteRun | undefined> => {
      if (suiteRuns === 0) {
        suiteRuns = 1;
        suite = await ports.measureSuite(planRefs);
      }
      return suite;
    };
    for (const ref of planRefs) rows.push(await this.runPlan(ref, ports, measureOnce));
    return { state: "ran", suiteRuns, rows };
  }

  /**
   * Whether a landing since the stored review re-opens it (a plan kept open by a gate the plan did not accept).
   *
   * @returns `true` when (b) regression is not-measured (the suite could not complete: the next batch retries) or (c) a file
   *   changed on main since the review's assessed commit is named by its failing facts; `false` otherwise (an unrelated
   *   landing, a clean review, an accepted gate). A review that predates `assessed_commit` is re-made once.
   */
  private async landingReopensReview(
    planSlug: string,
    review: MilestoneReview,
    plan: DocRecord,
    latest: { readonly doc: DocRecord; readonly review: MilestoneReview },
    ports: BatchRunPorts,
  ): Promise<Result<boolean, LoreError>> {
    const accepted = await acceptedGatesOf(plan, latest, this.deps.acceptanceLog);
    if (!accepted.ok) return accepted;
    const blockers = blockingGates(review.dimensions).filter((gate) => !accepted.value.includes(gate));
    if (blockers.length === 0) return ok(false);
    if (review.dimensions.regression.verdict === "not-measured") return ok(regressionRetryCanChange(review.regression_causes));
    const named = review.failing_fact_files ?? [];
    if (named.length === 0 || ports.changedFilesSince === undefined) return ok(false);
    if (review.assessed_commit === undefined) return ok(true);
    const changed = await ports.changedFilesSince(review.assessed_commit);
    if (!changed.ok) return err({ code: "STORE_ERROR", message: `plan ${planSlug}: could not read the files changed since ${review.assessed_commit}: ${messageOf(changed.error)}` });
    const touched = new Set(changed.value);
    return ok(named.some((file) => touched.has(file)));
  }

  /** Takes the plan's lease, runs the plan under it, releases it; a held plan is a `skipped` row naming the holder. */
  private async runPlan(ref: string, ports: BatchRunPorts, measureOnce: () => Promise<SuiteRun | undefined>): Promise<BatchPlanRow> {
    const resolved = await this.deps.getPlanBundle(ref);
    if (!resolved.ok) return { plan: ref, outcome: "error", reviewed: false, failed: [], issues: [], detail: messageOf(resolved.error) };
    const planSlug = resolved.value.plan.slug;
    const leased = await ports.acquirePlanLease(resolved.value.plan.id);
    if (!leased.ok) return { plan: planSlug, outcome: "error", reviewed: false, failed: [], issues: [], detail: `plan lease: ${messageOf(leased.error)}` };
    if (leased.value.state === "busy") {
      const held = { holder: leased.value.holder, expires_at: leased.value.expires_at };
      return { plan: planSlug, outcome: "skipped", reviewed: false, failed: [], issues: [], detail: `skipped: held by ${held.holder} until ${held.expires_at}`, held };
    }
    const handle = leased.value.handle;
    try {
      return await this.runPlanLeased(ref, ports, measureOnce, handle);
    } finally {
      await handle.release();
    }
  }

  private async runPlanLeased(ref: string, ports: BatchRunPorts, measureOnce: () => Promise<SuiteRun | undefined>, handle: LeaseHandle): Promise<BatchPlanRow> {
    // reason: BR-1511 — the plan is read AGAIN after its lease is acquired: another batch may have reviewed and archived it
    // between selection and now, and judging it a second time would write a second review document.
    const first = await this.deps.getPlanBundle(ref);
    if (!first.ok) return { plan: ref, outcome: "error", reviewed: false, failed: [], issues: [], detail: messageOf(first.error) };
    const planId = first.value.plan.id;
    const planSlug = first.value.plan.slug;
    if (first.value.plan.status === "archived" || first.value.plan.status === "deprecated") {
      return { plan: planSlug, outcome: "skipped", reviewed: false, failed: [], issues: [], detail: `skipped: already ${first.value.plan.status}` };
    }
    const lostRow = (reviewed: boolean): BatchPlanRow => ({ plan: planSlug, outcome: "error", reviewed, failed: [], issues: [], detail: messageOf(leaseLostError()) });
    // reason: BR-1511 fencing — before each write under the plan key (settle, review document, known-defect write, archive) the lease
    // is renewed; a renewal that fails (the row no longer names this holder) means nothing is written and the holder stops.
    const fenced = async (): Promise<boolean> => {
      if (handle.lost()) return false;
      const renewed = await handle.renewNow();
      return renewed.ok && renewed.value;
    };
    const direct = ports.mode === "direct";
    const fail = async (stage: BatchErrorRecord["stage"], fingerprint: string, error: LoreError, reviewed: boolean, review?: string): Promise<BatchPlanRow> => {
      const message = messageOf(error);
      await ports.recordError({ planId, planSlug, fingerprint, stage, message, at: ports.now() });
      return { plan: planSlug, outcome: "error", reviewed, ...(review !== undefined ? { review } : {}), failed: [], issues: [], detail: `${stage}: ${message}`, stage };
    };

    // reason: the owner's answer is carried out FIRST (a rejection restores ACs, which changes the fingerprint), so the
    // fingerprint compared below is the one the plan has after the restore.
    if (!(await fenced())) return lostRow(false);
    const settled = await ports.settleRetirement(first.value);
    if (!settled.ok) return fail("settle", planStateFingerprint(first.value.plan, first.value.tasks, first.value.spec), settled.error, false);
    const retirement = settled.value;
    const refreshed = await this.deps.getPlanBundle(ref);
    if (!refreshed.ok) return { plan: planSlug, outcome: "error", reviewed: false, failed: [], issues: [], detail: messageOf(refreshed.error) };
    const bundle = refreshed.value;
    const fingerprint = planStateFingerprint(bundle.plan, bundle.tasks, bundle.spec);

    const docs = await this.deps.listReviewDocs(planId);
    if (!docs.ok) return fail("review", fingerprint, docs.error, false);
    let latest = selectLatestMilestoneReview(docs.value);
    let reviewed = false;
    if (latest !== undefined && latest.review.fingerprint === fingerprint) {
      // reason: an unfileable stored review is recorded for THIS plan (audit row) and then re-judged, never retried as a filing forever (#349).
      const unfileable = unfileableReviewError(planSlug, latest.doc.slug, latest.review);
      if (unfileable !== undefined) {
        await ports.recordError({ planId, planSlug, fingerprint, stage: "review", message: messageOf(unfileable), at: ports.now() });
        latest = undefined;
      }
    }
    let coverFixed = false;
    // reason: the number of failed dimensions with no open linked issue; -1 when not read (no findings to file or retired ACs).
    let uncoveredCount = -1;
    if (latest !== undefined && latest.review.fingerprint === fingerprint && hasFindingsToFile(latest.review) && (latest.review.retired_acs?.length ?? 0) === 0) {
      const coverage = await this.deps.issueCoverage(planId, filableDimensions(latest.review.dimensions));
      if (!coverage.ok) return fail("review", fingerprint, coverage.error, false);
      coverFixed = coverage.value.fixed.length > 0 && !closedCoverAlreadyReviewed(docs.value, fingerprint);
      uncoveredCount = coverage.value.uncovered.length;
    }
    // reason: spec D1 / BR-1379 — the batch measures nothing per landing. A current review is re-made only on the three
    // triggers named in the module header; the decision reads the stored review, so it costs no suite run and no checkout.
    const planStateChanged = latest === undefined || latest.review.fingerprint !== fingerprint || coverFixed;
    let factsChanged = false;
    if (!planStateChanged && latest !== undefined) {
      const due = await this.landingReopensReview(planSlug, latest.review, bundle.plan, latest, ports);
      if (!due.ok) return fail("review", fingerprint, due.error, false);
      factsChanged = due.value;
    }
    // reason: BR-1511 — a BATCH skips a plan whose current review stands and has nothing left to do (kept open by a gate, every
    // finding already filed): the plan was reviewed just before this batch got its lease, and judging again would write a second
    // review document. A direct `lore assess <plan>` always reviews (BR-1379), so it never takes this skip.
    if (!direct && !planStateChanged && !factsChanged && latest !== undefined && uncoveredCount === 0 && (latest.review.retired_acs?.length ?? 0) === 0) {
      const accepted = await acceptedGatesOf(bundle.plan, latest, this.deps.acceptanceLog);
      if (!accepted.ok) return fail("review", fingerprint, accepted.error, false);
      const stillBlocked = blockingGates(latest.review.dimensions).filter((gate) => !accepted.value.includes(gate));
      if (stillBlocked.length > 0) {
        const waiting = await pendingAcceptancesOf(bundle.plan, latest, this.deps.acceptanceLog);
        if (!waiting.ok) return fail("review", fingerprint, waiting.error, false);
        return { plan: planSlug, outcome: "skipped", reviewed: false, review: latest.doc.slug, failed: filableDimensions(latest.review.dimensions), issues: [], detail: `skipped: already reviewed at the current state (${latest.doc.slug}); kept open by gate(s) ${stillBlocked.join(", ")}${pendingNote(waiting.value, stillBlocked)}` };
      }
    }
    if (planStateChanged || factsChanged || direct) {
      if (!(await fenced())) return lostRow(false);
      const suite = await measureOnce();
      const judged = await ports.reviewPlan(ref, suite);
      // reason: an errored review is recorded as an audit row, NOT a review: it does not count toward once-per-fingerprint.
      if (!judged.ok) return fail("review", fingerprint, judged.error, false);
      latest = { doc: judged.value.doc, review: judged.value.review };
      reviewed = true;
    }
    // reason: `planStateChanged` is true whenever `latest` is undefined, so a review exists here; the guard keeps the compiler honest.
    if (latest === undefined) return fail("review", fingerprint, { code: "STORE_ERROR", message: "no review exists after judging" }, reviewed);
    const review = latest.review;
    const retiredCount = review.retired_acs?.length ?? 0;
    if (retiredCount > 0 && retirement?.state === "pending") {
      return { plan: planSlug, outcome: "awaiting-owner", reviewed, review: latest.doc.slug, failed: filableDimensions(review.dimensions), issues: [], detail: `${String(retiredCount)} retired AC(s) await the owner (decision #${String(retirement.pendingId)})` };
    }
    const failed = filableDimensions(review.dimensions);
    const issues: number[] = [];
    if (failed.length > 0) {
      if (!(await fenced())) return lostRow(reviewed);
      if (ports.filing === undefined) {
        return fail("filing", fingerprint, { code: "VALIDATION_ERROR", field: "file-issues", message: "the review failed and needs issues filed, but this run does not file issues; run `lore assess` with --file-issues to file them", rule: "BR-1379" }, reviewed, latest.doc.slug);
      }
      const findings: FailedFinding[] = failed.map((dimension) => ({
        plan: planSlug,
        dimension,
        reason: review.dimensions[dimension].reason,
        reference: review.dimensions[dimension].reference,
        cites: review.dimensions[dimension].cites,
        reviewSlug: latest.doc.slug,
        causes: review.causes,
      }));
      const filed = await ports.filing.fileFindings(findings, fenced);
      if (!filed.ok) return fail("filing", fingerprint, filed.error, reviewed, latest.doc.slug);
      const broken = filed.value.find((g) => g.error !== undefined);
      if (broken?.error !== undefined) return fail("filing", fingerprint, broken.error, reviewed, latest.doc.slug);
      for (const group of filed.value) if (group.issue !== undefined) issues.push(group.issue.number);
    }
    // reason: spec "Verdict and close" — a gate that failed or is not-measured keeps the plan open (its issue is filed above);
    // only a gate the plan accepted with a decision (`lore assess --accept-gate`, a gate_accepted known defect) may close.
    const acceptedGates = await acceptedGatesOf(bundle.plan, latest, this.deps.acceptanceLog);
    if (!acceptedGates.ok) return fail("close", fingerprint, acceptedGates.error, reviewed, latest.doc.slug);
    const blockers = blockingGates(review.dimensions).filter((gate) => !acceptedGates.value.includes(gate));
    const issueNumbers = [...new Set(issues)].sort((a, b) => a - b);
    if (blockers.length > 0) {
      const waiting = await pendingAcceptancesOf(bundle.plan, latest, this.deps.acceptanceLog);
      if (!waiting.ok) return fail("close", fingerprint, waiting.error, reviewed, latest.doc.slug);
      return {
        plan: planSlug,
        outcome: "kept-open",
        reviewed,
        review: latest.doc.slug,
        failed,
        issues: issueNumbers,
        detail: `kept open: gate(s) ${blockers.map((g) => `${g} ${review.dimensions[g].verdict}`).join(", ")} (a gate is accepted only with \`lore assess ${planSlug} --accept-gate <dimension>\` and a decision; an agent's acceptance waits for a human)${pendingNote(waiting.value, blockers)}`,
      };
    }
    if (!(await fenced())) return lostRow(reviewed);
    const closed = await ports.closePlan(ref);
    if (!closed.ok) return fail("close", fingerprint, closed.error, reviewed, latest.doc.slug);
    return {
      plan: planSlug,
      outcome: failed.length === 0 ? "accepted" : "accepted-with-known-defects",
      reviewed,
      review: latest.doc.slug,
      failed,
      issues: issueNumbers,
      detail: failed.length === 0 ? "accepted" : `accepted with known defects: ${failed.join(", ")}`,
    };
  }
}

/** "; acceptance pending <id> (<gate>)" for each blocking gate whose acceptance waits for a human; "" when none. */
function pendingNote(pending: ReadonlyMap<string, number>, blockers: readonly string[]): string {
  const parts = blockers.filter((gate) => pending.has(gate)).map((gate) => `acceptance pending ${String(pending.get(gate))} (${gate})`);
  return parts.length === 0 ? "" : `; ${parts.join("; ")}`;
}

/** The facts {@link classifyPlan} decides from, read from the plan's current state. */
async function planFactsOf(
  deps: Pick<ReviewTriggerDeps, "listReviewDocs" | "issueCoverage">,
  bundle: PlanBundle,
  progressState: "in-progress" | "complete" | "empty",
  pending: ReadonlySet<string>,
): Promise<Result<PlanReviewFacts, LoreError>> {
  {
    const fingerprint = planStateFingerprint(bundle.plan, bundle.tasks, bundle.spec);
    const docs = await deps.listReviewDocs(bundle.plan.id);
    if (!docs.ok) return docs;
    const latest = selectLatestMilestoneReview(docs.value);
    const base = { status: bundle.plan.status, progressState, fingerprint, ownerPending: pending.has(retirementSubjectId(bundle.plan.slug)) };
    if (latest === undefined) return ok({ ...base, filingIncomplete: false, coveringIssueFixed: false });
    let filingIncomplete = false;
    let coveringIssueFixed = false;
    let unfileableReview: string | undefined;
    if (latest.review.fingerprint === fingerprint && hasFindingsToFile(latest.review)) {
      const unfileable = unfileableReviewError(bundle.plan.slug, latest.doc.slug, latest.review);
      if (unfileable !== undefined) unfileableReview = messageOf(unfileable);
      else {
        const coverage = await deps.issueCoverage(bundle.plan.id, filableDimensions(latest.review.dimensions));
        if (!coverage.ok) return coverage;
        filingIncomplete = coverage.value.uncovered.length > 0;
        coveringIssueFixed = coverage.value.fixed.length > 0 && !closedCoverAlreadyReviewed(docs.value, fingerprint);
      }
    }
    return ok({
      ...base,
      latest: { fingerprint: latest.review.fingerprint, overall: hasFindingsToFile(latest.review) ? "fail" : "pass", retiredCount: latest.review.retired_acs?.length ?? 0 },
      filingIncomplete,
      coveringIssueFixed,
      ...(unfileableReview !== undefined ? { unfileableReview } : {}),
    });
  }
}

/**
 * True when the plan was already re-reviewed at `fingerprint` (two or more valid reviews of that fingerprint: the first
 * verdict and a re-review it caused).
 *
 * reason: bounds the closed-cover loop (#397). A plan re-enters review for a closed covering issue once per
 * fingerprint; if that re-review still fails and its filing then fails, the next batch retries the filing only. Without
 * this, every batch re-judged the plan because the failed dimension's only linked issue stayed closed.
 */
function closedCoverAlreadyReviewed(docs: readonly DocRecord[], fingerprint: string): boolean {
  let atFingerprint = 0;
  for (const doc of docs) {
    if (doc.type !== "knowledge" || doc.deleted_at !== null || doc.extra["sub_type"] !== MILESTONE_REVIEW_SUB_TYPE) continue;
    const parsed = milestoneReviewSchema.safeParse(doc.extra["milestone_review"]);
    if (parsed.success && parsed.data.fingerprint === fingerprint) atFingerprint += 1;
  }
  return atFingerprint >= 2;
}

/**
 * True when the review has something to file: a failed dimension or a not-measured gate. This, not `overall`, is what the
 * batch reads as "fail" (`PlanReviewFacts.latest.overall`): a not-measured gate leaves `overall` at pass but holds the plan open.
 */
function hasFindingsToFile(review: MilestoneReview): boolean {
  return review.overall === "fail" || filableDimensions(review.dimensions).length > 0;
}

/** The root-cause results of a stored review's failed dimensions, one per dimension. */
function causesOfReview(planSlug: string, reviewSlug: string, review: MilestoneReview): Result<RootCause, LoreError>[] {
  return filableDimensions(review.dimensions).map((dimension) =>
    rootCauseOf({ plan: planSlug, dimension, reason: review.dimensions[dimension].reason, reference: review.dimensions[dimension].reference, cites: review.dimensions[dimension].cites, reviewSlug, causes: review.causes }),
  );
}

/**
 * The reason a stored review cannot be filed (a failed regression without `suite_failing_files`), or `undefined`.
 * Per-plan by construction: the filing site keeps its loud error; classification only turns it into "needs review".
 */
export function unfileableReviewError(planSlug: string, reviewSlug: string, review: MilestoneReview): LoreError | undefined {
  for (const cause of causesOfReview(planSlug, reviewSlug, review)) if (!cause.ok) return cause.error;
  return undefined;
}
