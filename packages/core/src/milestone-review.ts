/**
 * Milestone review: the shapes of the one binding review `lore assess` stores per plan (BR-1372).
 *
 * Purpose: the single home of the seven review dimensions, the judge's output shape, the stored review shape and the
 *   deterministic verdict rules. Plan close reads the stored review; nothing else decides it.
 * Public surface: MILESTONE_DIMENSIONS, MEASURED_CAUSE_DIMENSIONS, MilestoneDimension, DimensionVerdict, dimensionJudgmentSchema,
 *   llmMilestoneOutputSchema, LlmMilestoneOutput, milestoneReviewSchema, MilestoneReview, applyDeterministicDimensionRules,
 *   overallMilestoneVerdict, failedDimensions, renderMilestoneReviewContent, retiredAcRefSchema, RetiredAcRef.
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

/** Dimensions whose root cause is measured (suite failing set, contradicted rules), never taken from the judge's cites. */
export const MEASURED_CAUSE_DIMENSIONS: readonly MilestoneDimension[] = ["regression", "snapshot_accuracy"];

/** One dimension's verdict. */
export const dimensionVerdictSchema = z.enum(["pass", "fail", "na"]);
export type DimensionVerdict = z.infer<typeof dimensionVerdictSchema>;

/** A dimension judgment: verdict, the reason for it, and the reference (an external practice, a doc, a commit). */
export const dimensionJudgmentSchema = z.object({
  verdict: dimensionVerdictSchema,
  reason: z.string().trim().min(1),
  /** May be empty only where no reference applies; `design_necessity` needs one to pass. */
  reference: z.string().trim(),
  /**
   * Stable cites of a failed finding: AC ids, rule ids, file paths or symbols it names. They are the root-cause identity
   * of a judge-text finding (never its wording). Optional in the stored shape only because reviews stored before this
   * field exist; `llmMilestoneOutputSchema` requires them on a failed non-measured dimension.
   */
  cites: z.array(z.string().trim().min(1)).optional(),
});
export type DimensionJudgment = z.infer<typeof dimensionJudgmentSchema>;

const dimensionsShape = Object.fromEntries(MILESTONE_DIMENSIONS.map((d) => [d, dimensionJudgmentSchema])) as Record<
  MilestoneDimension,
  typeof dimensionJudgmentSchema
>;

/** The shape the judge returns. */
export const llmMilestoneOutputSchema = z
  .object({
    dimensions: z.object(dimensionsShape),
  })
  .superRefine((output, ctx) => {
    // reason: a failed judge-text finding's fingerprint is its cites; without them the plan's review errors and retries
    // instead of falling back to wording (#405; Sentry groups by stack frames, not message text).
    for (const d of MILESTONE_DIMENSIONS) {
      if (MEASURED_CAUSE_DIMENSIONS.includes(d) || output.dimensions[d].verdict !== "fail") continue;
      if ((output.dimensions[d].cites ?? []).length === 0) {
        ctx.addIssue({ code: "custom", path: ["dimensions", d, "cites"], message: "a failed finding must cite at least one AC id, rule id, file path or symbol" });
      }
    }
  });
export type LlmMilestoneOutput = z.infer<typeof llmMilestoneOutputSchema>;

/** A `milestone` decision (BR-1370) the review lists under correctness. */
export const milestoneDecisionRefSchema = z.object({
  class: z.string().min(1),
  document: z.string().min(1),
  summary: z.string(),
});
export type MilestoneDecisionRef = z.infer<typeof milestoneDecisionRefSchema>;

/**
 * One acceptance criterion retired during the plan (adr-an-acceptance-criterion-retires-with-the-feature-it): superseded by
 * another criterion, or belonging to a spec deprecated while the plan was open. The owner confirms the list at the milestone.
 */
export const retiredAcRefSchema = z.object({
  kind: z.enum(["superseded", "deprecated-spec"]),
  /** Slug of the spec that declared the criterion. */
  spec: z.string().min(1),
  ac: z.string().min(1),
  reason: z.string().min(1),
  /** Superseding criterion (kind `superseded` only): `<spec slug>:<ac id>`. */
  superseded_by: z.string().min(1).optional(),
  /** Status the spec had before it was deprecated (kind `deprecated-spec` only); a rejection restores it. */
  previous_status: z.string().min(1).optional(),
  /** ISO time of the retirement; one retirement instance is identified by (kind, spec, ac, at). */
  at: z.string().min(1),
});
export type RetiredAcRef = z.infer<typeof retiredAcRefSchema>;

/**
 * The measured causes of a review's failed findings, stored so a later batch can file them by root cause without
 * re-reviewing (BR-1379: issues are grouped by fingerprint, and a filing error retries only the filing).
 */
export const reviewCausesSchema = z.object({
  /** Failing suite test files attributed to the plan (the regression finding's root cause), sorted. */
  regression_files: z.array(z.string().min(1)).optional(),
  /**
   * EVERY failing test file of the batch's one suite run, sorted (set with `regression_files`). The root-cause
   * fingerprint of a failing main suite is this whole set, so plans attributed different subsets share one issue.
   * Absent on a review stored before this field existed.
   */
  suite_failing_files: z.array(z.string().min(1)).optional(),
  /** Cited rule ids whose state is contradicted (the snapshot-accuracy finding's root cause), sorted. */
  contradicted_rules: z.array(z.string().min(1)).optional(),
});
export type ReviewCauses = z.infer<typeof reviewCausesSchema>;

/** The stored review (`extra.milestone_review` of a knowledge doc with sub_type `milestone-review`). */
export const milestoneReviewSchema = z.object({
  plan_id: z.string().min(1),
  /** The plan-state fingerprint this review judged; close compares it with the fingerprint at close time. */
  fingerprint: z.string().min(1),
  overall: z.enum(["pass", "fail"]),
  dimensions: z.object(dimensionsShape),
  decisions: z.array(milestoneDecisionRefSchema),
  /** ACs retired during the plan; absent on a review stored before the list existed (never read as "none retired"). */
  retired_acs: z.array(retiredAcRefSchema).optional(),
  /** Measured root causes of the failed findings (absent on a review stored before BR-1379 grouping). */
  causes: reviewCausesSchema.optional(),
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
  if (review.retired_acs !== undefined && review.retired_acs.length > 0) {
    lines.push("", "## Retired ACs", "");
    for (const ac of review.retired_acs) {
      const via = ac.superseded_by !== undefined ? ` (superseded by ${ac.superseded_by})` : " (spec deprecated)";
      lines.push(`- ${ac.spec}:${ac.ac}${via}: ${ac.reason}`);
    }
  }
  return lines.join("\n");
}
