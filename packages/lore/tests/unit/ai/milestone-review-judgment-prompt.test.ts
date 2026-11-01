/**
 * AC-AF-4: the milestone prompt asks only the judged dimensions and the AI-mode criteria, carries the facts table,
 * has a new prompt version, ignores an AI verdict on a facts dimension and computes snapshot_accuracy from rule state.
 *
 * Dimensions: HAPPY (asked dimensions, facts table), NEGATIVE (a facts dimension is never asked or believed),
 * BOUNDARY (stale rule is na naming it), ERROR (a missing criterion verdict is retried, then an AI error),
 * STATE (version), REGRESSION (the old seven-dimension guide is gone).
 */

import { describe, expect, it } from "vitest";
import { FACT_DIMENSIONS, JUDGED_DIMENSIONS, type MilestoneFacts } from "@lore/core";
import {
  askedDimensionsOf,
  buildMilestoneReviewPrompt,
  MILESTONE_REVIEW_PROMPT_VERSION,
} from "../../../src/ai/milestone-review-template.js";
import { answerJson, buildJudgmentFixture } from "../../helpers/milestone-judgment-fixture.js";

const facts: MilestoneFacts = {
  attestation: [
    { subject: "spec-one:AC-X-1", verdict: "pass", detail: "attestation att-1 at abc123" },
    { subject: "spec-one:AC-X-2", verdict: "not-measured", detail: "only attested on a worktree commit" },
  ],
  regression: [{ subject: "landing abc123", verdict: "fail", detail: "tests/a.test.ts fails" }],
  outside_anchors: [{ landing: "abc123", files: ["packages/x/src/helper.ts"] }],
  ai_criteria: [{ spec: "spec-one", ac: "AC-X-9", rubric: "The error text names the failing file." }],
};

const base = {
  mode: "full" as const,
  plan: { slug: "plan-one", title: "Plan one", content: "goals" },
  tasks: [],
  citedRules: [{ rule_id: "BR-7", state: "stale" }],
  decisions: [],
  diffSource: "derived",
  facts,
};

const allPass = {
  spec_conformance: { verdict: "pass" },
  design_necessity: { verdict: "pass" },
  concurrency_safety: { verdict: "pass" },
  security: { verdict: "pass" },
};

describe("AC-AF-4 milestone judgment prompt", () => {
  it("AC-AF-4 HAPPY: asks only spec_conformance, design_necessity, concurrency_safety, security", () => {
    const prompt = buildMilestoneReviewPrompt({ ...base, diffText: "diff --git a/src/x.ts b/src/x.ts\n+x" });
    for (const d of JUDGED_DIMENSIONS) expect(prompt).toContain(`- ${d}:`);
    for (const d of FACT_DIMENSIONS) {
      expect(prompt).not.toContain(`- ${d}:`);
      expect(prompt).not.toContain(`"${d}":`);
    }
    expect(askedDimensionsOf("full")).toEqual(JUDGED_DIMENSIONS);
  });

  it("AC-AF-4 HAPPY: asks one verdict per AI-mode criterion, with its rubric", () => {
    const prompt = buildMilestoneReviewPrompt(base);
    expect(prompt).toContain("spec-one:AC-X-9");
    expect(prompt).toContain("rubric: The error text names the failing file.");
    expect(prompt).toContain('"criteria"');
  });

  it("AC-AF-4 HAPPY: carries the facts table: attestation, regression per landing, outside-anchor files with landing, rule state", () => {
    const prompt = buildMilestoneReviewPrompt(base);
    expect(prompt).toContain("| spec-one:AC-X-1 | pass | attestation att-1 at abc123 |");
    expect(prompt).toContain("| spec-one:AC-X-2 | not-measured |");
    expect(prompt).toContain("| landing abc123 | fail | tests/a.test.ts fails |");
    expect(prompt).toContain("- abc123: packages/x/src/helper.ts");
    expect(prompt).toContain("- BR-7: stale");
    expect(prompt).toContain("never overrule");
  });

  it("AC-AF-4 BOUNDARY: a part nobody measured is said to be not measured, never omitted", () => {
    const { facts: _unmeasured, ...withoutFacts } = base;
    const prompt = buildMilestoneReviewPrompt(withoutFacts);
    expect(prompt).toContain("Criteria attestation: not measured");
    expect(prompt).toContain("Regression per landing: not measured");
  });

  it("AC-AF-4 STATE: the prompt version is bumped past milestone-5", () => {
    expect(MILESTONE_REVIEW_PROMPT_VERSION).not.toBe("milestone-5");
    expect(MILESTONE_REVIEW_PROMPT_VERSION).toBe("milestone-7");
  });

  it("AC-AF-4 NEGATIVE: an AI verdict on a facts dimension is ignored", async () => {
    const fx = buildJudgmentFixture(
      () =>
        answerJson({
          ...allPass,
          correctness_vs_acs: { verdict: "fail", cites: ["AC-X-1"] },
          regression: { verdict: "fail", cites: ["a.ts"] },
          snapshot_accuracy: { verdict: "fail", cites: ["BR-7"] },
        }),
      { citedRules: [{ rule_id: "BR-7", state: "verified" }], facts: { attestation: [{ subject: "spec-one:AC-X-1", verdict: "pass", detail: "ok" }], regression: [{ subject: "landing abc", verdict: "pass", detail: "green" }] } },
    );
    const result = await fx.review({});
    expect(result.ok).toBe(true);
    const dims = fx.stored()!.dimensions;
    expect(dims.correctness_vs_acs.verdict).toBe("pass");
    expect(dims.regression.verdict).toBe("pass");
    expect(dims.snapshot_accuracy.verdict).toBe("pass");
    expect(fx.stored()!.prompt_version).toBe(MILESTONE_REVIEW_PROMPT_VERSION);
  });

  it("AC-AF-4 NEGATIVE: an unmeasured facts dimension is not-measured, never the pass the judge gave", async () => {
    const fx = buildJudgmentFixture(() => answerJson({ ...allPass, correctness_vs_acs: { verdict: "pass" }, regression: { verdict: "pass" } }));
    await fx.review({});
    const dims = fx.stored()!.dimensions;
    expect(dims.correctness_vs_acs.verdict).toBe("not-measured");
    expect(dims.regression.verdict).toBe("not-measured");
  });

  it("AC-AF-4 HAPPY: snapshot_accuracy fails on a contradicted rule whatever the judge said", async () => {
    const fx = buildJudgmentFixture(() => answerJson({ ...allPass, snapshot_accuracy: { verdict: "pass" } }), {
      citedRules: [{ rule_id: "BR-9", state: "contradicted" }],
    });
    await fx.review({});
    const snap = fx.stored()!.dimensions.snapshot_accuracy;
    expect(snap.verdict).toBe("fail");
    expect(snap.reason).toContain("BR-9");
  });

  it("AC-AF-4 BOUNDARY: a stale rule is na and names the rule", async () => {
    const fx = buildJudgmentFixture(() => answerJson({ ...allPass, snapshot_accuracy: { verdict: "fail", cites: ["BR-7"] } }), {
      citedRules: [{ rule_id: "BR-7", state: "stale" }],
    });
    await fx.review({});
    const snap = fx.stored()!.dimensions.snapshot_accuracy;
    expect(snap.verdict).toBe("na");
    expect(snap.reason).toContain("BR-7");
    expect(snap.reason).toContain("stale");
  });

  it("AC-AF-4 HAPPY: an AI-mode criterion the judge fails fails correctness_vs_acs naming it", async () => {
    const fx = buildJudgmentFixture(
      () => answerJson(allPass, { criteria: [{ spec: "spec-one", ac: "AC-X-9", verdict: "fail", reason: "names no file" }] }),
      { facts: { ai_criteria: facts.ai_criteria! } },
    );
    await fx.review({});
    const c = fx.stored()!.dimensions.correctness_vs_acs;
    expect(c.verdict).toBe("fail");
    expect(c.reason).toContain("spec-one:AC-X-9");
  });

  it("AC-AF-4 ERROR: a missing criterion verdict is retried once, then an AI error stores nothing", async () => {
    const fx = buildJudgmentFixture(() => answerJson(allPass), { facts: { ai_criteria: facts.ai_criteria! } });
    const result = await fx.review({});
    expect(result.ok).toBe(false);
    expect(fx.prompts).toHaveLength(2);
    expect(fx.prompts[1]).toContain("no verdict for: spec-one:AC-X-9");
    expect(fx.stored()).toBeUndefined();
  });

  it("AC-AF-4 REGRESSION: a failed judged finding without cites is rejected and retried", async () => {
    let n = 0;
    const fx = buildJudgmentFixture(() => (n++ === 0 ? answerJson({ ...allPass, security: { verdict: "fail" } }) : answerJson({ ...allPass, security: { verdict: "fail", cites: ["a.ts"] } })));
    const result = await fx.review({});
    expect(result.ok).toBe(true);
    expect(fx.prompts).toHaveLength(2);
    expect(fx.stored()!.dimensions.security.verdict).toBe("fail");
  });
});
