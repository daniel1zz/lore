/**
 * Tests for `renderAdvisoryBlock` in `adapters/cli/review-render.ts` (SPEC-053) — the
 * pure, non-blocking AC-quantifiability advisory block appended after
 * `formatJudgmentSummary`'s output. No injected deps (unlike the superseded nudge).
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      a judgment with ≥1 advisory finding renders a labelled, non-empty block
 *               naming each finding (kind + ac_id + text).
 *   BOUNDARY:   an advisory entry with no `ac_id` still renders (no target prefix).
 *   REGRESSION: a judgment with NO advisory (and one with an empty advisory[]) renders
 *               the empty string — so `formatJudgmentSummary(j) + renderAdvisoryBlock(j)`
 *               is byte-identical to `formatJudgmentSummary(j)` alone.
 *
 * Source: SPEC-053 §Acceptance Criteria AC-053-7.
 */

import { describe, it, expect } from "vitest";
import { formatJudgmentSummary, renderAdvisoryBlock } from "../../../../src/adapters/cli/review-render.js";
import type { ReviewJudgment } from "@lore/core";

function makeJudgment(overrides: Partial<ReviewJudgment>): ReviewJudgment {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    doc_id: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
    doc_version: 2,
    decision: "approve",
    confidence: 0.9,
    reasons: [{ dimension: "completeness", finding: "all ACs covered" }],
    checks: [{ check: "schema", outcome: "pass" }],
    blocking_questions: [],
    kind: "review",
    judge: { provider: "claude-cli", model: "claude-cli", prompt_version: "v2" },
    created_at: "2026-07-18T00:00:00.000Z",
    created_by: "ai:claude-cli:claude-cli:v2",
    ...overrides,
  } as ReviewJudgment;
}

describe("SPEC-053 AC-053-7 — renderAdvisoryBlock", () => {
  it("HAPPY: renders a non-empty block containing each advisory finding", () => {
    const judgment = makeJudgment({
      advisory: [
        { kind: "ac_quantifiability", ac_id: "AC-1", finding: "'loads fast' has no threshold" },
        { kind: "ac_quantifiability", ac_id: "AC-3", finding: "'handles reasonable load' is unmeasured" },
      ],
    });
    const block = renderAdvisoryBlock(judgment);
    expect(block).not.toBe("");
    expect(block).toContain("Advisory (non-blocking):");
    expect(block).toContain("AC-1");
    expect(block).toContain("'loads fast' has no threshold");
    expect(block).toContain("AC-3");
    expect(block).toContain("'handles reasonable load' is unmeasured");
    expect(block).toContain("[ac_quantifiability]");
  });

  it("BOUNDARY: an advisory finding with no ac_id renders without a target prefix", () => {
    const judgment = makeJudgment({
      advisory: [{ kind: "ac_quantifiability", finding: "the AC set lacks thresholds overall" }],
    });
    const block = renderAdvisoryBlock(judgment);
    expect(block).toContain("the AC set lacks thresholds overall");
    // no "undefined:" leaked from a missing ac_id
    expect(block).not.toContain("undefined");
  });

  it("REGRESSION: a judgment with NO advisory renders the empty string (no-op concat)", () => {
    const judgment = makeJudgment({});
    expect(renderAdvisoryBlock(judgment)).toBe("");
    // concatenation is a true no-op
    expect(formatJudgmentSummary(judgment) + renderAdvisoryBlock(judgment)).toBe(
      formatJudgmentSummary(judgment),
    );
  });

  it("REGRESSION: a judgment with an EMPTY advisory[] also renders the empty string", () => {
    const judgment = makeJudgment({ advisory: [] });
    expect(renderAdvisoryBlock(judgment)).toBe("");
  });
});
