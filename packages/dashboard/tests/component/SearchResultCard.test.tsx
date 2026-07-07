// @vitest-environment jsdom
/**
 * Tests for SearchResultCard component.
 * Source: SPEC-031 (real-envelope fixtures); SPEC-037 §1 D5 (mark-highlight + badges)
 *
 * SPEC-037 note: `SearchHit` now carries `type`/`status` (mandatory fields) and
 * `snippet` wraps matched spans in `SNIPPET_MARK_OPEN`/`SNIPPET_MARK_CLOSE`
 * control-character sentinels (NOT literal `[`/`]` — the pre-037 delimiters,
 * which collided with literal brackets in document bodies).
 *
 * Test plan:
 *   HAPPY:
 *     - Renders hit title
 *     - Renders snippet text (matched span split into a <mark>)
 *     - Renders slug
 *     - Renders type + status badges
 *
 *   NEGATIVE:
 *     - onClick not called when card is not interacted with
 *
 *   BOUNDARY:
 *     - Empty snippet renders without crashing
 *     - A snippet with no sentinels renders as plain text (no <mark>)
 *
 *   STATE:
 *     - onClick is called exactly once on click
 *
 *   REGRESSION:
 *     - Card renders without crashing with a minimal real-shape SearchHit
 *     - Literal `[`/`]` brackets in a snippet render as plain text, not treated
 *       as highlight markers (AC-37-8 — the exact bug the sentinel switch fixes)
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SearchResultCard } from "../../src/components/SearchResultCard";
import type { SearchHit } from "../../src/lib/api";
import { SNIPPET_MARK_OPEN, SNIPPET_MARK_CLOSE } from "@lore/core";

const mockHit: SearchHit = {
  id: "01HTEST00000000000000000001",
  slug: "prd-test-document",
  title: "Test Document",
  snippet: `...this is a ${SNIPPET_MARK_OPEN}matched${SNIPPET_MARK_CLOSE} snippet of content...`,
  score: 1.23,
  type: "prd",
  status: "active",
};

describe("SearchResultCard", () => {
  describe("happy path", () => {
    it("renders the hit title", () => {
      render(<SearchResultCard hit={mockHit} />);
      expect(screen.getByText("Test Document")).toBeInTheDocument();
    });

    it("renders the matched span inside a <mark> element", () => {
      const { container } = render(<SearchResultCard hit={mockHit} />);
      const mark = container.querySelector("mark");
      expect(mark).not.toBeNull();
      expect(mark).toHaveTextContent("matched");
    });

    it("renders the slug", () => {
      render(<SearchResultCard hit={mockHit} />);
      expect(screen.getByText("prd-test-document")).toBeInTheDocument();
    });

    it("renders the type badge", () => {
      render(<SearchResultCard hit={mockHit} />);
      expect(screen.getByText("prd")).toBeInTheDocument();
    });

    it("renders the status badge", () => {
      render(<SearchResultCard hit={mockHit} />);
      expect(screen.getByText("active")).toBeInTheDocument();
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

    it("renders a snippet with no sentinels as plain text (no <mark>)", () => {
      const { container } = render(<SearchResultCard hit={{ ...mockHit, snippet: "no highlight here" }} />);
      expect(container.querySelector("mark")).toBeNull();
      expect(screen.getByText("no highlight here")).toBeInTheDocument();
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
    it("renders without crashing given a minimal real-shape SearchHit", () => {
      const minimalHit: SearchHit = {
        id: "id-2",
        slug: "slug-2",
        title: "Minimal Hit",
        snippet: "",
        score: 0,
        type: "knowledge",
        status: "draft",
      };
      render(<SearchResultCard hit={minimalHit} />);
      expect(screen.getByText("Minimal Hit")).toBeInTheDocument();
    });

    it("renders literal [ and ] brackets in a snippet as plain text, not highlight markers (AC-37-8)", () => {
      const { container } = render(
        <SearchResultCard hit={{ ...mockHit, snippet: "see the [bracketed] term here" }} />,
      );
      expect(container.querySelector("mark")).toBeNull();
      expect(screen.getByText("see the [bracketed] term here")).toBeInTheDocument();
    });
  });
});
