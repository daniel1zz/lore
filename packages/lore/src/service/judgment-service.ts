/**
 * JudgmentService — persistence + audit for AI review judgments and their human
 * calibration outcomes (SPEC-034 §5). Owns BOTH `review_judgments` AND
 * `calibration_records` — calibration rows are judgment-derived (FK'd to a judgment),
 * one owner for the family rather than splitting into a second service (SPEC-034 D8).
 *
 * Public surface:
 *   record(newJudgment, opts?)  → persist one AI-authored judgment + audit entry
 *   latestFor(docId, kind?)     → most recent judgment of a kind for a doc, or null
 *   listFor(docId, kind?)       → all judgments of a kind for a doc, newest first
 *   recordCalibration(input)    → persist a human confirm/override outcome, version-pinned
 *   computeCalibrationStats(filter?) → per-(doc_type, prompt_version, kind) aggregated Wilson-bound stats
 *
 * @invariant Stateless: only StoreInterface + Telemetry are held; all durable state lives
 *   in review_judgments / calibration_records (migration-003.ts, kind/superseded_candidate
 *   columns added migration-005.ts, SPEC-044 D3).
 * @invariant record() generates `id` (ULID), `created_at` (wall clock), and `created_by`
 *   (`formatJudgeActor(newJudgment.judge)` — every judgment in R1 is AI-authored, SPEC-034
 *   D1) itself; the caller (`AIProviderService.judgeDoc`/`probeStaleness`) never sets these
 *   three fields. `opts.auditAction`/`opts.auditActor` (SPEC-044 D4) override the DEFAULT
 *   audit entry this method writes (`action: "judge"`, `actor: created_by`) — used by
 *   `StalenessProbeService` to write `action: "staleness_probe"` with the COMMISSIONING
 *   actor instead of the synthetic AI judge string, while still going through this SAME
 *   sole persistence method (never a second, bypassing write path).
 * @invariant record() re-validates the fully-assembled row via `reviewJudgmentSchema`
 *   before `insertJudgment` — a defensive re-check even though judgeDoc's output is
 *   already schema-shaped, because record() is the ONLY method with permission to persist.
 * @invariant recordCalibration() is version-pinned: a calibration row may only attach to
 *   the doc's LATEST judgment OF THE SAME KIND (`input.judgment.kind ?? "review"`, SPEC-044
 *   D3/AC-SP-2 — calibrating a review judgment ignores staleness rows entirely and vice
 *   versa), AND only when the caller-supplied `currentDocVersion` still matches that
 *   judgment's `doc_version`. Either mismatch is a deliberate skip
 *   (`{recorded: false, reason: "version_mismatch" | "not_latest_judgment"}`), never a
 *   thrown error or a silently-accepted stale calibration — "the doc moved on since this
 *   judgment" is an expected, non-exceptional race, not a failure.
 * @invariant computeCalibrationStats is the SINGLE aggregation owner (SPEC-034 §5) — any
 *   future consumer (e.g. `lore calibration --stats`, an auto-execution circuit breaker)
 *   calls this same method, never recomputes the Wilson bound inline. The group key is
 *   `(doc_type, judge_prompt_version, judge_kind)` (SPEC-044 D12/AC-SP-11) — review and
 *   staleness calibrations never pool into one Wilson bound even under the literal SAME
 *   "v1" prompt-version string (review S5).
 * @invariant Never touches doc status — judgments and calibration are observational only
 *   in R1 (SPEC-034 D7); execution/auto-approve is a future, ADR-gated spec.
 *
 * Side-effect class: IO (delegates to StoreInterface + Telemetry)
 *
 * Source: SPEC-034 §5; SPEC-044 §Design Decisions D3, D4, D12
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
  ReviewJudgmentKind,
  Telemetry,
  TelemetryEvent,
} from "@lore/core";
import { calibrationRecordSchema, formatJudgeActor, reviewJudgmentSchema, wilsonLowerBound } from "@lore/core";
import type {
  CalibrationRecordWithPromptVersion,
  CalibrationWindowFilter,
  StoreInterface,
} from "../store/store-interface.js";
import { bareDocWriter, type DocWritePort } from "./corpus-service.js";

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
   * The real `judge_prompt_version` of the judgments this row's calibration records
   * were derived from — every row is disaggregated by BOTH `doc_type` AND
   * `prompt_version`, never collapsed across prompt versions (see
   * {@link JudgmentService.computeCalibrationStats}).
   */
  prompt_version: string;
  /**
   * The joined `kind` ('review'|'staleness') of the judgments this row's calibration
   * records were derived from (SPEC-044 D12/AC-SP-11) — every row is disaggregated by
   * `(doc_type, prompt_version, kind)`, never pooled across kinds even when both kinds
   * happen to share the literal same prompt-version string (review S5).
   */
  kind: ReviewJudgmentKind;
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
    // reason: AC-DCL-5 — the ONE write route (`CorpusService`); `app.ts` passes the composed one, a bare test gets a
    // bare writer. This service never calls `store.appendAuditEntry` itself.
    writer?: DocWritePort,
  ) {
    this.writer = writer ?? bareDocWriter(store);
  }

  private readonly writer: DocWritePort;

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
  async record(
    newJudgment: NewReviewJudgment,
    opts?: { auditAction?: string; auditActor?: string },
  ): Promise<Result<ReviewJudgment, LoreError>> {
    const startMs = Date.now();
    const result = await this._recordImpl(newJudgment, opts);
    this._recordTelemetryEvent("record", startMs, result, {
      doc_id: newJudgment.doc_id,
      decision: newJudgment.decision,
    });
    return result;
  }

  private async _recordImpl(
    newJudgment: NewReviewJudgment,
    opts?: { auditAction?: string; auditActor?: string },
  ): Promise<Result<ReviewJudgment, LoreError>> {
    const createdAt = new Date().toISOString();
    const candidate = {
      ...newJudgment,
      // reason: reviewJudgmentSchema keeps `kind` OPTIONAL (not `.default()`, see
      // review-judgment.ts's module @invariant) so this is the ONE place that resolves
      // "no kind" -> "review" explicitly, before persisting (SPEC-044 D3).
      kind: newJudgment.kind ?? "review",
      id: ulid(),
      created_at: createdAt,
      created_by: formatJudgeActor(newJudgment.judge),
    };

    // reason: defensive re-validation — judgeDoc's/probeStaleness's output is already
    // schema-shaped, but record() is the ONLY method with permission to write
    // review_judgments, so it never trusts a caller-assembled candidate without
    // re-checking it against the SSOT schema.
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

    // reason: SPEC-044 D4 — StalenessProbeService overrides BOTH the audit action
    // ("staleness_probe" instead of "judge") and the actor (the COMMISSIONING `by`
    // instead of the synthetic AI judge string) because a probe is a discretionary,
    // cost-incurring action someone chose to run — the judgment row's own `judge` field
    // still carries the real provider/model/prompt-version regardless of this override.
    const auditResult = await this.writer.appendAudit({
      timestamp: parsed.data.created_at,
      by: opts?.auditActor ?? parsed.data.created_by,
      sessionId: `judge-${parsed.data.doc_id}`,
      action: opts?.auditAction ?? "judge",
      docId: parsed.data.doc_id,
      details: { judgment_ref: parsed.data.id, version: parsed.data.doc_version },
    });
    if (!auditResult.ok) return auditResult;

    return ok(parsed.data);
  }

  /**
   * Most recent judgment for a doc, or `null` if none exists yet.
   *
   * @param docId - Document ULID
   * @param kind - Which kind of judgment to look for (SPEC-044 D3). Defaults to
   *   `"review"` so every pre-SPEC-044 caller (`lore pending` triage badges, review
   *   freshness) stays byte-identical — a staleness "holds" row can never masquerade as
   *   a real review approval (review S2).
   */
  async latestFor(
    docId: DocId,
    kind: ReviewJudgmentKind = "review",
  ): Promise<Result<ReviewJudgment | null, LoreError>> {
    return this.store.latestJudgment(docId, kind);
  }

  /**
   * All judgments for a doc, newest first.
   *
   * @param docId - Document ULID
   * @param kind - Same default-to-"review" contract as {@link latestFor} (SPEC-044 D3).
   */
  async listFor(
    docId: DocId,
    kind: ReviewJudgmentKind = "review",
  ): Promise<Result<ReviewJudgment[], LoreError>> {
    return this.store.findJudgments(docId, kind);
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

    // Only the LATEST judgment OF THE SAME KIND for the doc may be calibrated — an older
    // judgment being confirmed/overridden after a newer one exists would misattribute the
    // outcome. Scoping by `input.judgment.kind` (SPEC-044 D3/AC-SP-2) means calibrating a
    // review judgment ignores staleness rows entirely (and vice versa) — a fresher
    // staleness "holds" probe must never make an older-but-still-latest REVIEW judgment
    // look stale to this check.
    const latestResult = await this.store.latestJudgment(input.judgment.doc_id, input.judgment.kind ?? "review");
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
   * Aggregate calibration records into per-(doc_type, prompt_version, kind) Wilson-bound
   * stats, within a bounded window (`CALIBRATION_WINDOW_LIMIT`, newest-first).
   *
   * @invariant `CalibrationRecord` itself carries `doc_type` but NOT `prompt_version`/
   *   `kind` (only the judgment it's FK'd to does) — the store's `queryCalibrationWindow`
   *   projects the judgment's real `judge_prompt_version` AND `judge_kind` onto every
   *   returned row (unconditional join, not just when `filter.prompt_version` is
   *   pinned), so grouping here is always by the ACTUAL (doc_type, prompt_version, kind)
   *   triple present in the data — never collapsed into an unpinned "aggregate across
   *   all versions/kinds" sentinel. A doc_type reviewed under two different prompt
   *   versions produces two separate `CalibrationStats` rows; a doc_type calibrated
   *   under BOTH `kind: "review"` and `kind: "staleness"` — even under the literal SAME
   *   `"v1"` prompt-version string — produces two separate rows too (SPEC-044 D12/
   *   AC-SP-11/review S5), never one pooled Wilson bound.
   *
   * @param filter - Optional narrowing by doc_type and/or prompt_version
   * @returns Result<CalibrationStats[], LoreError> — one entry per distinct
   *   (doc_type, prompt_version, kind) triple present in the window; empty array when
   *   the window has zero matching records
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

    // reason: group key is the REAL (doc_type, prompt_version, kind) triple, never a
    // caller-supplied/unpinned sentinel — see @invariant above.
    const groups = new Map<
      string,
      { docType: DocType; promptVersion: string; kind: ReviewJudgmentKind; bucket: CalibrationRecordWithPromptVersion[] }
    >();
    for (const record of records) {
      const key = `${record.doc_type}::${record.judge_prompt_version}::${record.judge_kind}`;
      const group =
        groups.get(key) ??
        { docType: record.doc_type, promptVersion: record.judge_prompt_version, kind: record.judge_kind, bucket: [] };
      group.bucket.push(record);
      groups.set(key, group);
    }

    const stats: CalibrationStats[] = [];
    for (const { docType, promptVersion, kind, bucket } of groups.values()) {
      const n = bucket.length;
      const successes = bucket.filter((r) => r.human_outcome === "confirmed").length;
      stats.push({
        doc_type: docType,
        prompt_version: promptVersion,
        kind,
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
