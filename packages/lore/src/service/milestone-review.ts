/**
 * Milestone review currency: which stored review binds a plan's close, and whether it is current and passing.
 *
 * Purpose: the pure half of BR-1372. `lore assess` stores a review carrying the plan-state fingerprint it judged;
 *   plan close recomputes the fingerprint and compares.
 * Public surface: planStateFingerprint, latestLandingCommit, CitedRuleStateRow, selectLatestMilestoneReview, assessMilestoneCurrency,
 *   MilestoneReviewCurrency, MILESTONE_REVIEW_SUB_TYPE, and the main-red ledger (BR-1412): MAIN_RED_ACTION,
 *   MAIN_RED_GREEN_ACTION, MAIN_CHECKED_ACTION, MainRedLedgerPort, foldMainRedRecords, classifySuiteForMainRed, planMainRedWrites.
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
import { z } from "zod";
import {
  err,
  ok,
  failedDimensions,
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
    // reason: a no-change landing (the one predicate, `landingOf`) moved nothing onto main: it adds no commit range to the review.
    if (landing.kind === "no-change") continue;
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
  const failed = failedDimensions(latest.review.dimensions);
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

// ---------------------------------------------------------------------------------------------------------------------
// Main-red ledger (BR-1412, BR-1414, spec-delivery-concurrency-and-autonomy-metrics AC-DC-6)
//
// Storage: `main-red` / `main-red-green` are append-only rows of the corpus audit chain. `main-checked` is NOT written any
// more (BR-1497): the port derives it from the stored suite results (`suite-result-service.ts::deriveMainCheckedRows`), so
// one suite run has one record; legacy `main-checked` audit rows are still read as history. The audit append is serialized inside
// one store transaction, so concurrent writers never fork the chain; a record is the FOLD of its rows, never a mutated
// row, which is what makes "the green time recorded on the open record" safe under concurrent reviews.
// ---------------------------------------------------------------------------------------------------------------------

/** Audit action of a main-red record, written once at detection. */
export const MAIN_RED_ACTION = "main-red";
/** Audit action stamping the time main turned green on an open record. */
export const MAIN_RED_GREEN_ACTION = "main-red-green";
/** Audit action of "this review measured main at <commit>": gives the next record its range start and readers the review cadence. */
export const MAIN_CHECKED_ACTION = "main-checked";

const isoTime = z.string().min(1);

/** Details of a `main-red` row. `record_id` is deterministic from the range, so a duplicate write folds to one record. */
export const mainRedDetailsSchema = z.object({
  record_id: z.string().min(1),
  /** The last commit a review measured green before this detection; `null` when no earlier review is recorded. */
  range_from: z.string().min(1).nullable(),
  /** The commit this review measured red. The checked range is (`range_from`, `range_to`]. */
  range_to: z.string().min(1),
  failing_files: z.array(z.string().min(1)),
  /** The suite commands that exited non-zero. */
  failing_checks: z.array(z.string().min(1)),
  detected_at: isoTime,
  /** When the last review that found main green ran (`null` = none recorded): the failure happened after it. */
  last_green_at: isoTime.nullable(),
});
export type MainRedDetails = z.infer<typeof mainRedDetailsSchema>;

const mainRedGreenDetailsSchema = z.object({ record_id: z.string().min(1), green_at: isoTime, green_commit: z.string().min(1) });
const mainCheckedDetailsSchema = z.object({ commit: z.string().min(1), status: z.enum(["red", "green"]), at: isoTime });
type MainCheckedDetails = z.infer<typeof mainCheckedDetailsSchema>;

/** A main-red record with its green time once recorded. */
export interface MainRedRecord extends MainRedDetails {
  readonly green_at?: string;
  readonly green_commit?: string;
}

/** One ledger row as the port reads and writes it. */
export interface MainRedRow {
  readonly action: string;
  readonly timestamp: string;
  readonly details: Readonly<Record<string, unknown>>;
}

/** The narrow port the review service uses; `app.ts` binds it to the store's audit chain. */
export interface MainRedLedgerPort {
  readonly now: () => string;
  /** Every ledger row (any of the three actions), oldest first. */
  readonly listRows: () => Promise<Result<MainRedRow[], LoreError>>;
  readonly appendRow: (row: MainRedRow) => Promise<Result<void, LoreError>>;
}

/** What the ledger holds, folded. */
export interface MainRedLedgerState {
  /** Records in detection order, one per `record_id` (the first row of an id wins). */
  readonly records: readonly MainRedRecord[];
  /** The newest `main-checked` row, if any. */
  readonly lastChecked?: MainCheckedDetails;
  /** Every `main-checked` row, oldest first (BR-1497: derived from stored suite results; legacy audit rows come first). */
  readonly checks: readonly MainCheckedDetails[];
  /** `at` of the newest green `main-checked` row. */
  readonly lastGreenAt?: string;
}

function corruptLedgerRow(action: string, issues: readonly z.ZodIssue[]): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: `audit.${action}`,
    message:
      `a "${action}" ledger row does not parse (${issues.map((i) => i.path.join(".") || "(root)").join(", ")}); ` +
      "it is never skipped, because dropping it would hide a main-red record",
    rule: "BR-1412",
  };
}

/**
 * Folds ledger rows into records. A row of one of the three actions that does not parse is an error, never skipped.
 *
 * @param rows - ledger rows, oldest first (other actions are ignored)
 * @returns the records (a `main-red-green` row stamps the open record of its id; a repeat or an unknown id is ignored)
 */
export function foldMainRedRecords(rows: readonly MainRedRow[]): Result<MainRedLedgerState, LoreError> {
  const records = new Map<string, MainRedRecord>();
  let lastChecked: MainCheckedDetails | undefined;
  let lastGreenAt: string | undefined;
  const checks: MainCheckedDetails[] = [];
  for (const row of rows) {
    if (row.action === MAIN_RED_ACTION) {
      const parsed = mainRedDetailsSchema.safeParse(row.details);
      if (!parsed.success) return err(corruptLedgerRow(row.action, parsed.error.issues));
      if (!records.has(parsed.data.record_id)) records.set(parsed.data.record_id, parsed.data);
    } else if (row.action === MAIN_RED_GREEN_ACTION) {
      const parsed = mainRedGreenDetailsSchema.safeParse(row.details);
      if (!parsed.success) return err(corruptLedgerRow(row.action, parsed.error.issues));
      const open = records.get(parsed.data.record_id);
      if (open !== undefined && open.green_at === undefined) {
        records.set(open.record_id, { ...open, green_at: parsed.data.green_at, green_commit: parsed.data.green_commit });
      }
    } else if (row.action === MAIN_CHECKED_ACTION) {
      const parsed = mainCheckedDetailsSchema.safeParse(row.details);
      if (!parsed.success) return err(corruptLedgerRow(row.action, parsed.error.issues));
      lastChecked = parsed.data;
      checks.push(parsed.data);
      if (parsed.data.status === "green") lastGreenAt = parsed.data.at;
    }
  }
  return ok({
    records: [...records.values()],
    checks,
    ...(lastChecked !== undefined ? { lastChecked } : {}),
    ...(lastGreenAt !== undefined ? { lastGreenAt } : {}),
  });
}

/** What one suite measurement says about main. */
export type MainSuiteState =
  | { readonly state: "red"; readonly commit: string; readonly failingFiles: string[]; readonly failingChecks: string[] }
  | { readonly state: "green"; readonly commit: string }
  | { readonly state: "unmeasured" };

/** The slice of a suite run the classification reads. */
export interface MainSuiteInput {
  readonly status: string;
  readonly commit?: string;
  readonly commands?: readonly { readonly command: string; readonly exit_code: number }[];
  readonly failing_test_files?: readonly { readonly file: string }[];
}

/**
 * Reads a batch's suite run as main red, green or unmeasured. Red = a command exited non-zero or a test file failed;
 * green = at least one command ran and every one exited 0 with no failing file. A run that measured nothing (not
 * measured, or no command defined) proves neither, so it is `unmeasured`: never read as green.
 */
export function classifySuiteForMainRed(suite: MainSuiteInput): MainSuiteState {
  if (suite.status !== "measured" || suite.commit === undefined || suite.commands === undefined || suite.failing_test_files === undefined) {
    return { state: "unmeasured" };
  }
  const failingChecks = suite.commands.filter((c) => c.exit_code !== 0).map((c) => c.command);
  const failingFiles = [...new Set(suite.failing_test_files.map((f) => f.file))].sort();
  if (failingChecks.length > 0 || failingFiles.length > 0) return { state: "red", commit: suite.commit, failingFiles, failingChecks };
  if (suite.commands.length === 0) return { state: "unmeasured" };
  return { state: "green", commit: suite.commit };
}

/**
 * The rows one measurement adds, given the ledger as folded. Pure.
 *
 * - red, no open record: one `main-red` record (range = last green-checked commit .. this commit), then the check row;
 * - red with an open record: only the check row (the outage is one record);
 * - green with an open record: a `main-red-green` stamp on it, then the check row;
 * - green otherwise: nothing.
 *
 * It never writes a `main-checked` row (BR-1497): "main was checked at <commit>" is derived from the stored suite
 * result of that commit, so the ledger state already holds the measured commit's own check. The range start and the
 * last-green time therefore come from the checks of OTHER commits only.
 */
export function planMainRedWrites(state: MainRedLedgerState, measured: MainSuiteState, now: string): MainRedRow[] {
  if (measured.state === "unmeasured") return [];
  const rows: MainRedRow[] = [];
  const open = state.records.filter((r) => r.green_at === undefined).at(-1);
  if (measured.state === "red" && open === undefined) {
    const prior = state.checks.filter((c) => c.commit !== measured.commit);
    const previous = prior.at(-1);
    const rangeFrom = previous?.status === "green" ? previous.commit : null;
    const lastGreenAt = prior.filter((c) => c.status === "green").at(-1)?.at;
    const details: MainRedDetails = {
      record_id: `main-red-${createHash("sha256").update(`${rangeFrom ?? "none"}..${measured.commit}`).digest("hex").slice(0, 16)}`,
      range_from: rangeFrom,
      range_to: measured.commit,
      failing_files: measured.failingFiles,
      failing_checks: measured.failingChecks,
      detected_at: now,
      last_green_at: lastGreenAt ?? null,
    };
    rows.push({ action: MAIN_RED_ACTION, timestamp: now, details });
  }
  if (measured.state === "green" && open !== undefined) {
    rows.push({ action: MAIN_RED_GREEN_ACTION, timestamp: now, details: { record_id: open.record_id, green_at: now, green_commit: measured.commit } });
  }
  return rows;
}
