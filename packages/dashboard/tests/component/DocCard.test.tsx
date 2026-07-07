// @vitest-environment jsdom
/**
 * Tests for DocCard component.
 * Source: SPEC-015 §3.3 M5; SPEC-036 §1 D3 (type accent, meta row, tag chips, priority)
 *
 * Test plan:
 *   HAPPY:
 *     - Renders document title
 *     - Renders type badge
 *     - Renders status badge
 *     - Renders slug in footer
 *     - Renders the type accent border class (AC-36-9)
 *     - Renders up to 3 tag chips
 *     - Renders a priority badge for critical/high
 *
 *   NEGATIVE:
 *     - onClick not called when card is not interacted with
 *     - Does not render a priority badge for default/low priority (noise budget)
 *     - Does not render a meta row for a prd doc (no DocTypeMeta variant)
 *
 *   BOUNDARY:
 *     - Long title truncation
 *     - >3 tags collapse into a "+n" overflow chip
 *
 *   STATE:
 *     - onClick is called exactly once on click
 *
 *   REGRESSION:
 *     - Card renders without crashing with minimal DocSummary
 *     - Task meta parity with the CLI badge rule table (AC-36-8): unclaimed,
 *       claimed fresh, claimed stale, with/without evidence
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DocCard } from "../../src/components/DocCard";
import type { DocSummary } from "@lore/core";

const mockDoc: DocSummary = {
  id: "01HTEST00000000000000000001",
  slug: "prd-test-document",
  title: "Test Document",
  type: "prd",
  status: "draft",
  updated_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  tags: [],
  priority: "medium",
};

describe("DocCard", () => {
  describe("happy path", () => {
    it("renders the document title", () => {
      render(<DocCard doc={mockDoc} />);
      expect(screen.getByText("Test Document")).toBeInTheDocument();
    });

    it("renders the type badge", () => {
      render(<DocCard doc={mockDoc} />);
      expect(screen.getByText("prd")).toBeInTheDocument();
    });

    it("renders the status badge", () => {
      render(<DocCard doc={mockDoc} />);
      expect(screen.getByText("draft")).toBeInTheDocument();
    });

    it("renders the slug in a recognizable pattern", () => {
      render(<DocCard doc={mockDoc} />);
      expect(screen.getByText("prd-test-document")).toBeInTheDocument();
    });

    it("renders a relative time string", () => {
      render(<DocCard doc={mockDoc} />);
      // The relative time should contain "days ago" for a 2-day-old doc
      expect(screen.getByText(/days ago|yesterday|today/)).toBeInTheDocument();
    });

    it("renders the type accent border class (AC-36-9)", () => {
      const { container } = render(<DocCard doc={mockDoc} />);
      const card = container.firstElementChild;
      expect(card).toHaveClass("border-l-4", "border-l-violet-600");
    });

    it("renders up to 3 tag chips", () => {
      const docWithTags: DocSummary = { ...mockDoc, tags: ["a", "b", "c"] };
      render(<DocCard doc={docWithTags} />);
      expect(screen.getByText("a")).toBeInTheDocument();
      expect(screen.getByText("b")).toBeInTheDocument();
      expect(screen.getByText("c")).toBeInTheDocument();
    });

    it("renders a priority badge for critical priority", () => {
      const criticalDoc: DocSummary = { ...mockDoc, priority: "critical" };
      render(<DocCard doc={criticalDoc} />);
      expect(screen.getByText("critical")).toBeInTheDocument();
    });

    it("renders a priority badge for high priority", () => {
      const highDoc: DocSummary = { ...mockDoc, priority: "high" };
      render(<DocCard doc={highDoc} />);
      expect(screen.getByText("high")).toBeInTheDocument();
    });
  });

  describe("state: click handler", () => {
    it("calls onClick exactly once when card is clicked", () => {
      const onClick = vi.fn();
      render(<DocCard doc={mockDoc} onClick={onClick} />);

      fireEvent.click(screen.getByRole("button", { name: /Open document: Test Document/ }));

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("does not call onClick when no onClick prop is provided", () => {
      render(<DocCard doc={mockDoc} />);
      const card = screen.getByRole("button");
      fireEvent.click(card);
      // Just ensure no error is thrown
    });
  });

  describe("negative", () => {
    it("onClick is not called before any interaction", () => {
      const onClick = vi.fn();
      render(<DocCard doc={mockDoc} onClick={onClick} />);
      expect(onClick).not.toHaveBeenCalled();
    });

    it("does not render a priority badge for medium priority (noise budget)", () => {
      render(<DocCard doc={mockDoc} />);
      expect(screen.queryByText("medium")).not.toBeInTheDocument();
    });

    it("does not render a priority badge for low priority (noise budget)", () => {
      const lowDoc: DocSummary = { ...mockDoc, priority: "low" };
      render(<DocCard doc={lowDoc} />);
      expect(screen.queryByText("low")).not.toBeInTheDocument();
    });

    it("does not render a meta row for a prd doc (no DocTypeMeta variant)", () => {
      render(<DocCard doc={mockDoc} />);
      // prd never carries `.meta` — no extra outline badge beyond type/status.
      expect(screen.queryByText("feature")).not.toBeInTheDocument();
    });
  });

  describe("boundary", () => {
    it("renders without crashing with a minimal DocSummary (regression)", () => {
      const minimalDoc: DocSummary = {
        id: "01HMIN00000000000000000001",
        slug: "knowledge-x",
        title: "X",
        type: "knowledge",
        status: "active",
        updated_at: new Date().toISOString(),
        tags: [],
        priority: "medium",
      };
      render(<DocCard doc={minimalDoc} />);
      expect(screen.getByText("X")).toBeInTheDocument();
    });

    it("renders with a long title without crashing", () => {
      const docWithLongTitle: DocSummary = {
        ...mockDoc,
        title: "A".repeat(200),
      };
      render(<DocCard doc={docWithLongTitle} />);
      expect(screen.getByText("A".repeat(200))).toBeInTheDocument();
    });

    it("collapses tags beyond 3 into a single '+n' overflow chip", () => {
      const docWithManyTags: DocSummary = { ...mockDoc, tags: ["a", "b", "c", "d", "e"] };
      render(<DocCard doc={docWithManyTags} />);
      expect(screen.getByText("a")).toBeInTheDocument();
      expect(screen.getByText("b")).toBeInTheDocument();
      expect(screen.getByText("c")).toBeInTheDocument();
      expect(screen.queryByText("d")).not.toBeInTheDocument();
      expect(screen.queryByText("e")).not.toBeInTheDocument();
      expect(screen.getByText("+2")).toBeInTheDocument();
    });
  });

  describe("regression: task meta parity with CLI badge rule table (AC-36-8)", () => {
    function taskDoc(meta: Extract<DocSummary["meta"], { t: "task" }>): DocSummary {
      return { ...mockDoc, type: "task", meta };
    }

    it("unclaimed, no evidence: renders no meta badge at all", () => {
      render(<DocCard doc={taskDoc({ t: "task", evidence_pass: 0, evidence_fail: 0 })} />);
      expect(screen.queryByText(/claimed:/)).not.toBeInTheDocument();
      expect(screen.queryByText(/✔/)).not.toBeInTheDocument();
    });

    it("claimed fresh, no evidence: renders 'claimed:X' with no stale suffix", () => {
      render(
        <DocCard
          doc={taskDoc({ t: "task", claimed_by: "alice", claim_stale: false, evidence_pass: 0, evidence_fail: 0 })}
        />,
      );
      expect(screen.getByText("claimed:alice")).toBeInTheDocument();
    });

    it("claimed stale: renders the '(stale)' suffix", () => {
      render(
        <DocCard
          doc={taskDoc({ t: "task", claimed_by: "bob", claim_stale: true, evidence_pass: 1, evidence_fail: 0 })}
        />,
      );
      expect(screen.getByText("claimed:bob (stale) ✔1/✘0")).toBeInTheDocument();
    });

    it("claimed with evidence renders both claim and pass/fail counts", () => {
      render(
        <DocCard
          doc={taskDoc({ t: "task", claimed_by: "carol", claim_stale: false, evidence_pass: 2, evidence_fail: 1 })}
        />,
      );
      expect(screen.getByText("claimed:carol ✔2/✘1")).toBeInTheDocument();
    });
  });

  describe("SPEC-037 AC-37-6: danger color", () => {
    function taskDoc(meta: Extract<DocSummary["meta"], { t: "task" }>): DocSummary {
      return { ...mockDoc, type: "task", meta };
    }

    it("renders the destructive badge variant when evidence_fail > 0", () => {
      render(<DocCard doc={taskDoc({ t: "task", evidence_pass: 1, evidence_fail: 3 })} />);
      const badge = screen.getByText("✔1/✘3");
      expect(badge).toHaveClass("text-destructive-foreground");
    });

    it("does not render the destructive variant when evidence_fail === 0", () => {
      render(<DocCard doc={taskDoc({ t: "task", evidence_pass: 2, evidence_fail: 0 })} />);
      const badge = screen.getByText("✔2/✘0");
      expect(badge).not.toHaveClass("text-destructive-foreground");
    });
  });
});
