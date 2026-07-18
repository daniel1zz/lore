/**
 * Tests for @lore/core review-judgment SPEC-053 additions — the typed advisory[]
 * extension point: REVIEW_ADVISORY_KINDS enum, reviewAdvisorySchema, and the optional
 * `advisory` field on the shared review-judgment base shape. Pure schema module, no IO.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      a well-formed advisory entry with kind "ac_quantifiability" parses;
 *               a full LLM review output carrying an advisory[] array parses.
 *   NEGATIVE:   an out-of-enum `kind` is rejected by the schema.
 *   BOUNDARY:   `ac_id` omitted still parses (optional); an empty advisory[] parses.
 *   ERROR:      a non-string `finding` is rejected.
 *   STATE:      the persisted reviewJudgmentSchema also accepts advisory[].
 *   REGRESSION: a judgment/LLM-output object with NO `advisory` key still parses
 *               byte-for-byte (additive-only, absent means "no findings").
 *
 * Source: SPEC-053 §Acceptance Criteria AC-053-1 (version+registry, see the ai/ suite),
 *   AC-053-2 (enum accept/reject).
 */

import { describe, it, expect } from "vitest";
import {
  REVIEW_ADVISORY_KINDS,
  reviewAdvisorySchema,
  llmReviewOutputSchema,
  reviewJudgmentSchema,
  type ReviewAdvisory,
} from "../../src/review-judgment.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const validLlmOutput = {
  decision: "approve" as const,
  confidence: 0.9,
  reasons: [{ dimension: "completeness", finding: "all ACs covered" }],
  blocking_questions: [],
};

const persistedExtras = {
  id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  doc_id: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
  doc_version: 2,
  checks: [{ check: "schema" as const, outcome: "pass" as const }],
  judge: { provider: "claude-cli", model: "claude-cli", prompt_version: "v2" },
  created_at: "2026-07-18T00:00:00.000Z",
  created_by: "ai:claude-cli:claude-cli:v2",
};

// ─── AC-053-2: enum + schema accept/reject ───────────────────────────────────

describe("SPEC-053 AC-053-2 — advisory kind enum + reviewAdvisorySchema", () => {
  it("HAPPY: accepts a well-formed advisory entry with kind 'ac_quantifiability'", () => {
    const parsed = reviewAdvisorySchema.parse({
      kind: "ac_quantifiability",
      ac_id: "AC-3",
      finding: "'returns quickly enough' declares no measurable threshold",
    });
    expect(parsed.kind).toBe("ac_quantifiability");
    expect(parsed.ac_id).toBe("AC-3");
  });

  it("BOUNDARY: `ac_id` is optional — an entry without it still parses", () => {
    const parsed = reviewAdvisorySchema.parse({
      kind: "ac_quantifiability",
      finding: "the AC set as a whole lacks quantitative thresholds",
    });
    expect(parsed.ac_id).toBeUndefined();
  });

  it("NEGATIVE: rejects an out-of-enum `kind`", () => {
    const result = reviewAdvisorySchema.safeParse({
      kind: "not_a_real_kind",
      finding: "x",
    });
    expect(result.success).toBe(false);
  });

  it("ERROR: rejects a non-string `finding`", () => {
    const result = reviewAdvisorySchema.safeParse({
      kind: "ac_quantifiability",
      finding: 42,
    });
    expect(result.success).toBe(false);
  });

  it("STATE: REVIEW_ADVISORY_KINDS is the single source of truth and contains ac_quantifiability", () => {
    expect(REVIEW_ADVISORY_KINDS).toContain("ac_quantifiability");
    // every declared kind must itself parse
    for (const kind of REVIEW_ADVISORY_KINDS) {
      expect(reviewAdvisorySchema.safeParse({ kind, finding: "f" }).success).toBe(true);
    }
  });
});

describe("SPEC-053 AC-053-2 — advisory[] on the review-judgment schemas", () => {
  it("HAPPY: an LLM review output carrying an advisory[] array parses", () => {
    const advisory: ReviewAdvisory[] = [
      { kind: "ac_quantifiability", ac_id: "AC-1", finding: "no threshold" },
    ];
    const parsed = llmReviewOutputSchema.parse({ ...validLlmOutput, advisory });
    expect(parsed.advisory).toHaveLength(1);
  });

  it("BOUNDARY: an empty advisory[] parses", () => {
    const parsed = llmReviewOutputSchema.parse({ ...validLlmOutput, advisory: [] });
    expect(parsed.advisory).toEqual([]);
  });

  it("STATE: the persisted reviewJudgmentSchema also accepts advisory[]", () => {
    const parsed = reviewJudgmentSchema.parse({
      ...validLlmOutput,
      ...persistedExtras,
      advisory: [{ kind: "ac_quantifiability", finding: "vague" }],
    });
    expect(parsed.advisory).toHaveLength(1);
  });

  it("REGRESSION: a judgment with NO advisory key parses and leaves it undefined", () => {
    const parsedLlm = llmReviewOutputSchema.parse(validLlmOutput);
    expect(parsedLlm.advisory).toBeUndefined();
    const parsedPersisted = reviewJudgmentSchema.parse({ ...validLlmOutput, ...persistedExtras });
    expect(parsedPersisted.advisory).toBeUndefined();
  });

  it("NEGATIVE: an advisory[] entry with a bad kind fails the whole judgment parse", () => {
    const result = llmReviewOutputSchema.safeParse({
      ...validLlmOutput,
      advisory: [{ kind: "bogus", finding: "x" }],
    });
    expect(result.success).toBe(false);
  });
});
