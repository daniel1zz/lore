// @vitest-environment jsdom
/**
 * Tests for DocDetail component.
 * Source: SPEC-015 §3.3 M5
 *
 * Test plan:
 *   HAPPY:
 *     - Renders document title as h1
 *     - Renders markdown body content
 *     - Renders metadata table with ID, created date, updated date
 *     - Renders type and status badges
 *
 *   NEGATIVE:
 *     - Renders without navigation footer when no parent/children
 *
 *   STATE:
 *     - onNavigate called when parent link is clicked
 *
 *   REGRESSION:
 *     - Tags section hidden when doc.tags is empty
 *     - Author row hidden when created_by is null
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DocDetail } from "../../src/components/DocDetail";
import type { DocWithNavigation } from "../../src/lib/api";
import type { DocRecord } from "@lore/core";

const mockDocRecord: DocRecord = {
  id: "01HTEST00000000000000000001",
  slug: "prd-test",
  title: "Test PRD",
  type: "prd",
  status: "active",
  content: "# Overview\n\nThis is a test PRD.",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-06-01T00:00:00Z",
  created_by: null,
  parent_id: null,
  tags: [],
  extra: {},
  version: 1,
};

const mockDocWithNav: DocWithNavigation = {
  doc: mockDocRecord,
  navigation: {
    parent: null,
    siblings: [],
    children: [],
    related: [],
  },
};

describe("DocDetail", () => {
  describe("happy path", () => {
    it("renders document title as h1", () => {
      render(<DocDetail docWithNav={mockDocWithNav} />);
      expect(screen.getByRole("heading", { level: 1, name: "Test PRD" })).toBeInTheDocument();
    });

    it("renders markdown body content", () => {
      render(<DocDetail docWithNav={mockDocWithNav} />);
      // ReactMarkdown renders the content; heading text appears
      expect(screen.getByText("Overview")).toBeInTheDocument();
      expect(screen.getByText("This is a test PRD.")).toBeInTheDocument();
    });

    it("renders type badge", () => {
      render(<DocDetail docWithNav={mockDocWithNav} />);
      expect(screen.getByText("prd")).toBeInTheDocument();
    });

    it("renders status badge", () => {
      render(<DocDetail docWithNav={mockDocWithNav} />);
      expect(screen.getByText("active")).toBeInTheDocument();
    });

    it("renders document ID in metadata table", () => {
      render(<DocDetail docWithNav={mockDocWithNav} />);
      expect(screen.getByText("01HTEST00000000000000000001")).toBeInTheDocument();
    });
  });

  describe("negative", () => {
    it("does not render navigation footer when no parent or children", () => {
      render(<DocDetail docWithNav={mockDocWithNav} />);
      expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
    });
  });

  describe("state", () => {
    it("calls onNavigate with parent ID when parent link is clicked", () => {
      const onNavigate = vi.fn();
      const docWithParent: DocWithNavigation = {
        ...mockDocWithNav,
        navigation: {
          ...mockDocWithNav.navigation,
          parent: {
            id: "parent-001",
            slug: "prd-parent",
            title: "Parent PRD",
            type: "prd",
            status: "active",
            updated_at: "2024-01-01T00:00:00Z",
          },
        },
      };

      render(<DocDetail docWithNav={docWithParent} onNavigate={onNavigate} />);

      fireEvent.click(screen.getByText("Parent PRD"));
      expect(onNavigate).toHaveBeenCalledWith("parent-001");
    });
  });

  describe("regression", () => {
    it("does not render author row when created_by is null", () => {
      render(<DocDetail docWithNav={mockDocWithNav} />);
      expect(screen.queryByText("Author")).not.toBeInTheDocument();
    });

    it("does not render tags row when tags array is empty", () => {
      render(<DocDetail docWithNav={mockDocWithNav} />);
      expect(screen.queryByText("Tags")).not.toBeInTheDocument();
    });

    it("renders tags when present", () => {
      const docWithTags: DocWithNavigation = {
        ...mockDocWithNav,
        doc: { ...mockDocRecord, tags: ["v2", "core"] },
      };
      render(<DocDetail docWithNav={docWithTags} />);
      expect(screen.getByText("v2")).toBeInTheDocument();
      expect(screen.getByText("core")).toBeInTheDocument();
    });
  });
});
