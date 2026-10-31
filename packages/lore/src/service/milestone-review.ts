/**
 * Milestone review currency: which stored review binds a plan's close, and whether it is current and passing.
 *
 * Purpose: the pure half of BR-1372. `lore assess` stores a review carrying the plan-state fingerprint it judged;
 *   plan close recomputes the fingerprint and compares.
 * Public surface: planStateFingerprint, milestoneFactsFingerprint, FactsFingerprintInput, latestLandingCommit, CitedRuleStateRow, selectLatestMilestoneReview, assessMilestoneCurrency,
 *   MilestoneReviewCurrency, MILESTONE_REVIEW_SUB_TYPE.
 * Invariants:
 *   - Fingerprint = SHA-256 of the plan id and its reviewed content (title, body, canonical `extra.phases`), every task id@version (sorted by id), the main commit that last landed one of
 *     the tasks (the `extra.landing.landing_commit` with the newest `recorded_at`; `none` when no task has a landing) and
 *     the governing spec's live AC ids with content hashes (BR-1379).
 *     Any plan edit, task edit, evidence write, or a newer landing therefore makes the stored review not current.
 *   - A review whose `extra.milestone_review` does not parse is not a review (never read as pass).
 * Side-effect class: pure (no store, no IO, no clock).
 *
 * @spec_ref spec-lean-governance-batch-verbs-judgment-only-at-milestones (Part D, AC-LG-12, BR-1372)
 */

import { createHash } from "node:crypto";
import {
  filableDimensions,
  milestoneReviewSchema,
  specAcceptanceCriteriaSchema,
  type DocRecord,
  type LoreError,
  type MilestoneDimension,
  type MilestoneReview,
  type Result,
  type RetiredAcRef,
} from "@lore/core";
import { readTaskLanding } from "./task-commit-range.js";

/** `extra.sub_type` of the knowledge doc that stores a review. */
export const MILESTONE_REVIEW_SUB_TYPE = "milestone-review";

/** The main commit that last landed one of `tasks`, or `none`. */
export function latestLandingCommit(tasks: readonly Pick<DocRecord, "extra">[]): string {
  let newest: { at: string; commit: string } | undefined;
  for (const task of tasks) {
    const landing = readTaskLanding(task.extra);
    if (landing === undefined) continue;
    // reason: a landing whose range is empty (main_before == landing_commit) moved nothing onto main; the stored `kind` label is never trusted.
    if (landing.main_before === landing.landing_commit) continue;
    if (newest === undefined || landing.recorded_at > newest.at) newest = { at: landing.recorded_at, commit: landing.landing_commit };
  }
  return newest?.commit ?? "none";
}

/** The governing spec's live (not superseded) AC ids with content hashes, sorted. */
function liveAcHashes(spec: Pick<DocRecord, "extra"> | undefined): string[] {
  if (spec === undefined) return [];
  const parsed = specAcceptanceCriteriaSchema.safeParse(spec.extra["acceptance_criteria"]);
  if (!parsed.success) return [];
  return parsed.data
    .filter((c) => c.superseded_by === undefined)
    .map((c) => `${c.id}:${createHash("sha256").update(JSON.stringify({ statement: c.statement, verify: c.verify })).digest("hex")}`)
    .sort();
}

/** Key-order-insensitive JSON text, so equal phase data hashes equal whatever order its keys were stored in. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * The plan's reviewed state as one comparable value: the SHA-256 (hex) of its four inputs (BR-1379): the plan's id and
 * its reviewed content (title, body and the canonical JSON of its declared `extra.phases`); the sorted task/phase ids
 * with versions; the main commit that last landed one of the tasks; and the sorted live (not superseded) AC ids of the
 * governing spec with their content hashes. Restoring or retiring an AC therefore changes it.
 *
 * The plan's own version is deliberately NOT an input: bookkeeping writes (`extra.progress`, `extra.known_defects`)
 * bump it without changing what the review judged, and must never make a stored review stale.
 *
 * @param plan - the plan (id, title, content, extra for its phases)
 * @param tasks - every member task (id, version, extra for the landing)
 * @param spec - the plan's governing spec; absent = the plan has none (no AC input)
 */
export function planStateFingerprint(
  plan: Pick<DocRecord, "id" | "title" | "content"> & { readonly extra?: Readonly<Record<string, unknown>> },
  tasks: readonly Pick<DocRecord, "id" | "version" | "extra">[],
  spec: Pick<DocRecord, "extra"> | undefined,
): string {
  const taskPart = [...tasks]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((t) => `${t.id}@${String(t.version)}`)
    .join(",");
  const planPart = createHash("sha256")
    .update(canonicalJson({ title: plan.title, content: plan.content, phases: plan.extra?.["phases"] ?? null }))
    .digest("hex");
  const canonical = `plan:${plan.id}#${planPart}|tasks:${taskPart}|landed:${latestLandingCommit(tasks)}|acs:${liveAcHashes(spec).join(",")}`;
  return createHash("sha256").update(canonical).digest("hex");
}

/** Everything beyond the plan's own state that a review's verdict reads (spec "Fingerprint", AC-AO-5, AC-AF-6). */
export interface FactsFingerprintInput {
  /** The stored suite result id at the assessed commit; absent when the head suite was not run. */
  readonly headSuiteResultId?: string;
  /** The stored single-file runs the regression verdict read or made, keyed `<file>@<commit>:<kind>`. */
  readonly singleFileRunIds: readonly { readonly key: string; readonly id: string }[];
  /** The attestation made at the assessed commit that decided each criterion. */
  readonly criteriaAttestationIds: readonly { readonly subject: string; readonly id: string }[];
  /** The cited rules' states. */
  readonly citedRules: readonly { readonly rule_id: string; readonly state: string }[];
  readonly promptVersion: string;
}

/**
 * The measured facts a review read, as one comparable value (BR-1379, AC-AO-5): the assessed commit's suite result id, the
 * single-file runs the regression verdict used, the criteria attestation ids made at that commit, the cited rules' states
 * and the prompt version.
 *
 * reason: main's HEAD is deliberately NOT an input. A review is re-made when one of these facts changes, never because
 * main moved: the ids are stored-row ids (a re-run is a new row), so a re-measurement changes them.
 *
 * @param input - the facts
 * @returns SHA-256 hex
 */
export function milestoneFactsFingerprint(input: FactsFingerprintInput): string {
  const byKey = <T>(items: readonly T[], key: (item: T) => string): T[] => [...items].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  const canonical = canonicalJson({
    headSuite: input.headSuiteResultId ?? "none",
    singleFileRuns: byKey(input.singleFileRunIds, (r) => r.key).map((r) => `${r.key}=${r.id}`),
    criteriaAttestations: byKey(input.criteriaAttestationIds, (a) => a.subject).map((a) => `${a.subject}=${a.id}`),
    rules: byKey(input.citedRules, (r) => r.rule_id).map((r) => `${r.rule_id}=${r.state}`),
    prompt: input.promptVersion,
  });
  return createHash("sha256").update(canonical).digest("hex");
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
  plan: Pick<DocRecord, "id" | "title" | "content"> & { readonly extra?: Readonly<Record<string, unknown>> },
  tasks: readonly Pick<DocRecord, "id" | "version" | "extra">[],
  reviewDocs: readonly DocRecord[],
  spec: Pick<DocRecord, "extra"> | undefined,
): MilestoneReviewCurrency {
  // reason: a plan with no member task landed no work; `lore assess` refuses to review it, so requiring a review would
  // make an empty plan unclosable. The close reports this as not-applicable (audited), never as a pass.
  if (tasks.length === 0) return { state: "no-tasks" };
  const latest = selectLatestMilestoneReview(reviewDocs);
  if (latest === undefined) return { state: "absent" };
  const current = planStateFingerprint(plan, tasks, spec);
  if (latest.review.fingerprint !== current) {
    return { state: "stale", reviewed: latest.review.fingerprint, current, reviewSlug: latest.doc.slug };
  }
  // reason: a gate that failed or was not measured holds the plan open on EVERY close path (BR-1379, BR-1500), so a
  // not-measured gate is listed with the failed dimensions; `CorpusService` then lets only a gate accepted for that
  // failure (`acceptedGatesOf`) through, whatever issue is open.
  const failed = filableDimensions(latest.review.dimensions);
  if (failed.length > 0 || latest.review.overall === "fail") {
    return { state: "failed", failed, reviewSlug: latest.doc.slug };
  }
  return { state: "pass", reviewSlug: latest.doc.slug };
}

/** Where a plan stands on the ACs retired during it (settled by `RetiredAcService`; adr-an-acceptance-criterion-retires-with-the-feature-it). */
export type PlanRetirementState =
  | { readonly state: "none" }
  | { readonly state: "confirmed"; readonly retired: readonly RetiredAcRef[] }
  | { readonly state: "pending"; readonly retired: readonly RetiredAcRef[]; readonly pendingId: number }
  | { readonly state: "rejected"; readonly restored: readonly RetiredAcRef[] };

/** The port plan close holds for the retired-AC confirmation: carries out an answered rejection, reports the state. */
export interface PlanCloseRetirementPort {
  settle(planId: string): Promise<Result<PlanRetirementState, LoreError>>;
}

/**
 * The refusal text of a plan close that must wait for, or was refused by, the owner's retired-AC answer.
 *
 * @returns `undefined` when the close may proceed (nothing retired, or the owner confirmed)
 */
export function describeRetirementRefusal(planSlug: string, state: PlanRetirementState): string | undefined {
  switch (state.state) {
    case "none":
    case "confirmed":
      return undefined;
    case "pending":
      return (
        `Plan "${planSlug}" retired ${String(state.retired.length)} acceptance criteria that the owner has not confirmed ` +
        `(pending decision ${String(state.pendingId)}). Ask the owner in the session: \`lore pending --ask\`, then close again.`
      );
    case "rejected":
      return (
        `The owner rejected the acceptance criteria retired during plan "${planSlug}"; ${String(state.restored.length)} were restored. ` +
        "The plan cannot close until it is re-planned (a plan or task change) and reviewed again."
      );
  }
}

/** One rule cited by the plan's spec, with the state `RuleStateService.full()` reported (read by the snapshot-accuracy dimension). */
export interface CitedRuleStateRow {
  readonly rule_id: string;
  readonly state: string;
  readonly unknown_reason?: string;
  /** Ids of the spec criteria that cite this rule (the ones re-run to refresh a stale rule). */
  readonly citing_acs?: readonly string[];
}
