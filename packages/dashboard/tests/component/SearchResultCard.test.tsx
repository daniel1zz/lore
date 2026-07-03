// @vitest-environment jsdom
/**
 * Tests for SearchResultCard component.
 * Source: SPEC-031 (real-envelope fixtures — `SearchHit` is
 *   `{ id, slug, title, snippet, score }`, NOT a `DocSummary` — no `type`/`status`/
 *   `updated_at`. `search.tsx` renders `data.results` through this component, not
 *   `data.docs` through `DocCard`).
 *
 * Test plan:
 *   HAPPY:
 *     - Renders hit title
 *     - Renders snippet text
 *     - Renders slug
 *
 *   NEGATIVE:
 *     - onClick not called when card is not interacted with
 *
 *   BOUNDARY:
 *     - Empty snippet renders without crashing
 *
 *   STATE:
 *     - onClick is called exactly once on click
 *
 *   REGRESSION:
 *     - Card renders without crashing with a minimal real-shape SearchHit (no type/status fields)
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SearchResultCard } from "../../src/components/SearchResultCard";
import type { SearchHit } from "../../src/lib/api";

const mockHit: SearchHit = {
  id: "01HTEST00000000000000000001",
  slug: "prd-test-document",
  title: "Test Document",
  snippet: "...this is a [matched] snippet of content...",
  score: 1.23,
};

describe("SearchResultCard", () => {
  describe("happy path", () => {
    it("renders the hit title", () => {
      render(<SearchResultCard hit={mockHit} />);
      expect(screen.getByText("Test Document")).toBeInTheDocument();
    });

    it("renders the snippet text", () => {
      render(<SearchResultCard hit={mockHit} />);
      expect(screen.getByText(/matched/)).toBeInTheDocument();
    });

    it("renders the slug", () => {
      render(<SearchResultCard hit={mockHit} />);
      expect(screen.getByText("prd-test-document")).toBeInTheDocument();
    });
  });

  describe("negative", () => {
    it("does not call onClick when not interacted with", () => {
      const onClick = vi.fn();
      render(<SearchResultCard hit={mockHit} onClick={onClick} />);
      expect(onClick).not.toHaveBeenCalled();
    });
  });

  describe("boundary", () => {
    it("renders without crashing when snippet is an empty string", () => {
      render(<SearchResultCard hit={{ ...mockHit, snippet: "" }} />);
      expect(screen.getByText("Test Document")).toBeInTheDocument();
    });
  });

  describe("state", () => {
    it("calls onClick exactly once per click", () => {
      const onClick = vi.fn();
      render(<SearchResultCard hit={mockHit} onClick={onClick} />);
      fireEvent.click(screen.getByRole("button", { name: /Test Document/ }));
      expect(onClick).toHaveBeenCalledTimes(1);
    });
  });

  describe("regression", () => {
    it("renders without crashing given a minimal real-shape SearchHit (no type/status fields)", () => {
      const minimalHit: SearchHit = {
        id: "id-2",
        slug: "slug-2",
        title: "Minimal Hit",
        snippet: "",
        score: 0,
      };
      render(<SearchResultCard hit={minimalHit} />);
      expect(screen.getByText("Minimal Hit")).toBeInTheDocument();
    });
  });
});
