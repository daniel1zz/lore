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
 *   - Each plan is assessed through the ONE close function when {@link BatchRunPorts.closeFlow} is wired (BR-1507, AC-DCS2-11): the batch
 *     keeps the store lease and the once-per-batch suite (BR-1379), the close function holds the plan's own lease and runs verify, rule
 *     apply, the anchor check and the P0 UAT gate before the runner's review, filing and gated archive.
 * Side-effect class: IO through injected ports (services never import each other; the CLI adapter binds the real ones).
 *
 * Reference: GitHub merge queue (one batched check run for many queued items).
 * @spec_ref spec-plans-close-themselves-level-triggered-reconciliation-of (AC-PCR-3, AC-PCR-4, AC-PCR-5, BR-1379)
 */

import { acceptedGatesOf } from "./gate-acceptance-service.js";
import { blockingGates, err, filableDimensions, milestoneReviewSchema, ok, regressionRetryCanChange, type DocRecord, type LoreError, type MilestoneReview, type PlanBundle, type Result } from "@lore/core";
import { readStoredPlanProgress } from "../store/plan-progress.js";
import { MILESTONE_REVIEW_SUB_TYPE, planStateFingerprint, selectLatestMilestoneReview, type PlanRetirementState } from "./milestone-review.js";
import type { MilestoneReviewResult } from "./milestone-review-service.js";
import type { SuiteRun } from "./milestone-review-inputs.js";
import { retirementSubjectId } from "./retired-ac-service.js";
import type { IssueFilingService } from "./issue-filing-service.js";
import type { DimensionCoverage } from "./milestone-review-inputs.js";
import { rootCauseOf, type FailedFinding, type RootCause } from "./root-cause-fingerprint.js";
import { leaseLostError, type LeaseHandle, type LeaseOutcome } from "./review-batch-lease.js";

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
export type ReviewRunDeps = Pick<ReviewTriggerDeps, "getPlanBundle" | "listReviewDocs" | "issueCoverage">;

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
  /** True when a live lease is held (reads only). */
  readonly isLeaseLive: () => Promise<Result<boolean, LoreError>>;
  /** Starts the detached batch process; returns once it is spawned (never waits for it). */
  readonly spawnBatch: () => Result<{ readonly pid: number | undefined }, LoreError> | Promise<Result<{ readonly pid: number | undefined }, LoreError>>;
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
  /**
   * The files changed on main since `commit` (the review's assessed commit). The batch re-reviews a kept-open plan when one
   * of them is a file its failing facts name. Optional: absent, no landing can trigger a re-review (nothing is guessed).
   */
  readonly changedFilesSince?: (commit: string) => Promise<Result<readonly string[], LoreError>>;
  /** Judges one plan and stores the review. */
  readonly reviewPlan: (planRef: string, suite: SuiteRun | undefined) => Promise<Result<MilestoneReviewResult, LoreError>>;
  /** Archives the plan through the gated close (coverage reads the plan's known defects, each issue by number). */
  readonly closePlan: (planRef: string) => Promise<Result<void, LoreError>>;
  /** Records an errored attempt as an audit row (never a review). */
  readonly recordError: (error: BatchErrorRecord) => Promise<Result<void, LoreError>>;
  readonly filing: IssueFilingService | undefined;
  readonly now: () => string;
  /**
   * The ONE close function (`PlanCloseService.close`, BR-1507) around one plan's assess: it refuses a plan with an open task, holds the
   * plan's own lease, runs verify, rule apply, the anchor check and the P0 UAT gate, then calls `assess` — the runner's own review,
   * filing and gated archive of that plan — and returns its row (or a row saying why the plan stayed open or was left to another close).
   * Optional (absent = the runner assesses and archives directly, as a bare construction does).
   */
  readonly closeFlow?: (ref: string, assess: () => Promise<BatchPlanRow>) => Promise<BatchPlanRow>;
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
    // reason: the spawn registers the batch's child run before it returns (#501), so it is awaited
    const spawned = await this.deps.spawnBatch();
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
      const assess = (): Promise<BatchPlanRow> => this.runPlan(ref, ports, measureOnce);
      rows.push(ports.closeFlow === undefined ? await assess() : await ports.closeFlow(ref, assess));
    }
    return { state: "ran", tookOver, suiteRuns, rows };
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
    const accepted = acceptedGatesOf(plan, latest);
    const blockers = blockingGates(review.dimensions).filter((gate) => !accepted.includes(gate));
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
    if (latest !== undefined && latest.review.fingerprint === fingerprint) {
      // reason: an unfileable stored review is recorded for THIS plan (audit row) and then re-judged, never retried as a filing forever (#349).
      const unfileable = unfileableReviewError(planSlug, latest.doc.slug, latest.review);
      if (unfileable !== undefined) {
        await ports.recordError({ planId, planSlug, fingerprint, stage: "review", message: messageOf(unfileable), at: ports.now() });
        latest = undefined;
      }
    }
    let coverFixed = false;
    if (latest !== undefined && latest.review.fingerprint === fingerprint && hasFindingsToFile(latest.review) && (latest.review.retired_acs?.length ?? 0) === 0) {
      const coverage = await this.deps.issueCoverage(planId, filableDimensions(latest.review.dimensions));
      if (!coverage.ok) return fail("review", fingerprint, coverage.error, false);
      coverFixed = coverage.value.fixed.length > 0 && !closedCoverAlreadyReviewed(docs.value, fingerprint);
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
    if (planStateChanged || factsChanged) {
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
      if (ports.filing === undefined) {
        return fail("filing", fingerprint, { code: "VALIDATION_ERROR", field: "feedback.upstream", message: "the review failed and needs issues filed, but no issue tracker is configured (feedback.upstream.repo)", rule: "BR-1379" }, reviewed, latest.doc.slug);
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
      const filed = await ports.filing.fileFindings(findings);
      if (!filed.ok) return fail("filing", fingerprint, filed.error, reviewed, latest.doc.slug);
      const broken = filed.value.find((g) => g.error !== undefined);
      if (broken?.error !== undefined) return fail("filing", fingerprint, broken.error, reviewed, latest.doc.slug);
      for (const group of filed.value) if (group.issue !== undefined) issues.push(group.issue.number);
    }
    // reason: spec "Verdict and close" — a gate that failed or is not-measured keeps the plan open (its issue is filed above);
    // only a gate the plan accepted with a decision (`lore assess --accept-gate`, a gate_accepted known defect) may close.
    const acceptedGates = acceptedGatesOf(bundle.plan, latest);
    const blockers = blockingGates(review.dimensions).filter((gate) => !acceptedGates.includes(gate));
    const issueNumbers = [...new Set(issues)].sort((a, b) => a - b);
    if (blockers.length > 0) {
      return {
        plan: planSlug,
        outcome: "kept-open",
        reviewed,
        review: latest.doc.slug,
        failed,
        issues: issueNumbers,
        detail: `kept open: gate(s) ${blockers.map((g) => `${g} ${review.dimensions[g].verdict}`).join(", ")} (a gate is accepted only with \`lore assess ${planSlug} --accept-gate <dimension>\` and a decision)`,
      };
    }
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
