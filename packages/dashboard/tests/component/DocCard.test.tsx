// @vitest-environment jsdom
/**
 * Tests for DocCard component.
 * Source: SPEC-015 §3.3 M5
 *
 * Test plan:
 *   HAPPY:
 *     - Renders document title
 *     - Renders type badge
 *     - Renders status badge
 *     - Renders slug in footer
 *
 *   NEGATIVE:
 *     - onClick not called when card is not interacted with
 *
 *   BOUNDARY:
 *     - Long title truncation
 *
 *   STATE:
 *     - onClick is called exactly once on click
 *
 *   REGRESSION:
 *     - Card renders without crashing with minimal DocSummary
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
  });
});
