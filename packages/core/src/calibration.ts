/**
 * Calibration schema — the human-outcome record attached to a review judgment
 * (did a human confirm or override the AI judge's decision?), plus the Wilson
 * score interval used to turn a small confirmed/overridden sample into a
 * conservative confidence-calibration signal. Pure, browser-safe module: no
 * IO, no Date.now()/Math.random() calls.
 *
 * Public surface:
 *   - CALIBRATION_OUTCOMES / CalibrationOutcome — confirmed vs overridden
 *   - calibrationRecordSchema / CalibrationRecord — one row in `calibration_records`
 *   - wilsonLowerBound(successes, n, z?) — Wilson score interval lower bound,
 *     used to rank/threshold a judge's track record without small-sample
 *     overconfidence (SPEC-034 §2)
 *
 * Invariants:
 *   - wilsonLowerBound never throws — n=0 returns 0 (no evidence ⇒ zero confidence,
 *     not NaN); result is always clamped to [0, 1].
 *   - calibrationRecordSchema.doc_type reuses DOC_TYPE_ROLE_MAP's keys as its SSOT
 *     enum (types.ts) rather than declaring a second literal union that could drift.
 *
 * Side-effect class: pure
 *
 * Source: SPEC-034 §2, §3
 */

import { z } from "zod";
import { DOC_TYPE_ROLE_MAP, type DocType } from "./types.js";

// ─── Doc Type Enum (derived from types.ts SSOT) ────────────────────────────

const DOC_TYPES = Object.keys(DOC_TYPE_ROLE_MAP) as [DocType, ...DocType[]];

// ─── Human Outcome ──────────────────────────────────────────────────────────

/** The two ways a human can dispose of an AI review judgment. */
export const CALIBRATION_OUTCOMES = ["confirmed", "overridden"] as const;

/** Derived TypeScript type for a calibration outcome. */
export type CalibrationOutcome = (typeof CALIBRATION_OUTCOMES)[number];

// ─── Calibration Record ─────────────────────────────────────────────────────

/**
 * One row in `calibration_records` (migration-003.ts) — records whether a
 * human confirmed or overrode a specific `review_judgments` row, and (when
 * overridden) why.
 *
 * @example
 * calibrationRecordSchema.parse({
 *   id: "01ARZ3...", judgment_id: "01ARZ3...", doc_id: "01ARZ3...", doc_type: "spec",
 *   human_outcome: "overridden", delta_reasons: ["missed a broken cross-link"],
 *   actor: "alice", created_at: "2026-07-06T00:00:00.000Z",
 * });
 */
export const calibrationRecordSchema = z.object({
  id: z.string(),
  judgment_id: z.string(),
  doc_id: z.string(),
  doc_type: z.enum(DOC_TYPES),
  human_outcome: z.enum(CALIBRATION_OUTCOMES),
  delta_reasons: z.array(z.string()),
  actor: z.string(),
  created_at: z.string(),
});

/** Derived TypeScript type for a calibration record. */
export type CalibrationRecord = z.infer<typeof calibrationRecordSchema>;

// ─── Wilson Score Interval ──────────────────────────────────────────────────

/**
 * Wilson score interval lower bound for a binomial proportion — the standard
 * "confidence, penalized for small samples" statistic (used here to rank a
 * judge's confirmed-rate without a handful of lucky confirmations reading as
 * high confidence). Never throws.
 *
 * @invariant n === 0 → returns 0 (no evidence yet; never NaN/Infinity).
 * @invariant Return value is always clamped to [0, 1] (guards floating-point
 *   overshoot at the successes === n boundary).
 *
 * @param successes - Count of "confirmed" outcomes
 * @param n - Total observations (confirmed + overridden)
 * @param z - Z-score for the desired confidence level (default 1.96 ≈ 95%)
 * @returns Lower bound of the Wilson score interval, in [0, 1]
 *
 * @example
 * wilsonLowerBound(0, 0);       // → 0 (no data)
 * wilsonLowerBound(10, 10);     // → close to 1 but not exactly 1 (small-sample penalty)
 * wilsonLowerBound(950, 1000);  // → much closer to 0.95 (large-sample tight interval)
 */
export function wilsonLowerBound(successes: number, n: number, z = 1.96): number {
  if (n === 0) return 0;

  const phat = successes / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const center = phat + z2 / (2 * n);
  const margin = z * Math.sqrt((phat * (1 - phat)) / n + z2 / (4 * n * n));

  const lowerBound = (center - margin) / denominator;

  // reason: the closed-form Wilson formula stays within [0, 1] analytically, but
  // floating-point rounding at the successes===0 or successes===n boundaries can
  // overshoot by an epsilon — clamp defensively so callers never see -1e-17 or
  // 1.0000000000000002. See SPEC-034 §2.
  return Math.min(1, Math.max(0, lowerBound));
}
