/**
 * Milestone review: the shapes of the one binding review `lore assess` stores per plan (BR-1372).
 *
 * Purpose: the single home of the seven review dimensions, the judge's output shape, the stored review shape and the
 *   deterministic verdict rules. Plan close reads the stored review; nothing else decides it.
 * Public surface: MILESTONE_DIMENSIONS, MilestoneDimension, DimensionVerdict, dimensionJudgmentSchema,
 *   llmMilestoneOutputSchema, LlmMilestoneOutput, milestoneReviewSchema, MilestoneReview, applyDeterministicDimensionRules,
 *   overallMilestoneVerdict, failedDimensions, renderMilestoneReviewContent.
 * Invariants:
 *   - Exactly seven dimensions; the judge must return all seven (a missing one is a parse failure, never "pass").
 *   - Overall verdict is `pass` iff no dimension is `fail` (`na` never fails a review).
 *   - `design_necessity` passes only with a non-empty reference: a technical choice that names no external practice
 *     it follows is a fail, whatever the judge said (ADR adr-ai-decision-standard-four-checks-references-from-excellent).
 * Side-effect class: pure (no IO, no clock).
 *
 * Source: spec-lean-governance-batch-verbs-judgment-only-at-milestones Part D, AC-LG-12, BR-1372.
 */

import { z } from "zod";

/** The seven dimensions, in render order. */
export const MILESTONE_DIMENSIONS = [
  "correctness_vs_acs",
  "spec_conformance",
  "regression",
  "design_necessity",
  "snapshot_accuracy",
  "concurrency_safety",
  "security",
] as const;

export type MilestoneDimension = (typeof MILESTONE_DIMENSIONS)[number];

/** One dimension's verdict. */
export const dimensionVerdictSchema = z.enum(["pass", "fail", "na"]);
export type DimensionVerdict = z.infer<typeof dimensionVerdictSchema>;

/** A dimension judgment: verdict, the reason for it, and the reference (an external practice, a doc, a commit). */
export const dimensionJudgmentSchema = z.object({
  verdict: dimensionVerdictSchema,
  reason: z.string().trim().min(1),
  /** May be empty only where no reference applies; `design_necessity` needs one to pass. */
  reference: z.string().trim(),
});
export type DimensionJudgment = z.infer<typeof dimensionJudgmentSchema>;

const dimensionsShape = Object.fromEntries(MILESTONE_DIMENSIONS.map((d) => [d, dimensionJudgmentSchema])) as Record<
  MilestoneDimension,
  typeof dimensionJudgmentSchema
>;

/** The shape the judge returns. */
export const llmMilestoneOutputSchema = z.object({
  dimensions: z.object(dimensionsShape),
});
export type LlmMilestoneOutput = z.infer<typeof llmMilestoneOutputSchema>;

/** A `milestone` decision (BR-1370) the review lists under correctness. */
export const milestoneDecisionRefSchema = z.object({
  class: z.string().min(1),
  document: z.string().min(1),
  summary: z.string(),
});
export type MilestoneDecisionRef = z.infer<typeof milestoneDecisionRefSchema>;

/** The stored review (`extra.milestone_review` of a knowledge doc with sub_type `milestone-review`). */
export const milestoneReviewSchema = z.object({
  plan_id: z.string().min(1),
  /** The plan-state fingerprint this review judged; close compares it with the fingerprint at close time. */
  fingerprint: z.string().min(1),
  overall: z.enum(["pass", "fail"]),
  dimensions: z.object(dimensionsShape),
  decisions: z.array(milestoneDecisionRefSchema),
  prompt_version: z.string().min(1),
  /** How the diff was obtained, e.g. `auto_derived:derived` or `none`. */
  diff_source: z.string().min(1),
});
export type MilestoneReview = z.infer<typeof milestoneReviewSchema>;

/**
 * Applies the rules the judge cannot waive: `design_necessity` without a reference fails.
 *
 * @param dimensions - the judge's seven judgments
 * @returns the same judgments, with a referenceless `design_necessity` pass turned into a named fail
 */
export function applyDeterministicDimensionRules(
  dimensions: LlmMilestoneOutput["dimensions"],
): LlmMilestoneOutput["dimensions"] {
  const design = dimensions.design_necessity;
  if (design.verdict === "pass" && design.reference.length === 0) {
    return {
      ...dimensions,
      design_necessity: {
        verdict: "fail",
        reason: `No external reference named for the technical choices (judge said: ${design.reason})`,
        reference: "",
      },
    };
  }
  return dimensions;
}

/** `pass` iff no dimension is `fail`. */
export function overallMilestoneVerdict(dimensions: LlmMilestoneOutput["dimensions"]): "pass" | "fail" {
  return MILESTONE_DIMENSIONS.some((d) => dimensions[d].verdict === "fail") ? "fail" : "pass";
}

/** The dimensions whose verdict is `fail`, in render order. */
export function failedDimensions(dimensions: LlmMilestoneOutput["dimensions"]): MilestoneDimension[] {
  return MILESTONE_DIMENSIONS.filter((d) => dimensions[d].verdict === "fail");
}

/** Deterministic Markdown of a stored review; its SSOT is `extra.milestone_review`. */
export function renderMilestoneReviewContent(review: MilestoneReview): string {
  const lines = [`# Milestone review: ${review.overall.toUpperCase()}`, "", `Fingerprint: ${review.fingerprint}`, `Diff: ${review.diff_source}`, ""];
  lines.push("| Dimension | Verdict | Reason | Reference |", "|---|---|---|---|");
  for (const d of MILESTONE_DIMENSIONS) {
    const j = review.dimensions[d];
    lines.push(`| ${d} | ${j.verdict} | ${j.reason.replace(/\|/g, "/")} | ${j.reference.replace(/\|/g, "/")} |`);
  }
  if (review.decisions.length > 0) {
    lines.push("", "## Milestone decisions", "");
    for (const dec of review.decisions) lines.push(`- ${dec.class} on ${dec.document}: ${dec.summary}`);
  }
  return lines.join("\n");
}
