/**
 * Terminal rendering for `lore assess`'s human-readable summary (SPEC-026 §8.3,
 * SPEC-040 §T3 D3). Extracted from `commands/assess.ts` into its own module so it can
 * be unit-tested directly under vitest — `commands/assess.ts` transitively imports
 * `loader.ts` (`bun:sqlite`), which vitest cannot resolve, but this module imports only
 * `@lore/core` and `./utils.js` (both vitest-safe).
 *
 * Public surface:
 *   - formatAssessmentSummary(result) — verdict + AC score table + gaps +
 *     recommendations + judge metadata (legacy shape, byte-identical when no SPEC-040
 *     typed fields are present) PLUS, additively, dimension scores / typed gaps /
 *     typed recommendations / rubric warnings tables when present on the result.
 *
 * Invariants:
 *   - No IO, no wall-clock reads — pure string assembly over an already-computed
 *     AssessmentResult (mirrors `renderAssessmentContent`'s determinism contract).
 *   - Every SPEC-040 block is additive and presence-guarded: a legacy-only
 *     AssessmentResult (no dimension_scores/typed_gaps/typed_recommendations/
 *     rubric_warning) renders BYTE-IDENTICALLY to the pre-SPEC-040 shape
 *     (regression-protected, mirrors `@lore/core`'s renderAssessmentContent).
 *   - Dimension score confidence is explicitly labeled "self-reported, uncalibrated" —
 *     never presented as a calibrated probability (same wording as
 *     `renderAssessmentContent`'s Dimension Scores table header).
 *
 * Side-effect class: pure
 *
 * Source: SPEC-026 §8.3; SPEC-040 §T3 D3, AC-ADF-13
 */

import type { AssessmentResult } from "@lore/core";
import { formatTable } from "./utils.js";

/** Human-readable verdict + AC score table rendering for terminal output. */
export function formatAssessmentSummary(result: AssessmentResult): string {
  const lines: string[] = [];
  // SPEC-067 D4: overall_score is omitted at 100% task-truncation coverage (verdict
  // "inconclusive") — render an explicit placeholder rather than interpolating `undefined`.
  const scoreLabel = result.overall_score !== undefined ? `${result.overall_score}/100` : "N/A (fully truncated)";
  lines.push(`Verdict: ${result.verdict} (score: ${scoreLabel})`);
  lines.push("");

  if (result.ac_scores.length > 0) {
    lines.push(
      formatTable(
        ["AC", "Score", "Reasoning"],
        result.ac_scores.map((ac) => [ac.ac_id, String(ac.score), ac.reasoning]),
      ),
    );
    lines.push("");
  }

  if (result.gaps.length > 0) {
    lines.push("Gaps:");
    for (const g of result.gaps) lines.push(`  - ${g}`);
    lines.push("");
  }

  if (result.recommendations.length > 0) {
    lines.push("Recommendations:");
    for (const r of result.recommendations) lines.push(`  - ${r}`);
    lines.push("");
  }

  // reason: every block below is additive-only (SPEC-040 §T3 D3) — guarded by presence
  // of its own optional field, so a legacy AssessmentResult with none of these fields
  // set renders byte-identically to the pre-SPEC-040 shape (REGRESSION-tested).
  if (result.dimension_scores && Object.keys(result.dimension_scores).length > 0) {
    lines.push("Dimension Scores (confidence: self-reported, uncalibrated):");
    lines.push(
      formatTable(
        ["Dimension", "Score", "Confidence", "Based On", "Reasoning"],
        Object.entries(result.dimension_scores).map(([dimension, entry]) => [
          dimension,
          String(entry.score),
          String(entry.confidence),
          entry.based_on,
          entry.reasoning,
        ]),
      ),
    );
    lines.push("");
  }

  if (result.typed_gaps && result.typed_gaps.length > 0) {
    lines.push("Typed Gaps:");
    lines.push(
      formatTable(
        ["Dimension", "Severity", "AC Ref", "Statement"],
        result.typed_gaps.map((gap) => [gap.dimension, gap.severity, gap.ac_ref ?? "—", gap.statement]),
      ),
    );
    lines.push("");
  }

  if (result.typed_recommendations && result.typed_recommendations.length > 0) {
    lines.push("Typed Recommendations:");
    lines.push(
      formatTable(
        ["Target", "Action", "Rationale"],
        result.typed_recommendations.map((rec) => [rec.target, rec.action, rec.rationale]),
      ),
    );
    lines.push("");
  }

  if (result.rubric_warning && result.rubric_warning.length > 0) {
    lines.push("Rubric Warnings:");
    for (const w of result.rubric_warning) lines.push(`  - ${w}`);
    lines.push("");
  }

  lines.push(
    `Judge: ${result.judgment.provider} (prompt v${result.judgment.prompt_version}, ` +
      `${result.judgment.duration_ms}ms, retried: ${result.judgment.retried}` +
      (result.judgment.truncated.length > 0 ? `, truncated: ${result.judgment.truncated.join(", ")}` : "") +
      `)`,
  );

  // SPEC-067 D4: additive-only — absent on every pre-SPEC-067 assessment and every run
  // below the truncation-cap threshold.
  if (result.judgment.overall_confidence !== undefined) {
    lines.push(
      `Overall confidence: ${result.judgment.overall_confidence}` +
        (result.judgment.degraded_by_truncation ? " (degraded by truncation)" : ""),
    );
  }

  return lines.join("\n");
}
