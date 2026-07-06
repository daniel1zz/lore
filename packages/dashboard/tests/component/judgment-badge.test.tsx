// @vitest-environment jsdom
/**
 * @spec_ref SPEC-033 §2.2/§2.3, SPEC-034 §4
 *
 * Tests for JudgmentBadge — renders a document's latest AI review judgment
 * as a compact badge, mirroring the CLI's `formatJudgmentBadge` semantics.
 *
 * Spec expectations (written from the module's documented invariants,
 * before reading the implementation body):
 *   - judgment === null -> "unreviewed" text, neutral (outline) styling.
 *   - decision "approve"/"reject" -> "{decision} {confidence.toFixed(2)}" —
 *     confidence MUST be formatted to exactly 2 decimals and MUST reflect the
 *     actual numeric value passed in (not a hardcoded "0.93").
 *   - decision "escalate" -> "escalate +NQ" where N === blocking_questions.length
 *     — N must reflect the actual array length, not a hardcoded count.
 *   - judgment.doc_version < docVersion -> "(stale)" suffix appended AND the
 *     badge downgrades to a neutral (outline) variant, overriding whatever
 *     variant the decision would otherwise pick.
 *   - judgment.doc_version >= docVersion (equal or judgment newer) -> NOT
 *     stale — staleness is a strict less-than comparison.
 *   - Non-stale badges carry no `title` attribute; stale badges carry an
 *     explanatory title mentioning both version numbers.
 *
 * Test plan (six-dimension coverage):
 *   HAPPY — null -> "unreviewed"; approve -> "approve 0.93"; reject -> "reject 0.75".
 *   NEGATIVE — n/a (no invalid-input rejection path for a pure rendering prop).
 *   BOUNDARY — confidence 0 and 1 format correctly (0.00 / 1.00); doc_version
 *     exactly equal to docVersion is NOT stale (strict inequality boundary).
 *   STATE — n/a (pure render, no internal state).
 *   ERROR — n/a (no fallible IO in this component).
 *   REGRESSION — escalate badge count reflects actual blocking_questions.length
 *     across two different lengths (defeats a hardcoded "+2Q"); stale suffix
 *     applies identically to both approve-turned-stale and escalate-turned-stale.
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { JudgmentBadge } from "../../src/components/judgment-badge";
import type { ReviewJudgment } from "@lore/core";

function makeJudgment(overrides: Partial<ReviewJudgment> = {}): ReviewJudgment {
  return {
    id: "01HJUDGE0000000000000000001",
    doc_id: "01HDOC000000000000000000001",
    doc_version: 2,
    decision: "approve",
    confidence: 0.93,
    reasons: [{ dimension: "completeness", finding: "All ACs covered." }],
    checks: [{ check: "schema", outcome: "pass" }],
    blocking_questions: [],
    judge: { provider: "claude-cli", model: "claude-sonnet-5", prompt_version: "v1" },
    created_at: "2026-07-06T00:00:00.000Z",
    created_by: "ai:claude-cli:claude-sonnet-5:v1",
    ...overrides,
  };
}

describe("JudgmentBadge", () => {
  describe("happy path", () => {
    it('renders "unreviewed" when judgment is null', () => {
      render(<JudgmentBadge judgment={null} docVersion={1} />);
      expect(screen.getByText("unreviewed")).toBeInTheDocument();
    });

    it('renders "approve 0.93" for an approve decision with confidence 0.93', () => {
      const judgment = makeJudgment({ decision: "approve", confidence: 0.93, doc_version: 2 });
      render(<JudgmentBadge judgment={judgment} docVersion={2} />);
      expect(screen.getByText("approve 0.93")).toBeInTheDocument();
    });

    it('renders "reject 0.75" for a reject decision with confidence 0.75 (different value than approve case)', () => {
      const judgment = makeJudgment({ decision: "reject", confidence: 0.75, doc_version: 2 });
      render(<JudgmentBadge judgment={judgment} docVersion={2} />);
      expect(screen.getByText("reject 0.75")).toBeInTheDocument();
    });

    it('renders "escalate +2Q" for an escalating decision with 2 blocking questions', () => {
      const judgment = makeJudgment({
        decision: "escalate",
        confidence: 0.4,
        blocking_questions: ["What is the parent doc?", "Is this AC covered?"],
        doc_version: 2,
      });
      render(<JudgmentBadge judgment={judgment} docVersion={2} />);
      expect(screen.getByText("escalate +2Q")).toBeInTheDocument();
    });
  });

  describe("regression: blocking-question count reflects actual array length", () => {
    it('renders "escalate +1Q" (not +2Q) for a single blocking question', () => {
      const judgment = makeJudgment({
        decision: "escalate",
        blocking_questions: ["Only one question here."],
        doc_version: 2,
      });
      render(<JudgmentBadge judgment={judgment} docVersion={2} />);
      expect(screen.getByText("escalate +1Q")).toBeInTheDocument();
      expect(screen.queryByText("escalate +2Q")).not.toBeInTheDocument();
    });
  });

  describe("boundary: confidence formatting", () => {
    it("formats confidence 0 as 0.00", () => {
      const judgment = makeJudgment({ decision: "reject", confidence: 0, doc_version: 1 });
      render(<JudgmentBadge judgment={judgment} docVersion={1} />);
      expect(screen.getByText("reject 0.00")).toBeInTheDocument();
    });

    it("formats confidence 1 as 1.00", () => {
      const judgment = makeJudgment({ decision: "approve", confidence: 1, doc_version: 1 });
      render(<JudgmentBadge judgment={judgment} docVersion={1} />);
      expect(screen.getByText("approve 1.00")).toBeInTheDocument();
    });
  });

  describe("boundary: staleness is a strict less-than comparison", () => {
    it("is NOT stale when doc_version === docVersion", () => {
      const judgment = makeJudgment({ decision: "approve", confidence: 0.9, doc_version: 3 });
      render(<JudgmentBadge judgment={judgment} docVersion={3} />);
      expect(screen.getByText("approve 0.90")).toBeInTheDocument();
      expect(screen.queryByText(/\(stale\)/)).not.toBeInTheDocument();
    });

    it("is NOT stale when judgment.doc_version > docVersion", () => {
      const judgment = makeJudgment({ decision: "approve", confidence: 0.9, doc_version: 5 });
      render(<JudgmentBadge judgment={judgment} docVersion={3} />);
      expect(screen.getByText("approve 0.90")).toBeInTheDocument();
      expect(screen.queryByText(/\(stale\)/)).not.toBeInTheDocument();
    });
  });

  describe("staleness suffix + variant override", () => {
    it("appends (stale) to an approve judgment when doc_version < docVersion", () => {
      const judgment = makeJudgment({ decision: "approve", confidence: 0.93, doc_version: 2 });
      render(<JudgmentBadge judgment={judgment} docVersion={3} />);
      expect(screen.getByText("approve 0.93 (stale)")).toBeInTheDocument();
    });

    it("appends (stale) to an escalate judgment when doc_version < docVersion", () => {
      const judgment = makeJudgment({
        decision: "escalate",
        blocking_questions: ["Q1", "Q2"],
        doc_version: 2,
      });
      render(<JudgmentBadge judgment={judgment} docVersion={4} />);
      expect(screen.getByText("escalate +2Q (stale)")).toBeInTheDocument();
    });

    it("carries an explanatory title mentioning both version numbers when stale", () => {
      const judgment = makeJudgment({ decision: "approve", confidence: 0.93, doc_version: 2 });
      render(<JudgmentBadge judgment={judgment} docVersion={3} />);
      const badge = screen.getByText("approve 0.93 (stale)");
      expect(badge).toHaveAttribute("title", "Judged at v2; document is now v3");
    });

    it("carries no title attribute when not stale", () => {
      const judgment = makeJudgment({ decision: "approve", confidence: 0.93, doc_version: 3 });
      render(<JudgmentBadge judgment={judgment} docVersion={3} />);
      const badge = screen.getByText("approve 0.93");
      expect(badge).not.toHaveAttribute("title");
    });

    it("downgrades a stale escalate badge to the neutral outline variant (no destructive background class)", () => {
      const judgment = makeJudgment({
        decision: "escalate",
        blocking_questions: ["Q1"],
        doc_version: 2,
      });
      render(<JudgmentBadge judgment={judgment} docVersion={3} />);
      const badge = screen.getByText("escalate +1Q (stale)");
      expect(badge.className).not.toContain("bg-destructive");
      expect(badge.className).toContain("text-foreground");
    });

    it("uses the destructive variant for a non-stale escalate badge", () => {
      const judgment = makeJudgment({
        decision: "escalate",
        blocking_questions: ["Q1"],
        doc_version: 3,
      });
      render(<JudgmentBadge judgment={judgment} docVersion={3} />);
      const badge = screen.getByText("escalate +1Q");
      expect(badge.className).toContain("bg-destructive");
    });
  });
});
