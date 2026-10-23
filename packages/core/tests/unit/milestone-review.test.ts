/**
 * @spec_ref spec-lean-governance-batch-verbs-judgment-only-at-milestones (Part D, BR-1372)
 *
 * The milestone review's shapes and the deterministic rules the judge cannot waive. Pure, so hence vitest.
 * Dimensions: HAPPY (all pass -> pass), NEGATIVE (one fail -> fail; missing dimension rejected), BOUNDARY (na never
 * fails; an empty reference only fails design_necessity), STATE (the floor rewrites the judgment, not the input),
 * REGRESSION (the seven names and their order are frozen), ERROR (an unknown verdict is rejected).
 */

import { describe, it, expect } from "vitest";
import {
  MILESTONE_DIMENSIONS,
  applyDeterministicDimensionRules,
  failedDimensions,
  llmMilestoneOutputSchema,
  milestoneReviewSchema,
  overallMilestoneVerdict,
  renderMilestoneReviewContent,
  type LlmMilestoneOutput,
} from "../../src/milestone-review.js";

function dims(overrides: Partial<Record<(typeof MILESTONE_DIMENSIONS)[number], LlmMilestoneOutput["dimensions"]["security"]>> = {}): LlmMilestoneOutput["dimensions"] {
  return Object.fromEntries(
    MILESTONE_DIMENSIONS.map((d) => [d, overrides[d] ?? { verdict: "pass", reason: `${d} ok`, reference: "Google code review guide" }]),
  ) as LlmMilestoneOutput["dimensions"];
}

describe("milestone review dimensions", () => {
  it("REGRESSION: the seven dimensions and their order are frozen", () => {
    expect([...MILESTONE_DIMENSIONS]).toEqual([
      "correctness_vs_acs",
      "spec_conformance",
      "regression",
      "design_necessity",
      "snapshot_accuracy",
      "concurrency_safety",
      "security",
    ]);
  });

  it("HAPPY: all pass is an overall pass with no failed dimension", () => {
    expect(overallMilestoneVerdict(dims())).toBe("pass");
    expect(failedDimensions(dims())).toEqual([]);
  });

  it("NEGATIVE: one failing dimension fails the review and is named", () => {
    const d = dims({ regression: { verdict: "fail", reason: "breaks old path", reference: "Kayenta" } });
    expect(overallMilestoneVerdict(d)).toBe("fail");
    expect(failedDimensions(d)).toEqual(["regression"]);
  });

  it("BOUNDARY: n/a never fails a review, even with an empty reference", () => {
    const d = dims({ concurrency_safety: { verdict: "na", reason: "single writer", reference: "" } });
    expect(overallMilestoneVerdict(applyDeterministicDimensionRules(d))).toBe("pass");
  });

  it("STATE: a design_necessity pass with no reference becomes a named fail; other dimensions pass through untouched", () => {
    const input = dims({ design_necessity: { verdict: "pass", reason: "needed", reference: "" } });
    const out = applyDeterministicDimensionRules(input);
    expect(out.design_necessity.verdict).toBe("fail");
    expect(out.design_necessity.reason).toContain("No external reference");
    expect(out.security).toEqual(input.security);
    expect(input.design_necessity.verdict).toBe("pass");
  });

  it("BOUNDARY: a design_necessity pass WITH a reference is left alone, and a referenceless fail stays a fail", () => {
    expect(applyDeterministicDimensionRules(dims()).design_necessity.verdict).toBe("pass");
    const failing = dims({ design_necessity: { verdict: "fail", reason: "gold plating", reference: "" } });
    expect(applyDeterministicDimensionRules(failing).design_necessity.reason).toBe("gold plating");
  });

  it("NEGATIVE: the judge output must carry all seven dimensions", () => {
    const partial = { dimensions: Object.fromEntries(MILESTONE_DIMENSIONS.slice(0, 6).map((d) => [d, { verdict: "pass", reason: "x", reference: "" }])) };
    expect(llmMilestoneOutputSchema.safeParse(partial).success).toBe(false);
    expect(llmMilestoneOutputSchema.safeParse({ dimensions: dims() }).success).toBe(true);
  });

  it("ERROR: an unknown verdict or a blank reason is rejected", () => {
    const badVerdict = dims({ security: { verdict: "maybe" as never, reason: "x", reference: "" } });
    expect(llmMilestoneOutputSchema.safeParse({ dimensions: badVerdict }).success).toBe(false);
    const blankReason = dims({ security: { verdict: "pass", reason: "  ", reference: "" } });
    expect(llmMilestoneOutputSchema.safeParse({ dimensions: blankReason }).success).toBe(false);
  });

  it("the stored review round-trips and renders every dimension and the decisions it lists", () => {
    const review = milestoneReviewSchema.parse({
      plan_id: "P1",
      fingerprint: "plan:P1@2|tasks:T1@3|landed:abc",
      overall: "pass",
      dimensions: dims(),
      decisions: [{ class: "override-judgment", document: "spec-x", summary: "Allow an override" }],
      prompt_version: "milestone-1",
      diff_source: "derived",
    });
    const text = renderMilestoneReviewContent(review);
    for (const d of MILESTONE_DIMENSIONS) expect(text).toContain(`| ${d} | pass |`);
    expect(text).toContain("override-judgment on spec-x");
    expect(text).toContain("plan:P1@2|tasks:T1@3|landed:abc");
  });
});
