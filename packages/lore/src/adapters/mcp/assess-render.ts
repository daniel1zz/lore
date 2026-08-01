/**
 * MCP-facing text rendering for `lore_assess`'s response envelope (SPEC-040 §T3 D3).
 * Extracted from `tools.ts` into its own module — a plain string-building helper, kept
 * out of `tools.ts` (the tsc-hotspot file, ADR "Fast Path" Pattern 1) and independently
 * unit-testable without registering a full MCP server.
 *
 * Public surface:
 *   - buildAssessSummaryText(result) — a compact Markdown digest of an AssessmentResult
 *     (verdict + AC score table + gaps + recommendations + judge metadata), additively
 *     extended with dimension scores / typed gaps / typed recommendations / rubric
 *     warnings tables when present on the result. Added to `lore_assess`'s JSON envelope
 *     as `summary` — the envelope's existing `assessment`/`result` fields already carry
 *     the full typed data verbatim; `summary` exists so an agent reading MCP text
 *     content gets a scannable digest without re-deriving one from the nested JSON.
 *
 * Invariants:
 *   - No IO, no wall-clock reads — pure string assembly (mirrors
 *     `@lore/core`'s renderAssessmentContent and the CLI's assess-render.ts).
 *   - Every SPEC-040 block is additive and presence-guarded: a legacy-only
 *     AssessmentResult renders byte-identically to the pre-SPEC-040 shape
 *     (regression-protected).
 *   - Markdown pipe-table format (not CLI's Unicode box-drawing) — this text is
 *     consumed by an LLM agent, not a terminal.
 *
 * Side-effect class: pure
 *
 * Source: SPEC-026 §5; SPEC-040 §T3 D3, AC-ADF-13
 */

import type { AssessmentResult } from "@lore/core";

/** Escape a table cell for Markdown pipe-table safety. */
function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/**
 * Build a compact Markdown digest of an AssessmentResult for `lore_assess`'s MCP
 * response envelope. Byte-identical (for the legacy-only shape) whether or not
 * SPEC-040 typed fields are present — every additive block is presence-guarded.
 */
export function buildAssessSummaryText(result: AssessmentResult): string {
  const lines: string[] = [];

  // SPEC-067 D4: overall_score is omitted at 100% task-truncation coverage (verdict
  // "inconclusive") — render an explicit placeholder rather than interpolating `undefined`.
  const scoreLabel = result.overall_score !== undefined ? `${result.overall_score}/100` : "N/A (fully truncated)";
  lines.push(`Verdict: ${result.verdict} (score: ${scoreLabel})`);
  lines.push("");

  if (result.ac_scores.length > 0) {
    lines.push("| AC | Score | Reasoning |");
    lines.push("|---|---|---|");
    for (const ac of result.ac_scores) {
      lines.push(`| ${ac.ac_id} | ${ac.score} | ${escapeCell(ac.reasoning)} |`);
    }
    lines.push("");
  }

  if (result.gaps.length > 0) {
    lines.push("Gaps:");
    for (const g of result.gaps) lines.push(`- ${g}`);
    lines.push("");
  }

  if (result.recommendations.length > 0) {
    lines.push("Recommendations:");
    for (const r of result.recommendations) lines.push(`- ${r}`);
    lines.push("");
  }

  // reason: additive-only (SPEC-040 §T3 D3) — presence-guarded, mirrors the CLI's
  // assess-render.ts and @lore/core's renderAssessmentContent so a legacy-only result
  // renders with none of these blocks (regression-protected).
  if (result.dimension_scores && Object.keys(result.dimension_scores).length > 0) {
    lines.push("Dimension Scores (confidence: self-reported, uncalibrated):");
    lines.push("| Dimension | Score | Confidence | Based On | Reasoning |");
    lines.push("|---|---|---|---|---|");
    for (const [dimension, entry] of Object.entries(result.dimension_scores)) {
      lines.push(
        `| ${dimension} | ${entry.score} | ${entry.confidence} | ${entry.based_on} | ${escapeCell(entry.reasoning)} |`,
      );
    }
    lines.push("");
  }

  if (result.typed_gaps && result.typed_gaps.length > 0) {
    lines.push("Typed Gaps:");
    lines.push("| Dimension | Severity | AC Ref | Statement |");
    lines.push("|---|---|---|---|");
    for (const gap of result.typed_gaps) {
      lines.push(`| ${gap.dimension} | ${gap.severity} | ${gap.ac_ref ?? "—"} | ${escapeCell(gap.statement)} |`);
    }
    lines.push("");
  }

  if (result.typed_recommendations && result.typed_recommendations.length > 0) {
    lines.push("Typed Recommendations:");
    lines.push("| Target | Action | Rationale |");
    lines.push("|---|---|---|");
    for (const rec of result.typed_recommendations) {
      lines.push(`| ${rec.target} | ${escapeCell(rec.action)} | ${escapeCell(rec.rationale)} |`);
    }
    lines.push("");
  }

  // reason: task-lore-assess-derives-a-plan-s-commits-by-grepping-task AC #3 — previously
  // absent from this MCP summary entirely (`result.unverifiable[]` was persisted but only
  // core's `renderAssessmentContent` rendered it) — additive and presence-guarded, mirrors
  // the CLI's assess-render.ts. This is where an agent reading `lore_assess`'s `summary`
  // sees the AC #3 "not scored" wording `forceScopeFidelityUnverifiable`
  // (ai-provider-service.ts) forces into `unverifiable[]`, not just the nested `result`
  // JSON or the persisted Markdown doc.
  if (result.unverifiable && result.unverifiable.length > 0) {
    lines.push("Unverifiable:");
    for (const u of result.unverifiable) lines.push(`- ${escapeCell(u.material)}: ${escapeCell(u.reason)}`);
    lines.push("");
  }

  if (result.rubric_warning && result.rubric_warning.length > 0) {
    lines.push("Rubric Warnings:");
    for (const w of result.rubric_warning) lines.push(`- ${w}`);
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
