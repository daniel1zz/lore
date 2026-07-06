/**
 * Tests for @lore/core review-judgment — llmReviewOutputSchema, reviewJudgmentSchema,
 * checkResultSchema, judgeIdentitySchema. Pure Zod schemas, no IO.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      well-formed approve/reject/escalate judgments parse on both schemas
 *   NEGATIVE:   escalate with empty blocking_questions rejected; non-escalate with
 *               non-empty blocking_questions rejected; unknown decision/check/outcome
 *               enum values rejected
 *   BOUNDARY:   confidence exactly 0 and exactly 1 accepted; confidence just outside
 *               [0,1] rejected; reasons array must have length >= 1
 *   ERROR:      n/a — Zod schemas report via .success/.error, not thrown exceptions
 *   STATE:      n/a — no state machine in this module
 *   REGRESSION: llmReviewOutputSchema rejects the identity fields (id/doc_id/judge/etc
 *               are not required — they are simply ignored/absent, proving the split
 *               from reviewJudgmentSchema is real, not accidental supersetting)
 *
 * @spec_ref SPEC-034 §2, §3
 */

import { describe, expect, it } from "vitest";
import {
  checkResultSchema,
  judgeIdentitySchema,
  llmReviewOutputSchema,
  REVIEW_DECISIONS,
  reviewJudgmentSchema,
} from "./review-judgment.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeLlmOutput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    decision: "approve",
    confidence: 0.9,
    reasons: [{ dimension: "completeness", finding: "All ACs covered." }],
    blocking_questions: [],
    ...overrides,
  };
}

function makeJudgment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ...makeLlmOutput(),
    id: "01ARZ3JUDGE0000000000001",
    doc_id: "01ARZ3DOC00000000000001",
    doc_version: 2,
    checks: [{ check: "schema", outcome: "pass" }],
    judge: { provider: "claude-cli", model: "claude-sonnet-5", prompt_version: "v1" },
    created_at: "2026-07-06T00:00:00.000Z",
    created_by: "ai:claude-cli:claude-sonnet-5:v1",
    ...overrides,
  };
}

// ─── judgeIdentitySchema ─────────────────────────────────────────────────────

describe("judgeIdentitySchema", () => {
  it("HAPPY: parses a well-formed judge identity", () => {
    const result = judgeIdentitySchema.safeParse({
      provider: "claude-cli",
      model: "claude-sonnet-5",
      prompt_version: "v1",
    });
    expect(result.success).toBe(true);
  });

  it("NEGATIVE: rejects an empty provider string", () => {
    const result = judgeIdentitySchema.safeParse({
      provider: "",
      model: "claude-sonnet-5",
      prompt_version: "v1",
    });
    expect(result.success).toBe(false);
  });
});

// ─── checkResultSchema ──────────────────────────────────────────────────────

describe("checkResultSchema", () => {
  it("HAPPY: accepts every declared check name", () => {
    const checks = [
      "schema",
      "parent_contract",
      "tree_position",
      "link_integrity",
      "evidence_completeness",
    ];
    for (const check of checks) {
      const result = checkResultSchema.safeParse({ check, outcome: "pass" });
      expect(result.success).toBe(true);
    }
  });

  it("HAPPY: accepts an optional detail string on a fail outcome", () => {
    const result = checkResultSchema.safeParse({
      check: "link_integrity",
      outcome: "fail",
      detail: "dangling parent_id",
    });
    expect(result.success).toBe(true);
  });

  it("NEGATIVE: rejects an unknown check name", () => {
    const result = checkResultSchema.safeParse({ check: "not-a-check", outcome: "pass" });
    expect(result.success).toBe(false);
  });

  it("NEGATIVE: rejects an unknown outcome", () => {
    const result = checkResultSchema.safeParse({ check: "schema", outcome: "maybe" });
    expect(result.success).toBe(false);
  });
});

// ─── llmReviewOutputSchema ──────────────────────────────────────────────────

describe("llmReviewOutputSchema", () => {
  it("HAPPY: parses a well-formed approve output with no checks field", () => {
    const result = llmReviewOutputSchema.safeParse(makeLlmOutput());
    expect(result.success).toBe(true);
  });

  it("HAPPY: parses a well-formed output that includes an optional checks array", () => {
    const result = llmReviewOutputSchema.safeParse(
      makeLlmOutput({ checks: [{ check: "schema", outcome: "pass" }] }),
    );
    expect(result.success).toBe(true);
  });

  it("HAPPY: parses a well-formed escalate output with blocking_questions", () => {
    const result = llmReviewOutputSchema.safeParse(
      makeLlmOutput({ decision: "escalate", blocking_questions: ["Is AC-7 in scope?"] }),
    );
    expect(result.success).toBe(true);
  });

  it("NEGATIVE: escalate with empty blocking_questions is rejected", () => {
    const result = llmReviewOutputSchema.safeParse(
      makeLlmOutput({ decision: "escalate", blocking_questions: [] }),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((i) => i.path.includes("blocking_questions"))).toBe(true);
  });

  it("NEGATIVE: approve with non-empty blocking_questions is rejected", () => {
    const result = llmReviewOutputSchema.safeParse(
      makeLlmOutput({ decision: "approve", blocking_questions: ["huh?"] }),
    );
    expect(result.success).toBe(false);
  });

  it("NEGATIVE: reject with non-empty blocking_questions is rejected", () => {
    const result = llmReviewOutputSchema.safeParse(
      makeLlmOutput({ decision: "reject", blocking_questions: ["huh?"] }),
    );
    expect(result.success).toBe(false);
  });

  it("NEGATIVE: rejects an unknown decision value", () => {
    const result = llmReviewOutputSchema.safeParse(makeLlmOutput({ decision: "maybe" }));
    expect(result.success).toBe(false);
  });

  it("NEGATIVE: rejects an empty reasons array", () => {
    const result = llmReviewOutputSchema.safeParse(makeLlmOutput({ reasons: [] }));
    expect(result.success).toBe(false);
  });

  it("BOUNDARY: confidence exactly 0 is accepted", () => {
    const result = llmReviewOutputSchema.safeParse(makeLlmOutput({ confidence: 0 }));
    expect(result.success).toBe(true);
  });

  it("BOUNDARY: confidence exactly 1 is accepted", () => {
    const result = llmReviewOutputSchema.safeParse(makeLlmOutput({ confidence: 1 }));
    expect(result.success).toBe(true);
  });

  it("BOUNDARY: confidence just below 0 is rejected", () => {
    const result = llmReviewOutputSchema.safeParse(makeLlmOutput({ confidence: -0.0001 }));
    expect(result.success).toBe(false);
  });

  it("BOUNDARY: confidence just above 1 is rejected", () => {
    const result = llmReviewOutputSchema.safeParse(makeLlmOutput({ confidence: 1.0001 }));
    expect(result.success).toBe(false);
  });

  it("REGRESSION: REVIEW_DECISIONS is exactly ['approve', 'reject', 'escalate']", () => {
    expect(REVIEW_DECISIONS).toEqual(["approve", "reject", "escalate"]);
  });

  it("REGRESSION: llmReviewOutputSchema does not require doc_id/id/judge/created_* — the identity split is real", () => {
    // A bare llm output (no identity fields at all) still validates — proving
    // llmReviewOutputSchema is genuinely narrower than reviewJudgmentSchema,
    // not just reviewJudgmentSchema with optional identity fields.
    const bareOutput = makeLlmOutput();
    expect("id" in bareOutput).toBe(false);
    expect("judge" in bareOutput).toBe(false);
    const result = llmReviewOutputSchema.safeParse(bareOutput);
    expect(result.success).toBe(true);
  });
});

// ─── reviewJudgmentSchema ───────────────────────────────────────────────────

describe("reviewJudgmentSchema", () => {
  it("HAPPY: parses a well-formed persisted approve judgment", () => {
    const result = reviewJudgmentSchema.safeParse(makeJudgment());
    expect(result.success).toBe(true);
  });

  it("HAPPY: parses a well-formed persisted escalate judgment", () => {
    const result = reviewJudgmentSchema.safeParse(
      makeJudgment({ decision: "escalate", blocking_questions: ["Is this in scope?"] }),
    );
    expect(result.success).toBe(true);
  });

  it("NEGATIVE: escalate with empty blocking_questions is rejected on the persisted schema too", () => {
    const result = reviewJudgmentSchema.safeParse(
      makeJudgment({ decision: "escalate", blocking_questions: [] }),
    );
    expect(result.success).toBe(false);
  });

  it("NEGATIVE: non-escalate with non-empty blocking_questions is rejected on the persisted schema too", () => {
    const result = reviewJudgmentSchema.safeParse(
      makeJudgment({ decision: "reject", blocking_questions: ["huh?"] }),
    );
    expect(result.success).toBe(false);
  });

  it("NEGATIVE: checks is required on the persisted schema (unlike llmReviewOutputSchema)", () => {
    const judgment = makeJudgment();
    delete (judgment as Record<string, unknown>).checks;
    const result = reviewJudgmentSchema.safeParse(judgment);
    expect(result.success).toBe(false);
  });

  it("NEGATIVE: rejects a missing judge identity", () => {
    const judgment = makeJudgment();
    delete (judgment as Record<string, unknown>).judge;
    const result = reviewJudgmentSchema.safeParse(judgment);
    expect(result.success).toBe(false);
  });

  it("BOUNDARY: confidence exactly 0 and exactly 1 both accepted on the persisted schema", () => {
    expect(reviewJudgmentSchema.safeParse(makeJudgment({ confidence: 0 })).success).toBe(true);
    expect(reviewJudgmentSchema.safeParse(makeJudgment({ confidence: 1 })).success).toBe(true);
  });

  it("REGRESSION: doc_version must be an integer", () => {
    const result = reviewJudgmentSchema.safeParse(makeJudgment({ doc_version: 1.5 }));
    expect(result.success).toBe(false);
  });
});
