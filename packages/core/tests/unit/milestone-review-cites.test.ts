/**
 * @spec_ref spec-plans-close-themselves-level-triggered-reconciliation-of (BR-1379)
 *
 * A failed judge-text finding names structured cites at parse time (they are its root-cause identity).
 * Dimensions: HAPPY (cite kept), NEGATIVE (missing / empty cites rejected), BOUNDARY (pass, na, measured dimensions
 * need none), REGRESSION (a review stored before cites existed still parses).
 */

import { describe, it, expect } from "vitest";
import { MILESTONE_DIMENSIONS, llmMilestoneOutputSchema, milestoneReviewSchema } from "../../src/milestone-review.js";

type Dimension = (typeof MILESTONE_DIMENSIONS)[number];

function dims(dimension?: Dimension, extra: Record<string, unknown> = {}, verdict = "fail"): Record<string, unknown> {
  return Object.fromEntries(
    MILESTONE_DIMENSIONS.map((d) => [d, d === dimension ? { verdict, reason: "broken", reference: "x", ...extra } : { verdict: "pass", reason: "ok", reference: "x" }]),
  );
}

describe("judge-text findings carry structured cites", () => {
  it("NEGATIVE: a failed judge-text dimension without cites fails the parse, naming the field", () => {
    const parsed = llmMilestoneOutputSchema.safeParse({ dimensions: dims("security") });
    expect(parsed.success).toBe(false);
    expect(parsed.success ? "" : parsed.error.issues.map((i) => i.path.join(".")).join(",")).toContain("dimensions.security.cites");
  });

  it("NEGATIVE: an empty cites list is no cite", () => {
    expect(llmMilestoneOutputSchema.safeParse({ dimensions: dims("spec_conformance", { cites: [] }) }).success).toBe(false);
  });

  it("HAPPY: a failed judge-text dimension with a cite parses and keeps it", () => {
    const parsed = llmMilestoneOutputSchema.safeParse({ dimensions: dims("correctness_vs_acs", { cites: ["AC-ZZ-1"] }) });
    expect(parsed.success && parsed.data.dimensions.correctness_vs_acs.cites).toEqual(["AC-ZZ-1"]);
  });

  it("BOUNDARY: pass, na and the measured dimensions need no cites from the judge", () => {
    expect(llmMilestoneOutputSchema.safeParse({ dimensions: dims() }).success).toBe(true);
    expect(llmMilestoneOutputSchema.safeParse({ dimensions: dims("security", {}, "na") }).success).toBe(true);
    expect(llmMilestoneOutputSchema.safeParse({ dimensions: dims("regression") }).success).toBe(true);
    expect(llmMilestoneOutputSchema.safeParse({ dimensions: dims("snapshot_accuracy") }).success).toBe(true);
  });

  it("REGRESSION: a review stored before cites existed still parses", () => {
    const stored = { plan_id: "p", fingerprint: "f", overall: "fail", dimensions: dims("security"), decisions: [], prompt_version: "m", diff_source: "none" };
    expect(milestoneReviewSchema.safeParse(stored).success).toBe(true);
  });
});
