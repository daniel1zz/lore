/**
 * Unit tests for `formatJudgmentBadge` (SPEC-034 §4 triage rendering, `adapters/cli/utils.ts`).
 * Pure function — no store, no IO — tested directly with fabricated `ReviewJudgment` values.
 *
 * Coverage:
 *   HAPPY:      approve/reject render "[AI: <decision> <confidence>]"; escalate renders
 *               "[AI: escalate ✋NQ]" with the blocking_questions count
 *   NEGATIVE:   n/a — no invalid-input branch (the function only reads a well-typed
 *               ReviewJudgment | null)
 *   BOUNDARY:   confidence 0 and 1 render with two decimal places; zero blocking_questions
 *               on an escalate judgment still renders "✋0Q" (Zod's superRefine forbids this
 *               combination at the schema layer, but the badge function itself has no
 *               opinion — it must not throw on a boundary count)
 *   ERROR:      n/a — pure function, no failure mode
 *   STATE:      staleness — `judgment.doc_version < docVersion` appends " (stale)"; equal
 *               versions render fresh (no marker); a version AHEAD of the doc (should never
 *               happen in practice) also renders fresh, since only "<" triggers staleness
 *   REGRESSION: `judgment === null` always renders "[unreviewed]" regardless of docVersion
 *
 * @spec_ref SPEC-034 §4
 */

import { describe, it, expect } from "vitest";
import { formatJudgmentBadge } from "../../../../src/adapters/cli/utils.js";
import type { ReviewJudgment } from "@lore/core";

function makeJudgment(overrides: Partial<ReviewJudgment>): ReviewJudgment {
  return {
    id: "01JUDGMENT000000000000000",
    doc_id: "01DOC00000000000000000000",
    doc_version: 1,
    decision: "approve",
    confidence: 0.9,
    reasons: [{ dimension: "completeness", finding: "looks fine" }],
    checks: [{ check: "schema", outcome: "pass" }],
    blocking_questions: [],
    judge: { provider: "claude-cli", model: "claude-sonnet-5", prompt_version: "v1" },
    created_at: "2026-07-06T00:00:00.000Z",
    created_by: "ai:claude-cli:claude-sonnet-5:v1",
    ...overrides,
  };
}

describe("formatJudgmentBadge — HAPPY", () => {
  it("renders '[AI: approve 0.93]' for a fresh approve judgment", () => {
    const judgment = makeJudgment({ decision: "approve", confidence: 0.93, doc_version: 2 });
    expect(formatJudgmentBadge(judgment, 2)).toBe("[AI: approve 0.93]");
  });

  it("renders '[AI: reject 0.87]' for a fresh reject judgment", () => {
    const judgment = makeJudgment({ decision: "reject", confidence: 0.87, doc_version: 2 });
    expect(formatJudgmentBadge(judgment, 2)).toBe("[AI: reject 0.87]");
  });

  it("renders '[AI: escalate ✋2Q]' for an escalate judgment with 2 blocking questions", () => {
    const judgment = makeJudgment({
      decision: "escalate",
      confidence: 0.5,
      blocking_questions: ["Is the API stable?", "Who owns this doc?"],
      doc_version: 2,
    });
    expect(formatJudgmentBadge(judgment, 2)).toBe("[AI: escalate ✋2Q]");
  });
});

describe("formatJudgmentBadge — REGRESSION (unreviewed)", () => {
  it("null judgment always renders '[unreviewed]' regardless of docVersion", () => {
    expect(formatJudgmentBadge(null, 1)).toBe("[unreviewed]");
    expect(formatJudgmentBadge(null, 99)).toBe("[unreviewed]");
  });
});

describe("formatJudgmentBadge — BOUNDARY (confidence extremes, zero blocking questions)", () => {
  it("confidence 0 renders '0.00'", () => {
    const judgment = makeJudgment({ decision: "reject", confidence: 0, doc_version: 1 });
    expect(formatJudgmentBadge(judgment, 1)).toBe("[AI: reject 0.00]");
  });

  it("confidence 1 renders '1.00'", () => {
    const judgment = makeJudgment({ decision: "approve", confidence: 1, doc_version: 1 });
    expect(formatJudgmentBadge(judgment, 1)).toBe("[AI: approve 1.00]");
  });

  it("escalate with zero blocking_questions renders '✋0Q' without throwing", () => {
    const judgment = makeJudgment({ decision: "escalate", blocking_questions: [], doc_version: 1 });
    expect(formatJudgmentBadge(judgment, 1)).toBe("[AI: escalate ✋0Q]");
  });
});

describe("formatJudgmentBadge — STATE (staleness)", () => {
  it("appends ' (stale)' when judgment.doc_version < docVersion", () => {
    const judgment = makeJudgment({ decision: "approve", confidence: 0.8, doc_version: 1 });
    expect(formatJudgmentBadge(judgment, 2)).toBe("[AI: approve 0.80] (stale)");
  });

  it("does NOT append '(stale)' when versions are equal", () => {
    const judgment = makeJudgment({ decision: "approve", confidence: 0.8, doc_version: 2 });
    expect(formatJudgmentBadge(judgment, 2)).toBe("[AI: approve 0.80]");
  });

  it("does NOT append '(stale)' when the judgment's version is AHEAD of docVersion (only '<' triggers staleness)", () => {
    const judgment = makeJudgment({ decision: "approve", confidence: 0.8, doc_version: 3 });
    expect(formatJudgmentBadge(judgment, 2)).toBe("[AI: approve 0.80]");
  });

  it("stale escalate still shows the blocking-question count and the stale marker", () => {
    const judgment = makeJudgment({
      decision: "escalate",
      blocking_questions: ["one"],
      doc_version: 1,
    });
    expect(formatJudgmentBadge(judgment, 5)).toBe("[AI: escalate ✋1Q] (stale)");
  });
});
