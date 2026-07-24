// @vitest-environment jsdom
/**
 * Tests for JudgmentDrilldown — expandable detail panel for a review judgment
 * (SPEC-075 R-9).
 * @spec_ref AC-075-7
 *
 * Test plan (six-dimension coverage):
 *   HAPPY:
 *     - expanding renders decision, confidence, reasons, checks, blocking
 *       questions, and judge prompt_version
 *   NEGATIVE:
 *     - judgment === null renders nothing (no affordance, no crash)
 *   BOUNDARY:
 *     - an empty reasons/checks/blocking_questions array renders no
 *       corresponding sub-list (never an empty <ul>)
 *   ERROR:
 *     - n/a (pure render of an already-typed judgment)
 *   STATE:
 *     - collapsed by default; toggling shows/hides the detail body
 *   REGRESSION:
 *     - a STALE judgment (doc_version < current, simulated by the caller
 *       having a stale judgment object) still renders its full detail —
 *       this component never withholds detail based on staleness
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReviewJudgment } from "@lore/core";
import { JudgmentDrilldown } from "../../src/components/JudgmentDrilldown";

function makeJudgment(overrides: Partial<ReviewJudgment> = {}): ReviewJudgment {
  return {
    id: "01HJUDGE0000000000000000001",
    doc_id: "01HDOC00000000000000000001",
    doc_version: 1,
    decision: "approve",
    confidence: 0.87,
    reasons: [{ dimension: "completeness", finding: "All ACs covered" }],
    checks: [{ check: "schema", outcome: "pass" }],
    blocking_questions: [],
    judge: { provider: "claude-cli", model: "claude-sonnet-5", prompt_version: "v3" },
    created_at: "2026-01-01T00:00:00.000Z",
    created_by: "ai:claude-cli:claude-sonnet-5:v3",
    ...overrides,
  };
}

describe("JudgmentDrilldown (AC-075-7)", () => {
  describe("happy path", () => {
    it("expanding renders decision, confidence, reasons, checks, and prompt_version", async () => {
      const user = userEvent.setup();
      render(<JudgmentDrilldown judgment={makeJudgment()} />);

      await user.click(screen.getByRole("button", { name: "Show judgment detail" }));

      expect(screen.getByText("approve")).toBeInTheDocument();
      expect(screen.getByText("0.87")).toBeInTheDocument();
      expect(screen.getByText(/All ACs covered/)).toBeInTheDocument();
      expect(screen.getByText(/schema: pass/)).toBeInTheDocument();
      expect(screen.getByText(/v3/)).toBeInTheDocument();
    });

    it("renders blocking questions when present", async () => {
      const user = userEvent.setup();
      render(<JudgmentDrilldown judgment={makeJudgment({ decision: "escalate", blocking_questions: ["Is scope final?"] })} />);
      await user.click(screen.getByRole("button", { name: "Show judgment detail" }));
      expect(screen.getByText("Is scope final?")).toBeInTheDocument();
    });
  });

  describe("negative", () => {
    it("renders nothing when judgment is null", () => {
      const { container } = render(<JudgmentDrilldown judgment={null} />);
      expect(container).toBeEmptyDOMElement();
    });
  });

  describe("boundary", () => {
    it("renders no blocking-questions sub-list when the array is empty", async () => {
      const user = userEvent.setup();
      render(<JudgmentDrilldown judgment={makeJudgment({ blocking_questions: [] })} />);
      await user.click(screen.getByRole("button", { name: "Show judgment detail" }));
      expect(screen.queryByText("Blocking questions")).not.toBeInTheDocument();
    });
  });

  describe("state", () => {
    it("is collapsed by default and toggles open/closed on click", async () => {
      const user = userEvent.setup();
      render(<JudgmentDrilldown judgment={makeJudgment()} />);

      expect(screen.queryByText(/Decision:/)).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Show judgment detail" }));
      expect(screen.getByText(/Decision:/)).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Hide judgment detail" }));
      expect(screen.queryByText(/Decision:/)).not.toBeInTheDocument();
    });
  });

  describe("regression", () => {
    it("renders full detail for a stale judgment (staleness never withholds detail)", async () => {
      // reason: doc_version=1 with the doc now at a later version is exactly what
      // JudgmentBadge renders as "(stale)" — this component doesn't take
      // docVersion at all and must render identically regardless.
      const user = userEvent.setup();
      render(<JudgmentDrilldown judgment={makeJudgment({ doc_version: 1 })} />);
      await user.click(screen.getByRole("button", { name: "Show judgment detail" }));
      expect(screen.getByText("approve")).toBeInTheDocument();
      expect(screen.getByText(/All ACs covered/)).toBeInTheDocument();
    });
  });
});
