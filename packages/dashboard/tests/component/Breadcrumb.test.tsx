// @vitest-environment jsdom
/**
 * Tests for Breadcrumb component (SPEC-036 §1 D1).
 * Source: SPEC-036 §1 D1, AC-36-3, AC-36-4
 *
 * Test plan:
 *   HAPPY:
 *     - Renders "Home" crumb + current title with aria-current, no ancestors
 *     - Renders every ancestor crumb (<=3), each calling onNavigate with its id
 *     - Clicking Home calls onHome
 *
 *   NEGATIVE:
 *     - Current title is plain text, not a button/link
 *     - Without onNavigate/onHome supplied, clicking crumbs does not throw
 *
 *   BOUNDARY:
 *     - Exactly 3 ancestors render with no collapsing (threshold boundary)
 *     - 4 ancestors collapse the middle two into a single "…" crumb, keeping
 *       root (first) and direct parent (last) visible
 *
 *   ERROR:
 *     - (n/a — pure presentational component, no IO to fail)
 *
 *   STATE:
 *     - Clicking the collapsed "…" crumb has no separate handler (non-interactive)
 *     - Clicking an ancestor after the overflow collapse still calls onNavigate
 *       with the correct (direct parent) id
 *
 *   REGRESSION:
 *     - Empty ancestors array renders no crumbs beyond Home + current title
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Breadcrumb } from "../../src/components/Breadcrumb";
import type { DocSummary } from "@lore/core";

function makeAncestor(id: string, title: string): DocSummary {
  return {
    id,
    slug: `spec-${id.toLowerCase()}`,
    title,
    type: "spec",
    status: "active",
    updated_at: "2024-01-01T00:00:00Z",
    tags: [],
    priority: "medium",
  };
}

describe("Breadcrumb", () => {
  describe("happy path", () => {
    it("renders Home and the current title with aria-current when there are no ancestors", () => {
      render(<Breadcrumb ancestors={[]} currentTitle="Current Doc" />);
      expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Home" })).toBeInTheDocument();
      expect(screen.getByText("Current Doc")).toHaveAttribute("aria-current", "page");
    });

    it("renders every ancestor crumb and calls onNavigate with its id", () => {
      const onNavigate = vi.fn();
      const ancestors = [makeAncestor("root-1", "Root"), makeAncestor("mid-1", "Mid")];
      render(<Breadcrumb ancestors={ancestors} currentTitle="Leaf" onNavigate={onNavigate} />);

      fireEvent.click(screen.getByText("Root"));
      expect(onNavigate).toHaveBeenCalledWith("root-1");

      fireEvent.click(screen.getByText("Mid"));
      expect(onNavigate).toHaveBeenCalledWith("mid-1");
    });

    it("calls onHome when the Home crumb is clicked", () => {
      const onHome = vi.fn();
      render(<Breadcrumb ancestors={[]} currentTitle="Leaf" onHome={onHome} />);
      fireEvent.click(screen.getByRole("button", { name: "Home" }));
      expect(onHome).toHaveBeenCalledTimes(1);
    });
  });

  describe("negative", () => {
    it("renders the current title as plain text, not an interactive element", () => {
      render(<Breadcrumb ancestors={[]} currentTitle="Leaf" />);
      const current = screen.getByText("Leaf");
      expect(current.tagName).not.toBe("BUTTON");
      expect(current.tagName).not.toBe("A");
    });

    it("does not throw when onNavigate/onHome are omitted and crumbs are clicked", () => {
      const ancestors = [makeAncestor("root-1", "Root")];
      render(<Breadcrumb ancestors={ancestors} currentTitle="Leaf" />);
      expect(() => {
        fireEvent.click(screen.getByRole("button", { name: "Home" }));
        fireEvent.click(screen.getByText("Root"));
      }).not.toThrow();
    });
  });

  describe("boundary", () => {
    it("renders exactly 3 ancestors with no collapsing", () => {
      const ancestors = [
        makeAncestor("a1", "One"),
        makeAncestor("a2", "Two"),
        makeAncestor("a3", "Three"),
      ];
      render(<Breadcrumb ancestors={ancestors} currentTitle="Leaf" />);
      expect(screen.getByText("One")).toBeInTheDocument();
      expect(screen.getByText("Two")).toBeInTheDocument();
      expect(screen.getByText("Three")).toBeInTheDocument();
      expect(screen.queryByText("…")).not.toBeInTheDocument();
    });

    it("collapses the middle ancestors when there are more than 3, keeping root + direct parent", () => {
      const ancestors = [
        makeAncestor("a1", "Root"),
        makeAncestor("a2", "Mid One"),
        makeAncestor("a3", "Mid Two"),
        makeAncestor("a4", "Direct Parent"),
      ];
      render(<Breadcrumb ancestors={ancestors} currentTitle="Leaf" />);
      expect(screen.getByText("Root")).toBeInTheDocument();
      expect(screen.getByText("Direct Parent")).toBeInTheDocument();
      const ellipsis = screen.getByText("…");
      expect(ellipsis).toBeInTheDocument();
      expect(ellipsis).toHaveAttribute("title", "Mid One, Mid Two");
      expect(screen.queryByText("Mid One")).not.toBeInTheDocument();
      expect(screen.queryByText("Mid Two")).not.toBeInTheDocument();
    });
  });

  describe("state", () => {
    it("the collapsed ellipsis crumb is not a button (non-interactive)", () => {
      const ancestors = [
        makeAncestor("a1", "Root"),
        makeAncestor("a2", "Mid One"),
        makeAncestor("a3", "Mid Two"),
        makeAncestor("a4", "Direct Parent"),
      ];
      render(<Breadcrumb ancestors={ancestors} currentTitle="Leaf" />);
      expect(screen.getByText("…").tagName).not.toBe("BUTTON");
    });

    it("clicking the visible direct-parent crumb after collapse calls onNavigate with its id", () => {
      const onNavigate = vi.fn();
      const ancestors = [
        makeAncestor("a1", "Root"),
        makeAncestor("a2", "Mid One"),
        makeAncestor("a3", "Mid Two"),
        makeAncestor("a4", "Direct Parent"),
      ];
      render(<Breadcrumb ancestors={ancestors} currentTitle="Leaf" onNavigate={onNavigate} />);
      fireEvent.click(screen.getByText("Direct Parent"));
      expect(onNavigate).toHaveBeenCalledWith("a4");
    });
  });

  describe("regression", () => {
    it("renders no ancestor crumbs beyond Home + current title when ancestors is empty", () => {
      render(<Breadcrumb ancestors={[]} currentTitle="Root Doc" />);
      const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
      expect(nav.querySelectorAll("button")).toHaveLength(1); // Home only
    });
  });
});
