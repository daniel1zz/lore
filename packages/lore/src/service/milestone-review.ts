/**
 * Milestone review currency: which stored review binds a plan's close, and whether it is current and passing.
 *
 * Purpose: the pure half of BR-1372. `lore assess` stores a review carrying the plan-state fingerprint it judged;
 *   plan close recomputes the fingerprint and compares.
 * Public surface: planStateFingerprint, latestLandingCommit, CitedRuleStateRow, selectLatestMilestoneReview, assessMilestoneCurrency,
 *   MilestoneReviewCurrency, MILESTONE_REVIEW_SUB_TYPE.
 * Invariants:
 *   - Fingerprint = plan id@version, every task id@version (sorted by id), and the main commit that last landed one of
 *     the tasks (the `extra.landing.landing_commit` with the newest `recorded_at`; `none` when no task has a landing).
 *     Any plan edit, task edit, evidence write, or a newer landing therefore makes the stored review not current.
 *   - A review whose `extra.milestone_review` does not parse is not a review (never read as pass).
 * Side-effect class: pure (no store, no IO, no clock).
 *
 * @spec_ref spec-lean-governance-batch-verbs-judgment-only-at-milestones (Part D, AC-LG-12, BR-1372)
 */

import { failedDimensions, milestoneReviewSchema, type DocRecord, type MilestoneDimension, type MilestoneReview } from "@lore/core";
import { readTaskLanding } from "./task-commit-range.js";

/** `extra.sub_type` of the knowledge doc that stores a review. */
export const MILESTONE_REVIEW_SUB_TYPE = "milestone-review";

/** The main commit that last landed one of `tasks`, or `none`. */
export function latestLandingCommit(tasks: readonly Pick<DocRecord, "extra">[]): string {
  let newest: { at: string; commit: string } | undefined;
  for (const task of tasks) {
    const landing = readTaskLanding(task.extra);
    if (landing === undefined) continue;
    if (newest === undefined || landing.recorded_at > newest.at) newest = { at: landing.recorded_at, commit: landing.landing_commit };
  }
  return newest?.commit ?? "none";
}

/**
 * The plan's current state as one comparable string.
 *
 * @param plan - the plan (id, version)
 * @param tasks - every member task (id, version, extra for the landing)
 * @example
 * planStateFingerprint({ id: "P", version: 3 }, [{ id: "T1", version: 2, extra: {} }]); // => "plan:P@3|tasks:T1@2|landed:none"
 */
export function planStateFingerprint(
  plan: Pick<DocRecord, "id" | "version">,
  tasks: readonly Pick<DocRecord, "id" | "version" | "extra">[],
): string {
  const taskPart = [...tasks]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((t) => `${t.id}@${String(t.version)}`)
    .join(",");
  return `plan:${plan.id}@${String(plan.version)}|tasks:${taskPart}|landed:${latestLandingCommit(tasks)}`;
}

/** The newest parsable review among `docs` (knowledge docs informs-linked to the plan), by `created_at`. */
export function selectLatestMilestoneReview(
  docs: readonly DocRecord[],
): { readonly doc: DocRecord; readonly review: MilestoneReview } | undefined {
  let best: { doc: DocRecord; review: MilestoneReview } | undefined;
  for (const doc of docs) {
    if (doc.type !== "knowledge" || doc.deleted_at !== null || doc.extra["sub_type"] !== MILESTONE_REVIEW_SUB_TYPE) continue;
    const parsed = milestoneReviewSchema.safeParse(doc.extra["milestone_review"]);
    if (!parsed.success) continue;
    if (best === undefined || doc.created_at > best.doc.created_at) best = { doc, review: parsed.data };
  }
  return best;
}

/** What plan close learns from the stored reviews. */
export type MilestoneReviewCurrency =
  | { readonly state: "no-tasks" }
  | { readonly state: "absent" }
  | { readonly state: "stale"; readonly reviewed: string; readonly current: string; readonly reviewSlug: string }
  | { readonly state: "failed"; readonly failed: readonly MilestoneDimension[]; readonly reviewSlug: string }
  | { readonly state: "pass"; readonly reviewSlug: string }
  /**
   * Current review fails, but every failed dimension has an OPEN linked issue (Part D, "accepted with known defects").
   * Never produced by `assessMilestoneCurrency` (pure, no issue facts): `CorpusService.set` upgrades `failed` to this
   * after reading the linked issues.
   */
  | {
      readonly state: "accepted";
      readonly reviewSlug: string;
      readonly failed: readonly MilestoneDimension[];
      readonly issues: readonly number[];
    };

/**
 * Judges the latest stored review against the plan's current state.
 *
 * @returns no-tasks (nothing landed, so nothing to review) | absent (no review) | stale (fingerprint differs) |
 *   failed (current but a dimension fails) | pass
 */
export function assessMilestoneCurrency(
  plan: Pick<DocRecord, "id" | "version">,
  tasks: readonly Pick<DocRecord, "id" | "version" | "extra">[],
  reviewDocs: readonly DocRecord[],
): MilestoneReviewCurrency {
  // reason: a plan with no member task landed no work; `lore assess` refuses to review it, so requiring a review would
  // make an empty plan unclosable. The close reports this as not-applicable (audited), never as a pass.
  if (tasks.length === 0) return { state: "no-tasks" };
  const latest = selectLatestMilestoneReview(reviewDocs);
  if (latest === undefined) return { state: "absent" };
  const current = planStateFingerprint(plan, tasks);
  if (latest.review.fingerprint !== current) {
    return { state: "stale", reviewed: latest.review.fingerprint, current, reviewSlug: latest.doc.slug };
  }
  const failed = failedDimensions(latest.review.dimensions);
  if (failed.length > 0 || latest.review.overall === "fail") {
    return { state: "failed", failed, reviewSlug: latest.doc.slug };
  }
  return { state: "pass", reviewSlug: latest.doc.slug };
}

/** One rule cited by the plan's spec, with the state `RuleStateService.full()` reported (read by the snapshot-accuracy dimension). */
export interface CitedRuleStateRow {
  readonly rule_id: string;
  readonly state: string;
  readonly unknown_reason?: string;
}
