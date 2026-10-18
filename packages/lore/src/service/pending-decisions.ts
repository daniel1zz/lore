/**
 * Pending decisions — the open escalations derived from the decision log.
 *
 * Purpose: a pending decision is not a separate table; it is a (class, subject, version) whose EFFECTIVE verdict
 * is a machine `escalate` (no human-tty record has answered it). This module derives that list from the log rows.
 * Public surface: derivePendingDecisions, recommendAnswer, PendingDecision, RECOMMEND_ACCEPT_MIN_SCORE.
 * Invariants:
 *   - `id` is the id of the FIRST machine escalate row of the key, so it stays the same when the escalating
 *     operation is re-run and appends further escalate rows.
 *   - Only `human-tty` (and a worse machine verdict) change a key's effective verdict; an agent-asserted row is
 *     invisible here, so it can neither resolve nor hide a pending decision.
 *   - The row's JSON columns were written by DecisionService; a column that no longer parses is returned as a
 *     STORE_ERROR, never defaulted.
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

/**
 * Open escalations over `rows` (any superset of the log, id ASC), ordered by id.
 *
 * @returns err(STORE_ERROR) when an escalating row's JSON columns do not parse.
 */
export function derivePendingDecisions(rows: readonly DecisionLogRow[]): Result<PendingDecision[], LoreError> {
  const keys = new Map<string, { class: string; subject_id: string; subject_version: string }>();
  for (const row of rows) {
    if (row.channel !== "machine" || row.verdict !== "escalate") continue;
    keys.set(JSON.stringify([row.class, row.subject_id, row.subject_version]), {
      class: row.class,
      subject_id: row.subject_id,
      subject_version: row.subject_version,
    });
  }
  const pending: PendingDecision[] = [];
  for (const key of keys.values()) {
    const effective = effectiveDecisionVerdict(rows, key);
    if (effective === null || effective.channel !== "machine" || effective.verdict !== "escalate") continue;
    const escalations = rows.filter(
      (r) =>
        r.channel === "machine" &&
        r.verdict === "escalate" &&
        r.class === key.class &&
        r.subject_id === key.subject_id &&
        r.subject_version === key.subject_version,
    );
    const first = escalations[0];
    const latest = rows.find((r) => r.id === effective.record_id);
    if (first === undefined || latest === undefined) continue;
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
    });
  }
  return ok(pending.sort((a, b) => a.id - b.id));
}
