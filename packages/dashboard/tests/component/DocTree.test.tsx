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
 *     - Collapse/expand toggle works
 *
 *   NEGATIVE:
 *     - null root shows empty message
 *     - undefined root shows empty message
 *
 *   STATE:
 *     - Node starts expanded at depth 0/1; collapsed at depth 2+
 *     - Clicking a collapsed node expands it
 *     - Clicking an expanded node collapses it
 *
 *   REGRESSION:
 *     - onSelect called with the real-shape node (doc.id / doc.title) when clicked
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

  describe("state: collapse/expand", () => {
    it("collapses children when parent node is clicked (toggle)", () => {
      render(<DocTree root={parentNode} />);

      // Children visible initially (expanded at depth 0)
      expect(screen.getByText("Child Spec A")).toBeInTheDocument();

      // Click parent to collapse
      fireEvent.click(screen.getByText("Parent PRD"));

      expect(screen.queryByText("Child Spec A")).not.toBeInTheDocument();
    });

    it("expands children when collapsed parent is clicked again", () => {
      render(<DocTree root={parentNode} />);

      // Collapse first
      fireEvent.click(screen.getByText("Parent PRD"));
      expect(screen.queryByText("Child Spec A")).not.toBeInTheDocument();

      // Re-expand
      fireEvent.click(screen.getByText("Parent PRD"));
      expect(screen.getByText("Child Spec A")).toBeInTheDocument();
    });
  });

  describe("regression", () => {
    it("calls onSelect with the real-shape node when clicked", () => {
      const onSelect = vi.fn();
      render(<DocTree root={leafNode("leaf-x", "Leaf Node")} onSelect={onSelect} />);

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
