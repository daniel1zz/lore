/**
 * JudgmentService — persistence + audit for AI review judgments and their human
 * calibration outcomes (SPEC-034 §5). Owns BOTH `review_judgments` AND
 * `calibration_records` — calibration rows are judgment-derived (FK'd to a judgment),
 * one owner for the family rather than splitting into a second service (SPEC-034 D8).
 *
 * Public surface:
 *   record(newJudgment)         → persist one AI-authored judgment + audit entry
 *   latestFor(docId)            → most recent judgment for a doc, or null
 *   listFor(docId)              → all judgments for a doc, newest first
 *   recordCalibration(input)    → persist a human confirm/override outcome, version-pinned
 *   computeCalibrationStats(filter?) → per-doc_type aggregated Wilson-bound stats
 *
 * @invariant Stateless: only StoreInterface + Telemetry are held; all durable state lives
 *   in review_judgments / calibration_records (migration-003.ts).
 * @invariant record() generates `id` (ULID), `created_at` (wall clock), and `created_by`
 *   (`formatJudgeActor(newJudgment.judge)` — every judgment in R1 is AI-authored, SPEC-034
 *   D1) itself; the caller (`AIProviderService.judgeDoc`) never sets these three fields.
 * @invariant record() re-validates the fully-assembled row via `reviewJudgmentSchema`
 *   before `insertJudgment` — a defensive re-check even though judgeDoc's output is
 *   already schema-shaped, because record() is the ONLY method with permission to persist.
 * @invariant recordCalibration() is version-pinned: a calibration row may only attach to
 *   the doc's LATEST judgment, AND only when the caller-supplied `currentDocVersion`
 *   still matches that judgment's `doc_version`. Either mismatch is a deliberate skip
 *   (`{recorded: false, reason: "version_mismatch" | "not_latest_judgment"}`), never a
 *   thrown error or a silently-accepted stale calibration — "the doc moved on since this
 *   judgment" is an expected, non-exceptional race, not a failure.
 * @invariant computeCalibrationStats is the SINGLE aggregation owner (SPEC-034 §5) — any
 *   future consumer (e.g. `lore calibration --stats`, an auto-execution circuit breaker)
 *   calls this same method, never recomputes the Wilson bound inline.
 * @invariant Never touches doc status — judgments and calibration are observational only
 *   in R1 (SPEC-034 D7); execution/auto-approve is a future, ADR-gated spec.
 *
 * Side-effect class: IO (delegates to StoreInterface + Telemetry)
 *
 * Source: SPEC-034 §5
 */

import { ulid } from "ulidx";
import { err, ok } from "@lore/core";
import type {
  CalibrationOutcome,
  CalibrationRecord,
  DocId,
  DocType,
  LoreError,
  NewReviewJudgment,
  Result,
  ReviewJudgment,
  Telemetry,
  TelemetryEvent,
} from "@lore/core";
import { calibrationRecordSchema, formatJudgeActor, reviewJudgmentSchema, wilsonLowerBound } from "@lore/core";
import type { CalibrationWindowFilter, StoreInterface } from "../store/store-interface.js";

// ─── Public Types ───────────────────────────────────────────────────────────

/**
 * Input to {@link JudgmentService.recordCalibration}. The caller (CLI `approve`/`reject`,
 * SPEC-034 D3: calibration is an implicit byproduct of the existing approve/reject flow)
 * has already fetched both the judgment being calibrated and the doc's current version —
 * JudgmentService itself never fetches a DocRecord (it is store-only over the judgment/
 * calibration tables, not a doc reader).
 */
export interface NewCalibrationInput {
  /** The judgment being calibrated — its id/doc_id/doc_version are read directly from this. */
  judgment: ReviewJudgment;
  /** The reviewed doc's type — used for calibration aggregation (CalibrationRecord.doc_type). */
  docType: DocType;
  /** The doc's CURRENT version at calibration time (caller's already-fetched DocRecord.version). */
  currentDocVersion: number;
  humanOutcome: CalibrationOutcome;
  deltaReasons: string[];
  actor: string;
}

/**
 * Result of {@link JudgmentService.recordCalibration}. A version-pin miss is a deliberate,
 * non-exceptional skip — NOT a LoreError — because "the doc moved on since this judgment
 * was made" is an expected outcome of the version-pin policy, not a system failure.
 */
export type RecordCalibrationOutcome =
  | { recorded: true; record: CalibrationRecord }
  | { recorded: false; reason: "version_mismatch" | "not_latest_judgment" };

/** One aggregated calibration statistic row. */
export interface CalibrationStats {
  doc_type: DocType;
  /**
   * The prompt_version this row's stats were computed against, OR the sentinel `"*"` when
   * `filter.prompt_version` was left unpinned (see {@link JudgmentService.computeCalibrationStats}
   * for why per-record prompt_version disaggregation isn't possible in that case).
   */
  prompt_version: string;
  n: number;
  agreement_rate: number;
  wilson_lower_bound: number;
  window_limit: number;
}

/** Bounded window size for calibration aggregation queries — never an unbounded scan. */
const CALIBRATION_WINDOW_LIMIT = 200;

// ─── JudgmentService ────────────────────────────────────────────────────────

export class JudgmentService {
  constructor(
    private readonly store: StoreInterface,
    private readonly telemetry: Telemetry,
  ) {}

  /**
   * Persist a new AI-authored review judgment: generate `id`/`created_at`/`created_by`,
   * re-validate the full row, insert, and append an audit entry (`action: "judge"`).
   *
   * @param newJudgment - Output of `AIProviderService.judgeDoc` (everything except
   *   id/created_at/created_by)
   * @returns Result<ReviewJudgment, LoreError> — the fully-persisted row on success
   *
   * @example
   * const judgeResult = await aiProviderService.judgeDoc(bundle, checks);
   * if (!judgeResult.ok) { ... }
   * const recordResult = await judgmentService.record(judgeResult.value);
   */
  async record(newJudgment: NewReviewJudgment): Promise<Result<ReviewJudgment, LoreError>> {
    const startMs = Date.now();
    const result = await this._recordImpl(newJudgment);
    this._recordTelemetryEvent("record", startMs, result, {
      doc_id: newJudgment.doc_id,
      decision: newJudgment.decision,
    });
    return result;
  }

  private async _recordImpl(newJudgment: NewReviewJudgment): Promise<Result<ReviewJudgment, LoreError>> {
    const createdAt = new Date().toISOString();
    const candidate = {
      ...newJudgment,
      id: ulid(),
      created_at: createdAt,
      created_by: formatJudgeActor(newJudgment.judge),
    };

    // reason: defensive re-validation — judgeDoc's output is already schema-shaped, but
    // record() is the ONLY method with permission to write review_judgments, so it never
    // trusts a caller-assembled candidate without re-checking it against the SSOT schema.
    const parsed = reviewJudgmentSchema.safeParse(candidate);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return err({
        code: "VALIDATION_ERROR",
        field: issue ? issue.path.join(".") || "(root)" : "(root)",
        message: issue?.message ?? "invalid review judgment",
      });
    }

    const insertResult = await this.store.insertJudgment(parsed.data);
    if (!insertResult.ok) return insertResult;

    const auditResult = await this.store.appendAuditEntry({
      timestamp: parsed.data.created_at,
      actor: parsed.data.created_by,
      session_id: `judge-${parsed.data.doc_id}`,
      action: "judge",
      doc_id: parsed.data.doc_id,
      details: { judgment_ref: parsed.data.id, version: parsed.data.doc_version },
    });
    if (!auditResult.ok) return auditResult;

    return ok(parsed.data);
  }

  /**
   * Most recent judgment for a doc, or `null` if none exists yet.
   *
   * @param docId - Document ULID
   */
  async latestFor(docId: DocId): Promise<Result<ReviewJudgment | null, LoreError>> {
    return this.store.latestJudgment(docId);
  }

  /**
   * All judgments for a doc, newest first.
   *
   * @param docId - Document ULID
   */
  async listFor(docId: DocId): Promise<Result<ReviewJudgment[], LoreError>> {
    return this.store.findJudgments(docId);
  }

  /**
   * Persist a human confirm/override outcome for a judgment — version-pinned: skipped
   * (not an error) when the judgment is no longer the doc's latest, or when the doc has
   * moved past the version the judgment was made against.
   *
   * @param input - See {@link NewCalibrationInput}
   * @returns Result<RecordCalibrationOutcome, LoreError> — `{recorded: false, reason}` is
   *   a successful `ok()` Result carrying a deliberate skip, not a LoreError
   *
   * @example
   * const outcome = await judgmentService.recordCalibration({
   *   judgment, docType: "spec", currentDocVersion: doc.version,
   *   humanOutcome: "confirmed", deltaReasons: [], actor: "alice",
   * });
   * if (outcome.ok && !outcome.value.recorded) {
   *   console.warn(`calibration skipped: ${outcome.value.reason}`);
   * }
   */
  async recordCalibration(
    input: NewCalibrationInput,
  ): Promise<Result<RecordCalibrationOutcome, LoreError>> {
    const startMs = Date.now();
    const result = await this._recordCalibrationImpl(input);
    this._recordTelemetryEvent("recordCalibration", startMs, result, {
      doc_id: input.judgment.doc_id,
      human_outcome: input.humanOutcome,
    });
    return result;
  }

  private async _recordCalibrationImpl(
    input: NewCalibrationInput,
  ): Promise<Result<RecordCalibrationOutcome, LoreError>> {
    // Version-pin: only calibrate against the doc's CURRENT version (SPEC-034 §5).
    if (input.judgment.doc_version !== input.currentDocVersion) {
      return ok({ recorded: false, reason: "version_mismatch" });
    }

    // Only the LATEST judgment for the doc may be calibrated — an older judgment being
    // confirmed/overridden after a newer one exists would misattribute the outcome.
    const latestResult = await this.store.latestJudgment(input.judgment.doc_id);
    if (!latestResult.ok) return latestResult;
    if (latestResult.value === null || latestResult.value.id !== input.judgment.id) {
      return ok({ recorded: false, reason: "not_latest_judgment" });
    }

    const candidate = {
      id: ulid(),
      judgment_id: input.judgment.id,
      doc_id: input.judgment.doc_id,
      doc_type: input.docType,
      human_outcome: input.humanOutcome,
      delta_reasons: input.deltaReasons,
      actor: input.actor,
      created_at: new Date().toISOString(),
    };

    const parsed = calibrationRecordSchema.safeParse(candidate);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return err({
        code: "VALIDATION_ERROR",
        field: issue ? issue.path.join(".") || "(root)" : "(root)",
        message: issue?.message ?? "invalid calibration record",
      });
    }

    const insertResult = await this.store.insertCalibrationRecord(parsed.data);
    if (!insertResult.ok) return insertResult;

    return ok({ recorded: true, record: parsed.data });
  }

  /**
   * Aggregate calibration records into per-doc_type Wilson-bound stats, within a bounded
   * window (`CALIBRATION_WINDOW_LIMIT`, newest-first).
   *
   * @invariant `CalibrationRecord` carries `doc_type` but NOT `prompt_version` (only the
   *   judgment it's FK'd to does) — the store's `queryCalibrationWindow` join FILTERS by
   *   `filter.prompt_version` when given, but doesn't project it back onto each returned
   *   row. When the caller pins `prompt_version`, every returned record is therefore
   *   already guaranteed to share it, and the single output group safely reports it
   *   verbatim. When `prompt_version` is left unpinned, stats aggregate across ALL prompt
   *   versions and are reported under the `"*"` sentinel — a documented approximation, not
   *   a silently wrong one.
   *
   * @param filter - Optional narrowing by doc_type and/or prompt_version
   * @returns Result<CalibrationStats[], LoreError> — one entry per doc_type present in the
   *   window; empty array when the window has zero matching records
   */
  async computeCalibrationStats(filter?: {
    doc_type?: DocType;
    prompt_version?: string;
  }): Promise<Result<CalibrationStats[], LoreError>> {
    const windowFilter: CalibrationWindowFilter = {
      limit: CALIBRATION_WINDOW_LIMIT,
      ...(filter?.doc_type !== undefined ? { doc_type: filter.doc_type } : {}),
      ...(filter?.prompt_version !== undefined ? { prompt_version: filter.prompt_version } : {}),
    };

    const windowResult = await this.store.queryCalibrationWindow(windowFilter);
    if (!windowResult.ok) return windowResult;
    const records = windowResult.value;

    const promptVersionLabel = filter?.prompt_version ?? "*";

    const groups = new Map<DocType, CalibrationRecord[]>();
    for (const record of records) {
      const bucket = groups.get(record.doc_type) ?? [];
      bucket.push(record);
      groups.set(record.doc_type, bucket);
    }

    const stats: CalibrationStats[] = [];
    for (const [docType, bucket] of groups) {
      const n = bucket.length;
      const successes = bucket.filter((r) => r.human_outcome === "confirmed").length;
      stats.push({
        doc_type: docType,
        prompt_version: promptVersionLabel,
        n,
        agreement_rate: n === 0 ? 0 : successes / n,
        wilson_lower_bound: wilsonLowerBound(successes, n),
        window_limit: CALIBRATION_WINDOW_LIMIT,
      });
    }

    return ok(stats);
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  /**
   * Record a generic service-layer telemetry event — same shape/pattern as
   * `CorpusService.recordTelemetryEvent` (not `AIProviderService.emit`'s AI-specific
   * `ai.generation` channel; JudgmentService never calls an AI provider itself).
   */
  private _recordTelemetryEvent<T>(
    method: string,
    startMs: number,
    result: Result<T, LoreError>,
    meta?: Record<string, unknown>,
  ): void {
    const event: TelemetryEvent = {
      ts: new Date().toISOString(),
      service: "JudgmentService",
      method,
      ok: result.ok,
      duration_ms: Date.now() - startMs,
      ...(!result.ok ? { error_code: result.error.code } : {}),
      ...(meta !== undefined ? { meta } : {}),
    };
    this.telemetry.record(event);
  }
}
