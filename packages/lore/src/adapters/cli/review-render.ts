/**
 * Terminal rendering for `lore review`'s human-readable single-doc/`--pending` summary
 * (SPEC-034 §4; D11 nudge extension, SPEC-044 §Design Decisions D11). Extracted from
 * `commands/review.ts` into its own module so it can be unit-tested directly under
 * vitest — `commands/review.ts` transitively imports `loader.ts` (`bun:sqlite`), which
 * vitest cannot resolve, but this module imports only `@lore/core` + `./utils.js` +
 * `../../flows/staleness-flow.js` (all vitest-safe). Mirrors `status-stamp-verdict.ts`'s split
 * for the identical reason.
 *
 * Public surface:
 *   formatJudgmentSummary(judgment) — the pre-SPEC-044 verdict/reasons/checks/blocking-
 *     questions/judge-identity rendering, UNCHANGED (byte-identical, REGRESSION-protected;
 *     `AC-SP-8`).
 *   renderSupersededCandidateNudgeBlock(deps, judgedDocSlug, judgment) — the D11 byproduct:
 *     `""` when `judgment.superseded_candidate` is absent (so appending this to
 *     `formatJudgmentSummary`'s output is a no-op, REGRESSION-safe concatenation); else the
 *     resolved `lore invalidate <old> --superseded-by <X>` nudge or an unresolved-ref note.
 *
 * @invariant `renderSupersededCandidateNudgeBlock` never mutates `formatJudgmentSummary`'s
 *   own output — the two are separately callable and always CONCATENATED by the caller
 *   (`commands/review.ts`), never merged into one function, so the REGRESSION guarantee
 *   ("absent field → rendering byte-identical to pre-SPEC-044") is structurally provable
 *   by calling `formatJudgmentSummary` alone.
 *
 * Side-effect class: pure (`formatJudgmentSummary`) / IO (`renderSupersededCandidateNudgeBlock`,
 *   delegates entirely to the injected `StalenessFlowDeps`)
 * Source: SPEC-034 §4; SPEC-044 §Design Decisions D11
 */

import type { LoreError, ReviewJudgment } from "@lore/core";
import { exitCode, formatTable } from "./utils.js";
import { renderSupersededCandidateNudge, type StalenessFlowDeps } from "../../flows/staleness-flow.js";

/**
 * Human-readable rendering of one recorded judgment (SPEC-034 §4). UNCHANGED from the
 * pre-SPEC-044 implementation (moved verbatim out of `commands/review.ts`) — this is the
 * REGRESSION anchor: a judgment with no `superseded_candidate` renders exactly this and
 * nothing more.
 */
export function formatJudgmentSummary(judgment: ReviewJudgment): string {
  const lines: string[] = [];
  lines.push(`Decision: ${judgment.decision} (confidence: ${judgment.confidence.toFixed(2)})`);
  lines.push("");

  if (judgment.reasons.length > 0) {
    lines.push(
      formatTable(
        ["Dimension", "Finding", "Evidence"],
        judgment.reasons.map((r) => [r.dimension, r.finding, r.evidence_ref ?? ""]),
      ),
    );
    lines.push("");
  }

  if (judgment.checks.length > 0) {
    lines.push(
      formatTable(
        ["Check", "Outcome", "Detail"],
        judgment.checks.map((c) => [c.check, c.outcome, c.detail ?? ""]),
      ),
    );
    lines.push("");
  }

  if (judgment.decision === "escalate" && judgment.blocking_questions.length > 0) {
    lines.push("Blocking questions:");
    for (const q of judgment.blocking_questions) lines.push(`  - ${q}`);
    lines.push("");
  }

  lines.push(`Judge: ${judgment.judge.provider} (model: ${judgment.judge.model}, prompt ${judgment.judge.prompt_version})`);
  return lines.join("\n");
}

/**
 * D11 — the invalidate-nudge block appended after {@link formatJudgmentSummary}'s output.
 * `""` (no-op) when `judgment.superseded_candidate` is absent — the REGRESSION guarantee:
 * `formatJudgmentSummary(judgment) + await renderSupersededCandidateNudgeBlock(deps, slug, judgment)`
 * is byte-identical to `formatJudgmentSummary(judgment)` alone for every pre-SPEC-044 judgment.
 *
 * @param deps - See {@link StalenessFlowDeps}
 * @param judgedDocSlug - Slug of the document under review (the believed successor)
 * @param judgment - The persisted review judgment (any kind; only inspected for
 *   `superseded_candidate`)
 * @example
 * const block = await renderSupersededCandidateNudgeBlock(deps, "adr-new", judgment);
 * console.log(formatJudgmentSummary(judgment) + block);
 */
export async function renderSupersededCandidateNudgeBlock(
  deps: StalenessFlowDeps,
  judgedDocSlug: string,
  judgment: ReviewJudgment,
): Promise<string> {
  if (judgment.superseded_candidate === undefined) return "";

  const nudge = await renderSupersededCandidateNudge(deps, judgedDocSlug, judgment.superseded_candidate);
  return nudge.resolved ? `\n\nSuggested: ${nudge.command}` : `\n\nNote: ${nudge.note}`;
}

/**
 * F1 — one line per prompt section that was cut to fit its budget, appended after
 * {@link formatJudgmentSummary}. Pure; `""` when `judgment.truncation` is absent/empty (the
 * REGRESSION guarantee for every judgment whose inputs fit and every pre-F1 row). The numbers
 * are the service-measured lengths stored on the judgment, never re-derived here.
 */
export function renderTruncationBlock(judgment: ReviewJudgment): string {
  const cuts = judgment.truncation;
  if (cuts === undefined || cuts.length === 0) return "";
  const lines = cuts.map((c) => `  - ${c.section} cut: showed ${c.shown_chars} of ${c.total_chars} chars`);
  return `\n\nTruncated input (the judge did not see the rest):\n${lines.join("\n")}`;
}

/** Failure tally of one `review --pending` batch: per-code counts and the exit code they imply. */
export interface BatchFailureSummary {
  /** Failure count per error code, in first-seen order. */
  readonly byCode: ReadonlyMap<string, number>;
  /** 0 when nothing failed or some docs succeeded; else the shared code, or 1 for mixed causes. */
  readonly exitCode: number;
}

/**
 * Exit policy of a `review --pending` batch. A batch where some docs were judged keeps exit 0 (the
 * failures are warned about); a batch where EVERY doc failed exits with the failures' own code
 * (VALIDATION_ERROR 4, AI_PROVIDER_ERROR 6, ...), or 1 when the causes differ — never a blanket 6,
 * which told a caller an AI provider was down when the AI was never reached.
 *
 * @param errors - The error of each failed doc.
 * @param reviewedCount - Total docs in the batch (failed + judged).
 */
export function summarizeBatchFailures(errors: readonly LoreError[], reviewedCount: number): BatchFailureSummary {
  const byCode = new Map<string, number>();
  for (const e of errors) byCode.set(e.code, (byCode.get(e.code) ?? 0) + 1);
  if (errors.length === 0 || errors.length < reviewedCount) return { byCode, exitCode: 0 };
  const exits = new Set(errors.map((e) => exitCode(e)));
  const [only] = [...exits];
  return { byCode, exitCode: exits.size === 1 && only !== undefined ? only : 1 };
}

/** One stderr line per failure code: `  VALIDATION_ERROR: 1`. */
export function renderBatchFailureCounts(byCode: ReadonlyMap<string, number>): string {
  return [...byCode].map(([code, n]) => `  ${code}: ${n}`).join("\n");
}
