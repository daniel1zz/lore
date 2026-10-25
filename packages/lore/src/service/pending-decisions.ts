/**
 * Pending decisions — the open escalations derived from the decision log.
 *
 * Purpose: a pending decision is not a separate table; it is a (class, subject, version) whose EFFECTIVE verdict
 * is a machine `escalate` (no human-tty record has answered it). This module derives that list from the log rows.
 * Public surface: derivePendingDecisions, parseRowFactors, parseRowReasons, deriveOpenEscalations, newerVersionSupersession, isSupersedeMarker,
 *   SUPERSEDED_FACTS_KEY, HUMAN_ANSWER_ONLY_CLASSES, recommendAnswer, PendingDecision, SubjectExistenceProbe(s), RECOMMEND_ACCEPT_MIN_SCORE.
 * Invariants:
 *   - `id` is the id of the FIRST machine escalate row of the key, so it stays the same when the escalating
 *     operation is re-run and appends further escalate rows.
 *   - Only `human-tty` (and a worse machine verdict) change a key's effective verdict; an agent-asserted row is
 *     invisible here, so it can neither resolve nor hide a pending decision.
 *   - The row's JSON columns were written by DecisionService; a column that no longer parses is returned as a
 *     STORE_ERROR, never defaulted.
 *   - CLOSED (AU-T16): a decision stops being pending when (a) a later non-marker row of the same class and
 *     subject id exists on ANOTHER subject version (the subject was re-measured; log order is the only version
 *     order, hashes have none), or (b) a closing MARKER row (machine channel, verdict `superseded`, facts
 *     `{superseded:{pending_id,cause,detail}}`) was appended after its latest escalate row because the subject no
 *     longer exists. Markers are ordinary appended rows, never an edit or delete; a re-escalation appended after a
 *     marker reopens the key. A marker is NOT a decision: effectiveDecisionVerdict ignores it, and AU-T8 calibration
 *     / auto sampling must select `verdict = 'auto'` only, so they never see a marker.
 *   - Carries NO secret: the nonce is generated per `lore decide` invocation and exists nowhere in the log.
 * Side-effect class: pure.
 *
 * Source: spec-autonomy-phase-1-decision-function-human-channel-lore AC-AU-3 (`lore pending`).
 */
import { err, ok, type LoreError, type Result } from "@lore/core";
import { z } from "zod";
import { effectiveDecisionVerdict, type DecisionLogRow } from "../store/decision-log.js";

const factorsSchema = z.record(z.string(), z.number());
const reasonsSchema = z.array(z.string());

/** Minimum score at which the recommendation is "accept": the weakest measured factor is at least a coin flip. */
export const RECOMMEND_ACCEPT_MIN_SCORE = 0.5;

export type RecommendedAnswer = "accept" | "reject";

export interface PendingDecision {
  /** Stable id the human types: `lore decide <id>`. */
  readonly id: number;
  readonly class: string;
  readonly subject_id: string;
  readonly subject_version: string;
  /** ts of the first escalation. */
  readonly opened_at: string;
  /** Score/threshold/factors/reasons of the latest escalating decision. */
  readonly score: number;
  readonly threshold: number | null;
  readonly factors: Readonly<Record<string, number>>;
  readonly reasons: readonly string[];
  readonly recommended: RecommendedAnswer;
  readonly recommended_reason: string;
  /** Raw `detail` column of the latest escalating row (JSON text), or null for a row decided before detail existed. */
  readonly detail: string | null;
}

/**
 * Recommended answer for an escalation. Human-always classes (no threshold) never recommend accept: nothing was
 * measured that argues for it. Otherwise accept iff the score (the weakest factor) is at least
 * RECOMMEND_ACCEPT_MIN_SCORE.
 */
export function recommendAnswer(score: number, threshold: number | null): { answer: RecommendedAnswer; reason: string } {
  if (threshold === null) return { answer: "reject", reason: "human-always class: no measured factor recommends accepting" };
  if (score >= RECOMMEND_ACCEPT_MIN_SCORE) {
    return { answer: "accept", reason: `weakest factor ${score} is at least ${RECOMMEND_ACCEPT_MIN_SCORE}, only below the ${threshold} auto threshold` };
  }
  return { answer: "reject", reason: `weakest factor ${score} is below ${RECOMMEND_ACCEPT_MIN_SCORE}` };
}

function parseColumn<T>(schema: z.ZodType<T>, text: string, row: DecisionLogRow, column: string): Result<T, LoreError> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return err({ code: "STORE_ERROR", message: `decision_log row ${row.id}: column ${column} is not valid JSON` });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return err({ code: "STORE_ERROR", message: `decision_log row ${row.id}: column ${column} has an unexpected shape` });
  return ok(parsed.data);
}

/** The `factors` column of `row` (factor name -> score), or STORE_ERROR when it no longer parses. */
export function parseRowFactors(row: DecisionLogRow): Result<Readonly<Record<string, number>>, LoreError> {
  return parseColumn(factorsSchema, row.factors, row, "factors");
}

/** The `reasons` column of `row`, or STORE_ERROR when it no longer parses. */
export function parseRowReasons(row: DecisionLogRow): Result<readonly string[], LoreError> {
  return parseColumn(reasonsSchema, row.reasons, row, "reasons");
}

/** facts key that marks a closing record; the value is {@link SupersedeMarkerFacts}. */
export const SUPERSEDED_FACTS_KEY = "superseded";

export type SupersedeCause = "newer-version" | "subject-gone" | "withdrawn";

/** Existence of a decision's subject right now. `unknown` (the probe could not measure) NEVER closes a decision. */
export type SubjectExistence = "present" | "absent" | "unknown";
export type SubjectExistenceProbe = (subject: { readonly id: string; readonly version: string }) => Promise<SubjectExistence>;
/** Class id -> existence probe. A class with no probe is only ever closed by a newer version. */
export type SubjectExistenceProbes = Readonly<Record<string, SubjectExistenceProbe>>;

/** True for a closing marker row appended by DecisionService: machine channel, verdict `superseded` (migration 023). */
export function isSupersedeMarker(row: DecisionLogRow): boolean {
  return row.channel === "machine" && row.verdict === "superseded";
}

type DecisionKey = { readonly class: string; readonly subject_id: string; readonly subject_version: string };

function sameKey(row: DecisionLogRow, key: DecisionKey): boolean {
  return row.class === key.class && row.subject_id === key.subject_id && row.subject_version === key.subject_version;
}

/** A pending decision plus the id of its latest escalate row (the marker / newer-version comparison point). */
export interface OpenEscalation extends PendingDecision {
  readonly latest_escalate_id: number;
}

/**
 * Open escalations over `rows` (any superset of the log, id ASC), ordered by id, with closing markers applied but
 * WITHOUT the newer-version rule: the candidates DecisionService probes and closes. Readers use
 * {@link derivePendingDecisions}.
 *
 * @returns err(STORE_ERROR) when an escalating row's JSON columns do not parse.
 */
export function deriveOpenEscalations(rows: readonly DecisionLogRow[]): Result<OpenEscalation[], LoreError> {
  const keys = new Map<string, DecisionKey>();
  for (const row of rows) {
    if (row.channel !== "machine" || row.verdict !== "escalate") continue;
    keys.set(JSON.stringify([row.class, row.subject_id, row.subject_version]), {
      class: row.class,
      subject_id: row.subject_id,
      subject_version: row.subject_version,
    });
  }
  const pending: OpenEscalation[] = [];
  for (const key of keys.values()) {
    const effective = effectiveDecisionVerdict(rows, key);
    if (effective === null || effective.channel !== "machine" || effective.verdict !== "escalate") continue;
    const escalations = rows.filter((r) => r.channel === "machine" && r.verdict === "escalate" && sameKey(r, key));
    const first = escalations[0];
    const latestEscalate = escalations[escalations.length - 1];
    const latest = rows.find((r) => r.id === effective.record_id);
    if (first === undefined || latestEscalate === undefined || latest === undefined) continue;
    if (rows.some((r) => r.id > latestEscalate.id && sameKey(r, key) && isSupersedeMarker(r))) continue;
    const factors = parseColumn(factorsSchema, latest.factors, latest, "factors");
    if (!factors.ok) return factors;
    const reasons = parseColumn(reasonsSchema, latest.reasons, latest, "reasons");
    if (!reasons.ok) return reasons;
    const recommendation = recommendAnswer(latest.score, latest.threshold);
    pending.push({
      id: first.id,
      class: key.class,
      subject_id: key.subject_id,
      subject_version: key.subject_version,
      opened_at: first.ts,
      score: latest.score,
      threshold: latest.threshold,
      factors: factors.value,
      reasons: reasons.value,
      recommended: recommendation.answer,
      recommended_reason: recommendation.reason,
      detail: latest.detail ?? null,
      latest_escalate_id: latestEscalate.id,
    });
  }
  return ok(pending.sort((a, b) => a.id - b.id));
}

/**
 * Classes whose pending decision is ONLY ever answered by a human-tty record (AU-T9): their subject never "disappears"
 * and a re-measurement on another version must not close the open question. The newer-version rule skips them and they
 * have no existence probe. (Rows of class `autonomy-threshold-write` are not escalations, so they never become pending.)
 */
export const HUMAN_ANSWER_ONLY_CLASSES: readonly string[] = ["threshold-integrity"];

/**
 * The newest later row that supersedes `pending` by re-measuring the SAME class + subject id on ANOTHER version, or
 * null. "Later" is log order (id above the pending key's latest escalate row); closing markers do not count.
 */
export function newerVersionSupersession(rows: readonly DecisionLogRow[], pending: OpenEscalation): DecisionLogRow | null {
  if (HUMAN_ANSWER_ONLY_CLASSES.includes(pending.class)) return null;
  let newest: DecisionLogRow | null = null;
  for (const row of rows) {
    if (row.id <= pending.latest_escalate_id) continue;
    if (row.class !== pending.class || row.subject_id !== pending.subject_id) continue;
    if (row.subject_version === pending.subject_version || isSupersedeMarker(row)) continue;
    newest = row;
  }
  return newest;
}

/**
 * Open escalations over `rows` (any superset of the log, id ASC), ordered by id: escalations no human answered, no
 * marker closed and no newer subject version replaced.
 *
 * @returns err(STORE_ERROR) when an escalating row's JSON columns do not parse.
 */
export function derivePendingDecisions(rows: readonly DecisionLogRow[]): Result<PendingDecision[], LoreError> {
  const open = deriveOpenEscalations(rows);
  if (!open.ok) return open;
  const pending: PendingDecision[] = [];
  for (const candidate of open.value) {
    if (newerVersionSupersession(rows, candidate) !== null) continue;
    const { latest_escalate_id: _latest, ...visible } = candidate;
    pending.push(visible);
  }
  return ok(pending);
}
