/**
 * ReviewBatchService (ReviewTriggerService + ReviewBatchRunner) — the trigger set after a landing and the batch that turns complete plans into accepted ones
 * (spec-plans-close-themselves-level-triggered-reconciliation-of, BR-1379).
 *
 * Purpose: (1) {@link ReviewTriggerService.computeTriggerSet}: from stored plan progress, the complete plans that need a
 *   review, a retry of their issue filing, a close, or an owner-resolved settle; (2) {@link ReviewTriggerService.start}:
 *   the landing's one cheap question "is there work and no live lease" answered by starting ONE detached batch;
 *   (3) {@link ReviewBatchRunner.runBatch}: the batch itself, under the store lease.
 * Public surface: {@link classifyPlan}, {@link PlanReviewNeed}, {@link ReviewTriggerDeps}, {@link ReviewRunDeps}, {@link ReviewTriggerService}, {@link ReviewBatchRunner},
 *   {@link BatchPlanRow}, {@link BATCH_ERROR_AUDIT_ACTION}.
 * Invariants:
 *   - Level-triggered: a plan is in the trigger set because of its CURRENT state (complete, not archived, and its
 *     latest valid review does not match the current fingerprint / its filing or close is unfinished / its owner
 *     decision is resolved), never because of an event.
 *   - Awaiting owner (a current review lists retired ACs and the decision is still pending) is NOT in the set; the
 *     plan stays complete, not archived, and is not an anomaly.
 *   - Each plan is judged at most once per fingerprint: a review row at the current fingerprint is never re-judged;
 *     an errored attempt is an audit row (`milestone-batch-error`), not a review, so it does not count and the next
 *     batch judges the plan again. The audit row never touches the plan's version or fingerprint.
 *   - A filing error keeps the stored verdict: the plan stays complete and the next batch retries only the filing.
 *   - The full suite is measured at most once per batch, and only when a plan actually needs a judgment.
 *   - A pass archives as accepted; a fail archives as accepted with known defects after its findings are filed by
 *     root cause (BR-1372 plan close reads the linked open issues); retired ACs wait for the one owner decision.
 *   - The landing never waits for a review: {@link ReviewTriggerService.start} only reads state and spawns.
 * Side-effect class: IO through injected ports (services never import each other; the CLI adapter binds the real ones).
 *
 * Reference: GitHub merge queue (one batched check run for many queued items).
 * @spec_ref spec-plans-close-themselves-level-triggered-reconciliation-of (AC-PCR-3, AC-PCR-4, AC-PCR-5, BR-1379)
 */

import { failedDimensions, ok, type DocRecord, type LoreError, type PlanBundle, type Result } from "@lore/core";
import { readStoredPlanProgress } from "../store/plan-progress.js";
import { planStateFingerprint, selectLatestMilestoneReview, type PlanRetirementState } from "./milestone-review.js";
import type { MilestoneReviewResult } from "./milestone-review-service.js";
import type { SuiteRun } from "./milestone-review-inputs.js";
import { retirementSubjectId } from "./retired-ac-service.js";
import type { IssueFilingService } from "./issue-filing-service.js";
import { fingerprintTag, rootCauseOf, type FailedFinding } from "./root-cause-fingerprint.js";
import { leaseLostError, type LeaseHandle, type LeaseOutcome } from "./review-batch-lease.js";

/** The audit action of an errored batch attempt: not a review, never counted toward once-per-fingerprint. */
export const BATCH_ERROR_AUDIT_ACTION = "milestone-batch-error";

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
  if (facts.latest.retiredCount > 0) return facts.ownerPending ? "awaiting-owner" : "owner-resolved";
  if (facts.latest.overall === "fail" && facts.filingIncomplete) return "filing";
  return "close";
}

/** The ports the batch itself reads through (the runner never decides what is in the trigger set). */
export type ReviewRunDeps = Pick<ReviewTriggerDeps, "getPlanBundle" | "listReviewDocs">;

/** The ports the trigger side reads through and the landing's start writes through (a spawn). */
export interface ReviewTriggerDeps {
  /** Every live plan. */
  readonly listPlans: () => Promise<Result<DocRecord[], LoreError>>;
  readonly getPlanBundle: (planRef: string) => Promise<Result<PlanBundle, LoreError>>;
  /** The plan's knowledge docs of sub_type milestone-review. */
  readonly listReviewDocs: (planId: string) => Promise<Result<DocRecord[], LoreError>>;
  /** Subject ids with an open pending decision (pure read; nothing is appended). */
  readonly pendingDecisionSubjects: () => Promise<Result<ReadonlySet<string>, LoreError>>;
  /** Titles of the OPEN issues linked (`resolves`) to the plan. */
  readonly linkedOpenIssueTitles: (planId: string) => Promise<Result<string[], LoreError>>;
  /** True when a live lease is held (reads only). */
  readonly isLeaseLive: () => Promise<Result<boolean, LoreError>>;
  /** Starts the detached batch process; returns once it is spawned (never waits for it). */
  readonly spawnBatch: () => Result<{ readonly pid: number | undefined }, LoreError>;
}

/** The trigger set: the plans that need work, with what they need. */
export interface TriggerEntry {
  readonly plan: string;
  readonly need: Exclude<PlanReviewNeed, "none" | "awaiting-owner">;
}

/** What the landing's start did. */
export type StartOutcome =
  | { readonly state: "empty" }
  | { readonly state: "lease-live"; readonly triggered: number }
  | { readonly state: "started"; readonly triggered: number; readonly pid: number | undefined };

/** The ports `runBatch` drives. */
export interface BatchRunPorts {
  readonly acquireLease: () => Promise<Result<LeaseOutcome, LoreError>>;
  /** Carries out an answered owner decision and raises the one pending decision; `undefined` when not wired. */
  readonly settleRetirement: (bundle: PlanBundle) => Promise<Result<PlanRetirementState | undefined, LoreError>>;
  /** Measures the batch's one full-suite run. */
  readonly measureSuite: (planRefs: readonly string[]) => Promise<SuiteRun | undefined>;
  /** Judges one plan and stores the review. */
  readonly reviewPlan: (planRef: string, suite: SuiteRun | undefined) => Promise<Result<MilestoneReviewResult, LoreError>>;
  /** Archives the plan through the gated close. */
  readonly closePlan: (planRef: string) => Promise<Result<void, LoreError>>;
  /** Records an errored attempt as an audit row (never a review). */
  readonly recordError: (error: BatchErrorRecord) => Promise<Result<void, LoreError>>;
  readonly filing: IssueFilingService | undefined;
  readonly now: () => string;
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
  readonly outcome: "accepted" | "accepted-with-known-defects" | "awaiting-owner" | "error" | "skipped";
  readonly reviewed: boolean;
  readonly review?: string;
  readonly failed: readonly string[];
  readonly issues: readonly number[];
  readonly detail: string;
  readonly stage?: BatchErrorRecord["stage"];
}

/** The batch result. */
export type BatchRun =
  | { readonly state: "busy"; readonly holder: string; readonly expires_at: string }
  | { readonly state: "ran"; readonly tookOver: boolean; readonly suiteRuns: number; readonly rows: readonly BatchPlanRow[] };

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
    const plans = await this.deps.listPlans();
    if (!plans.ok) return plans;
    const pending = await this.deps.pendingDecisionSubjects();
    if (!pending.ok) return pending;
    const set: TriggerEntry[] = [];
    for (const plan of plans.value) {
      const progress = readStoredPlanProgress(plan.extra);
      if (progress === null || progress.state !== "complete" || plan.status === "archived" || plan.status === "deprecated") continue;
      const bundle = await this.deps.getPlanBundle(plan.id);
      if (!bundle.ok) return bundle;
      const facts = await planFactsOf(this.deps, bundle.value, progress.state, pending.value);
      if (!facts.ok) return facts;
      const need = classifyPlan(facts.value);
      if (need !== "none" && need !== "awaiting-owner") set.push({ plan: plan.slug, need });
    }
    return ok(set);
  }

  /**
   * The landing's step: compute the trigger set; when non-empty and no lease is live, start ONE detached batch and
   * return. An empty set or a live lease starts nothing. No review runs here.
   */
  async start(): Promise<Result<StartOutcome, LoreError>> {
    const set = await this.computeTriggerSet();
    if (!set.ok) return set;
    if (set.value.length === 0) return ok({ state: "empty" });
    const live = await this.deps.isLeaseLive();
    if (!live.ok) return live;
    if (live.value) return ok({ state: "lease-live", triggered: set.value.length });
    const spawned = this.deps.spawnBatch();
    if (!spawned.ok) return spawned;
    return ok({ state: "started", triggered: set.value.length, pid: spawned.value.pid });
  }
}

/** The batch side: runs under the store lease (see the module header). */
export class ReviewBatchRunner {
  constructor(private readonly deps: ReviewRunDeps) {}

  /**
   * Runs the batch for `planRefs` under the store lease: per plan settle the owner decision, judge when no valid
   * review matches the current fingerprint, file by root cause when the review failed, then close.
   *
   * @returns `busy` when another live batch holds the lease (nothing ran); otherwise one row per plan
   */
  async runBatch(planRefs: readonly string[], ports: BatchRunPorts): Promise<Result<BatchRun, LoreError>> {
    const leased = await ports.acquireLease();
    if (!leased.ok) return leased;
    if (leased.value.state === "busy") return ok({ state: "busy", holder: leased.value.holder, expires_at: leased.value.expires_at });
    const handle = leased.value.handle;
    try {
      return ok(await this.runUnderLease(planRefs, ports, handle, leased.value.tookOver));
    } finally {
      await handle.release();
    }
  }

  private async runUnderLease(planRefs: readonly string[], ports: BatchRunPorts, handle: LeaseHandle, tookOver: boolean): Promise<BatchRun> {
    const rows: BatchPlanRow[] = [];
    let suite: SuiteRun | undefined;
    let suiteRuns = 0;
    const measureOnce = async (): Promise<SuiteRun | undefined> => {
      if (suiteRuns === 0) {
        suiteRuns = 1;
        suite = await ports.measureSuite(planRefs);
      }
      return suite;
    };
    for (const ref of planRefs) {
      if (handle.lost()) {
        rows.push({ plan: ref, outcome: "error", reviewed: false, failed: [], issues: [], detail: messageOf(leaseLostError()) });
        continue;
      }
      rows.push(await this.runPlan(ref, ports, measureOnce));
    }
    return { state: "ran", tookOver, suiteRuns, rows };
  }

  private async runPlan(ref: string, ports: BatchRunPorts, measureOnce: () => Promise<SuiteRun | undefined>): Promise<BatchPlanRow> {
    const first = await this.deps.getPlanBundle(ref);
    if (!first.ok) return { plan: ref, outcome: "error", reviewed: false, failed: [], issues: [], detail: messageOf(first.error) };
    const planId = first.value.plan.id;
    const planSlug = first.value.plan.slug;
    const fail = async (stage: BatchErrorRecord["stage"], fingerprint: string, error: LoreError, reviewed: boolean, review?: string): Promise<BatchPlanRow> => {
      const message = messageOf(error);
      await ports.recordError({ planId, planSlug, fingerprint, stage, message, at: ports.now() });
      return { plan: planSlug, outcome: "error", reviewed, ...(review !== undefined ? { review } : {}), failed: [], issues: [], detail: `${stage}: ${message}`, stage };
    };

    // reason: the owner's answer is carried out FIRST (a rejection restores ACs, which changes the fingerprint), so the
    // fingerprint compared below is the one the plan has after the restore.
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
    if (latest === undefined || latest.review.fingerprint !== fingerprint) {
      const suite = await measureOnce();
      const judged = await ports.reviewPlan(ref, suite);
      // reason: an errored review is recorded as an audit row, NOT a review: it does not count toward once-per-fingerprint.
      if (!judged.ok) return fail("review", fingerprint, judged.error, false);
      latest = { doc: judged.value.doc, review: judged.value.review };
      reviewed = true;
    }
    const review = latest.review;
    const retiredCount = review.retired_acs?.length ?? 0;
    if (retiredCount > 0 && retirement?.state === "pending") {
      return { plan: planSlug, outcome: "awaiting-owner", reviewed, review: latest.doc.slug, failed: failedDimensions(review.dimensions), issues: [], detail: `${String(retiredCount)} retired AC(s) await the owner (decision #${String(retirement.pendingId)})` };
    }
    const failed = failedDimensions(review.dimensions);
    const issues: number[] = [];
    if (review.overall === "fail") {
      if (ports.filing === undefined) {
        return fail("filing", fingerprint, { code: "VALIDATION_ERROR", field: "feedback.upstream", message: "the review failed and needs issues filed, but no issue tracker is configured (feedback.upstream.repo)", rule: "BR-1379" }, reviewed, latest.doc.slug);
      }
      const findings: FailedFinding[] = failed.map((dimension) => ({
        plan: planSlug,
        dimension,
        reason: review.dimensions[dimension].reason,
        reference: review.dimensions[dimension].reference,
        reviewSlug: latest.doc.slug,
        causes: review.causes,
      }));
      const filed = await ports.filing.fileFindings(findings);
      if (!filed.ok) return fail("filing", fingerprint, filed.error, reviewed, latest.doc.slug);
      const broken = filed.value.find((g) => g.error !== undefined);
      if (broken?.error !== undefined) return fail("filing", fingerprint, broken.error, reviewed, latest.doc.slug);
      for (const group of filed.value) if (group.issue !== undefined) issues.push(group.issue.number);
    }
    const closed = await ports.closePlan(ref);
    if (!closed.ok) return fail("close", fingerprint, closed.error, reviewed, latest.doc.slug);
    return {
      plan: planSlug,
      outcome: review.overall === "pass" ? "accepted" : "accepted-with-known-defects",
      reviewed,
      review: latest.doc.slug,
      failed,
      issues: [...new Set(issues)].sort((a, b) => a - b),
      detail: review.overall === "pass" ? "accepted" : `accepted with known defects: ${failed.join(", ")}`,
    };
  }
}

/** The facts {@link classifyPlan} decides from, read from the plan's current state. */
async function planFactsOf(
  deps: Pick<ReviewTriggerDeps, "listReviewDocs" | "linkedOpenIssueTitles">,
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
    if (latest === undefined) return ok({ ...base, filingIncomplete: false });
    let filingIncomplete = false;
    if (latest.review.fingerprint === fingerprint && latest.review.overall === "fail") {
      const titles = await deps.linkedOpenIssueTitles(bundle.plan.id);
      if (!titles.ok) return titles;
      const needed = failedDimensions(latest.review.dimensions).map((dimension) =>
        fingerprintTag(rootCauseOf({ plan: bundle.plan.slug, dimension, reason: latest.review.dimensions[dimension].reason, reference: latest.review.dimensions[dimension].reference, reviewSlug: latest.doc.slug, causes: latest.review.causes }).short),
      );
      filingIncomplete = needed.some((tag) => !titles.value.some((t) => t.includes(tag)));
    }
    return ok({
      ...base,
      latest: { fingerprint: latest.review.fingerprint, overall: latest.review.overall, retiredCount: latest.review.retired_acs?.length ?? 0 },
      filingIncomplete,
    });
  }
}
