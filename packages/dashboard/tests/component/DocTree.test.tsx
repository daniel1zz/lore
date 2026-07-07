// @vitest-environment jsdom
/**
 * Tests for DocTree component.
 * Source: SPEC-015 §3.3 M5; SPEC-031 (real-envelope fixtures — `TreeNode` is
 *   `{ doc: DocSummary, children: TreeNode[] }`, a single recursive root, not a
 *   flat array of top-level nodes).
 *
 * Test plan:
 *   HAPPY:
 *     - Renders root node title
 *     - Nested children visible when parent expanded (depth < 2)
 *     - Collapse/expand toggle works via chevron button
 *
 *   NEGATIVE:
 *     - null root shows empty message
 *     - undefined root shows empty message
 *
 *   STATE:
 *     - Node starts expanded at depth 0/1; collapsed at depth 2+
 *     - Clicking the chevron of a collapsed node expands it, without calling onSelect
 *     - Clicking the chevron of an expanded node collapses it
 *     - Enter on the chevron toggles expansion (keyboard)
 *
 *   REGRESSION:
 *     - onSelect called with the real-shape node (doc.id / doc.title) when the title
 *       is clicked, and does NOT toggle expansion (SPEC-037 D4 gesture split)
 *     - Enter on the title navigates (onSelect) and does not toggle
 *     - Leaf node (no children) click still navigates, and renders no chevron button
 *     - Multiple sibling child nodes render under the single root
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DocTree } from "../../src/components/DocTree";
import type { TreeNode } from "../../src/lib/api";

const leafNode = (id: string, title: string): TreeNode => ({
  doc: {
    id,
    slug: `spec-${id}`,
    title,
    type: "spec",
    status: "active",
    updated_at: "2024-01-01T00:00:00.000Z",
  },
  children: [],
});

const parentNode: TreeNode = {
  doc: {
    id: "parent-1",
    slug: "prd-parent",
    title: "Parent PRD",
    type: "prd",
    status: "active",
    updated_at: "2024-01-01T00:00:00.000Z",
  },
  children: [leafNode("child-1", "Child Spec A"), leafNode("child-2", "Child Spec B")],
};

describe("DocTree", () => {
  describe("happy path", () => {
    it("renders root node title", () => {
      render(<DocTree root={parentNode} />);
      expect(screen.getByText("Parent PRD")).toBeInTheDocument();
    });

    it("renders child nodes visible at depth 0 (auto-expanded)", () => {
      render(<DocTree root={parentNode} />);
      expect(screen.getByText("Child Spec A")).toBeInTheDocument();
      expect(screen.getByText("Child Spec B")).toBeInTheDocument();
    });

    it("renders type badges for nodes", () => {
      render(<DocTree root={leafNode("x", "Leaf")} />);
      expect(screen.getByText("spec")).toBeInTheDocument();
    });
  });

  describe("negative", () => {
    it("shows empty message when root is null", () => {
      render(<DocTree root={null} />);
      expect(screen.getByText(/No documents in tree/)).toBeInTheDocument();
    });

    it("shows empty message when root is undefined", () => {
      render(<DocTree root={undefined} />);
      expect(screen.getByText(/No documents in tree/)).toBeInTheDocument();
    });
  });

  describe("state: collapse/expand (chevron button)", () => {
    it("collapses children when the chevron is clicked (toggle), without calling onSelect", () => {
      const onSelect = vi.fn();
      render(<DocTree root={parentNode} onSelect={onSelect} />);

      // Children visible initially (expanded at depth 0)
      expect(screen.getByText("Child Spec A")).toBeInTheDocument();

      // Click the chevron (not the title) to collapse
      fireEvent.click(screen.getByRole("button", { name: "Collapse Parent PRD" }));

      expect(screen.queryByText("Child Spec A")).not.toBeInTheDocument();
      expect(onSelect).not.toHaveBeenCalled();
    });

    it("expands children when the chevron of a collapsed node is clicked again, without calling onSelect", () => {
      const onSelect = vi.fn();
      render(<DocTree root={parentNode} onSelect={onSelect} />);

      // Collapse first
      fireEvent.click(screen.getByRole("button", { name: "Collapse Parent PRD" }));
      expect(screen.queryByText("Child Spec A")).not.toBeInTheDocument();

      // Re-expand via the (now relabeled) chevron button
      fireEvent.click(screen.getByRole("button", { name: "Expand Parent PRD" }));
      expect(screen.getByText("Child Spec A")).toBeInTheDocument();
      expect(onSelect).not.toHaveBeenCalled();
    });

    it("aria-expanded lives on the chevron button, reflecting current state", () => {
      render(<DocTree root={parentNode} />);
      const chevron = screen.getByRole("button", { name: "Collapse Parent PRD" });
      expect(chevron).toHaveAttribute("aria-expanded", "true");

      fireEvent.click(chevron);
      expect(screen.getByRole("button", { name: "Expand Parent PRD" })).toHaveAttribute("aria-expanded", "false");
    });

    it("Enter on the chevron toggles expansion without navigating", () => {
      const onSelect = vi.fn();
      render(<DocTree root={parentNode} onSelect={onSelect} />);

      const chevron = screen.getByRole("button", { name: "Collapse Parent PRD" });
      fireEvent.keyDown(chevron, { key: "Enter" });

      expect(screen.queryByText("Child Spec A")).not.toBeInTheDocument();
      expect(onSelect).not.toHaveBeenCalled();
    });
  });

  describe("regression", () => {
    it("calls onSelect with the real-shape node when the title is clicked, and does not toggle expansion", () => {
      const onSelect = vi.fn();
      render(<DocTree root={parentNode} onSelect={onSelect} />);

      fireEvent.click(screen.getByText("Parent PRD"));

      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ doc: expect.objectContaining({ id: "parent-1", title: "Parent PRD" }) }),
      );
      // Title click must not collapse the node's children.
      expect(screen.getByText("Child Spec A")).toBeInTheDocument();
    });

    it("Enter on the title navigates via onSelect and does not toggle", () => {
      const onSelect = vi.fn();
      render(<DocTree root={parentNode} onSelect={onSelect} />);

      fireEvent.keyDown(screen.getByText("Parent PRD"), { key: "Enter" });

      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ doc: expect.objectContaining({ id: "parent-1", title: "Parent PRD" }) }),
      );
      expect(screen.getByText("Child Spec A")).toBeInTheDocument();
    });

    it("leaf node click still navigates and renders no chevron button", () => {
      const onSelect = vi.fn();
      render(<DocTree root={leafNode("leaf-x", "Leaf Node")} onSelect={onSelect} />);

      expect(screen.queryByRole("button", { name: /Expand|Collapse/ })).not.toBeInTheDocument();

      fireEvent.click(screen.getByText("Leaf Node"));

      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ doc: expect.objectContaining({ id: "leaf-x", title: "Leaf Node" }) }),
      );
    });

    it("renders multiple sibling child nodes under the single root", () => {
      const root: TreeNode = {
        doc: {
          id: "root",
          slug: "root-doc",
          title: "Root",
          type: "prd",
          status: "active",
          updated_at: "2024-01-01T00:00:00.000Z",
        },
        children: [leafNode("a", "Alpha"), leafNode("b", "Beta")],
      };
      render(<DocTree root={root} />);
      expect(screen.getByText("Alpha")).toBeInTheDocument();
      expect(screen.getByText("Beta")).toBeInTheDocument();
    });
  });
});
