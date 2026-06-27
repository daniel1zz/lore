// @vitest-environment jsdom
/**
 * Tests for DocTree component.
 * Source: SPEC-015 §3.3 M5
 *
 * Test plan:
 *   HAPPY:
 *     - Renders top-level node titles
 *     - Nested children visible when parent expanded (depth < 2)
 *     - Collapse/expand toggle works
 *
 *   NEGATIVE:
 *     - Empty nodes array shows empty message
 *
 *   STATE:
 *     - Node starts expanded at depth 0/1; collapsed at depth 2+
 *     - Clicking a collapsed node expands it
 *     - Clicking an expanded node collapses it
 *
 *   REGRESSION:
 *     - onSelect called when node is clicked
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DocTree } from "../../src/components/DocTree";
import type { TreeNode } from "../../src/lib/api";

const leafNode = (id: string, title: string): TreeNode => ({
  id,
  slug: `spec-${id}`,
  title,
  type: "spec",
  status: "active",
  children: [],
});

const parentNode: TreeNode = {
  id: "parent-1",
  slug: "prd-parent",
  title: "Parent PRD",
  type: "prd",
  status: "active",
  children: [
    leafNode("child-1", "Child Spec A"),
    leafNode("child-2", "Child Spec B"),
  ],
};

describe("DocTree", () => {
  describe("happy path", () => {
    it("renders top-level node title", () => {
      render(<DocTree nodes={[parentNode]} />);
      expect(screen.getByText("Parent PRD")).toBeInTheDocument();
    });

    it("renders child nodes visible at depth 0 (auto-expanded)", () => {
      render(<DocTree nodes={[parentNode]} />);
      expect(screen.getByText("Child Spec A")).toBeInTheDocument();
      expect(screen.getByText("Child Spec B")).toBeInTheDocument();
    });

    it("renders type badges for nodes", () => {
      render(<DocTree nodes={[leafNode("x", "Leaf")]} />);
      expect(screen.getByText("spec")).toBeInTheDocument();
    });
  });

  describe("negative", () => {
    it("shows empty message when nodes array is empty", () => {
      render(<DocTree nodes={[]} />);
      expect(screen.getByText(/No documents in tree/)).toBeInTheDocument();
    });
  });

  describe("state: collapse/expand", () => {
    it("collapses children when parent node is clicked (toggle)", () => {
      render(<DocTree nodes={[parentNode]} />);

      // Children visible initially (expanded at depth 0)
      expect(screen.getByText("Child Spec A")).toBeInTheDocument();

      // Click parent to collapse
      fireEvent.click(screen.getByText("Parent PRD"));

      expect(screen.queryByText("Child Spec A")).not.toBeInTheDocument();
    });

    it("expands children when collapsed parent is clicked again", () => {
      render(<DocTree nodes={[parentNode]} />);

      // Collapse first
      fireEvent.click(screen.getByText("Parent PRD"));
      expect(screen.queryByText("Child Spec A")).not.toBeInTheDocument();

      // Re-expand
      fireEvent.click(screen.getByText("Parent PRD"));
      expect(screen.getByText("Child Spec A")).toBeInTheDocument();
    });
  });

  describe("regression", () => {
    it("calls onSelect with the node when clicked", () => {
      const onSelect = vi.fn();
      render(<DocTree nodes={[leafNode("leaf-x", "Leaf Node")]} onSelect={onSelect} />);

      fireEvent.click(screen.getByText("Leaf Node"));

      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "leaf-x", title: "Leaf Node" }));
    });

    it("renders multiple top-level nodes", () => {
      render(<DocTree nodes={[leafNode("a", "Alpha"), leafNode("b", "Beta")]} />);
      expect(screen.getByText("Alpha")).toBeInTheDocument();
      expect(screen.getByText("Beta")).toBeInTheDocument();
    });
  });
});
