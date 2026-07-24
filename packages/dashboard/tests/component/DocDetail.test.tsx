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
 *     - Renders breadcrumb with Home + current title when doc has no ancestors (AC-36-3)
 *     - Renders full ancestor chain as breadcrumb crumbs (AC-36-3)
 *     - Renders type accent border class on the header (AC-36-9)
 *     - Renders type meta row + notable priority badge under the title (AC-36-9)
 *
 *   NEGATIVE:
 *     - Renders without navigation footer when no parent/children
 *     - Does not render a priority badge for default/low priority (noise budget)
 *
 *   BOUNDARY:
 *     - Breadcrumb collapses ancestors >3 into a single "…" crumb, keeping root + direct parent (AC-36-4)
 *
 *   STATE:
 *     - onNavigate called when parent link is clicked
 *     - onNavigate called when a breadcrumb ancestor crumb is clicked
 *     - onNavigateHome called when the Home crumb is clicked
 *
 *   REGRESSION:
 *     - Tag chips hidden under the title when doc.tags is empty
 *     - Author row hidden when created_by is null
 *     - Full tag list renders under the title when tags are present
 *
 *   SPEC-037 additions:
 *     - plan with zero task children keeps the flat children list (no Execution header)
 *     - plan with >=1 task child renders the Execution section instead
 *     - task with a claim/evidence renders the Execution section above the footer
 *     - task with no claim/evidence renders no Execution section
 *     - header meta badge is destructive when a task has evidence_fail > 0 (AC-37-6)
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DocDetail } from "../../src/components/DocDetail";
import type { DocWithNavigation } from "../../src/lib/api";
import type { DocRecord, DocSummary } from "@lore/core";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/api")>();
  return { ...actual, apiGetReady: vi.fn(), apiGetEvidencePanel: vi.fn() };
});

import { apiGetReady, apiGetEvidencePanel } from "@/lib/api";
const mockedApiGetReady = vi.mocked(apiGetReady);
const mockedApiGetEvidencePanel = vi.mocked(apiGetEvidencePanel);

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const mockDocRecord: DocRecord = {
  id: "01HTEST00000000000000000001",
  slug: "prd-test",
  title: "Test PRD",
  type: "prd",
  status: "active",
  priority: "medium",
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
    ancestors: [],
    siblings: [],
    children: [],
    related: [],
  },
};

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

    it("renders markdown headings, lists, and GFM tables as real elements inside the prose container", () => {
      // Pins the ReactMarkdown + remark-gfm pipeline and the @tailwindcss/typography
      // wiring (SPEC-031 AC-5/AC-6): jsdom can't assert computed CSS from the plugin,
      // so this asserts the structural contract (actual <h1>/<h2>/<table> elements)
      // plus presence of the `.prose` class that the plugin's styles target.
      const docWithRichMarkdown: DocWithNavigation = {
        ...mockDocWithNav,
        doc: {
          ...mockDocRecord,
          content:
            "# Heading\n\n## Sub\n\n- item one\n- item two\n\n" +
            "| Col A | Col B |\n| --- | --- |\n| a1 | b1 |\n",
        },
      };

      const { container } = render(<DocDetail docWithNav={docWithRichMarkdown} />);

      const proseContainer = container.querySelector(".prose");
      expect(proseContainer).not.toBeNull();
      expect(proseContainer).toHaveClass("prose", "prose-sm", "dark:prose-invert");

      const h1 = proseContainer!.querySelector("h1");
      const h2 = proseContainer!.querySelector("h2");
      const table = proseContainer!.querySelector("table");
      const list = proseContainer!.querySelector("ul");

      expect(h1).not.toBeNull();
      expect(h1).toHaveTextContent("Heading");
      expect(h2).not.toBeNull();
      expect(h2).toHaveTextContent("Sub");
      expect(table).not.toBeNull();
      expect(table!.querySelectorAll("th")).toHaveLength(2);
      expect(table!.querySelectorAll("td")).toHaveLength(2);
      expect(list).not.toBeNull();
      expect(list!.querySelectorAll("li")).toHaveLength(2);
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

    it("does not render a priority badge for default priority (noise budget)", () => {
      render(<DocDetail docWithNav={mockDocWithNav} />);
      expect(screen.queryByText("medium")).not.toBeInTheDocument();
    });
  });

  describe("state", () => {
    it("calls onNavigate with parent ID when parent link is clicked", () => {
      const onNavigate = vi.fn();
      const docWithParent: DocWithNavigation = {
        ...mockDocWithNav,
        navigation: {
          ...mockDocWithNav.navigation,
          parent: makeAncestor("parent-001", "Parent PRD"),
        },
      };

      render(<DocDetail docWithNav={docWithParent} onNavigate={onNavigate} />);

      fireEvent.click(screen.getByText("Parent PRD"));
      expect(onNavigate).toHaveBeenCalledWith("parent-001");
    });

    it("calls onNavigate when a breadcrumb ancestor crumb is clicked", () => {
      const onNavigate = vi.fn();
      const docWithAncestors: DocWithNavigation = {
        ...mockDocWithNav,
        navigation: {
          ...mockDocWithNav.navigation,
          ancestors: [makeAncestor("root-001", "Root PRD")],
        },
      };

      render(<DocDetail docWithNav={docWithAncestors} onNavigate={onNavigate} />);

      fireEvent.click(screen.getByText("Root PRD"));
      expect(onNavigate).toHaveBeenCalledWith("root-001");
    });

    it("calls onNavigateHome when the breadcrumb Home crumb is clicked", () => {
      const onNavigateHome = vi.fn();
      render(<DocDetail docWithNav={mockDocWithNav} onNavigateHome={onNavigateHome} />);

      fireEvent.click(screen.getByRole("button", { name: "Home" }));
      expect(onNavigateHome).toHaveBeenCalledTimes(1);
    });
  });

  describe("boundary", () => {
    it("collapses breadcrumb ancestors >3 into a single ellipsis crumb (AC-36-4)", () => {
      const ancestors = [
        makeAncestor("a1", "Root"),
        makeAncestor("a2", "Mid One"),
        makeAncestor("a3", "Mid Two"),
        makeAncestor("a4", "Direct Parent"),
      ];
      const docWithManyAncestors: DocWithNavigation = {
        ...mockDocWithNav,
        navigation: { ...mockDocWithNav.navigation, ancestors },
      };

      render(<DocDetail docWithNav={docWithManyAncestors} />);

      expect(screen.getByText("Root")).toBeInTheDocument();
      expect(screen.getByText("Direct Parent")).toBeInTheDocument();
      expect(screen.getByText("…")).toBeInTheDocument();
      expect(screen.queryByText("Mid One")).not.toBeInTheDocument();
      expect(screen.queryByText("Mid Two")).not.toBeInTheDocument();
    });
  });

  describe("breadcrumb", () => {
    it("renders Home and the current title with aria-current when there are no ancestors (AC-36-3)", () => {
      render(<DocDetail docWithNav={mockDocWithNav} />);
      const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
      expect(nav).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Home" })).toBeInTheDocument();
      const current = screen.getByText("Test PRD", { selector: '[aria-current="page"]' });
      expect(current).toBeInTheDocument();
    });

    it("renders every ancestor as a crumb when there are 3 or fewer (no collapsing)", () => {
      const ancestors = [makeAncestor("a1", "Root"), makeAncestor("a2", "Direct Parent")];
      const docWithAncestors: DocWithNavigation = {
        ...mockDocWithNav,
        navigation: { ...mockDocWithNav.navigation, ancestors },
      };
      render(<DocDetail docWithNav={docWithAncestors} />);
      expect(screen.getByText("Root")).toBeInTheDocument();
      expect(screen.getByText("Direct Parent")).toBeInTheDocument();
      expect(screen.queryByText("…")).not.toBeInTheDocument();
    });
  });

  describe("type accent + meta (AC-36-9)", () => {
    it("applies the type accent border class to the header", () => {
      const { container } = render(<DocDetail docWithNav={mockDocWithNav} />);
      const header = container.querySelector("header");
      expect(header).not.toBeNull();
      expect(header).toHaveClass("border-l-4", "border-l-violet-600");
    });

    it("renders a spec kind meta badge for a spec doc", () => {
      const specDoc: DocWithNavigation = {
        ...mockDocWithNav,
        doc: { ...mockDocRecord, type: "spec", extra: { spec_kind: "tech" } },
      };
      render(<DocDetail docWithNav={specDoc} />);
      expect(screen.getByText("tech")).toBeInTheDocument();
    });

    it("renders a priority badge for critical/high priority", () => {
      const criticalDoc: DocWithNavigation = {
        ...mockDocWithNav,
        doc: { ...mockDocRecord, priority: "critical" },
      };
      render(<DocDetail docWithNav={criticalDoc} />);
      expect(screen.getByText("critical")).toBeInTheDocument();
    });
  });

  describe("regression", () => {
    it("does not render author row when created_by is null", () => {
      render(<DocDetail docWithNav={mockDocWithNav} />);
      expect(screen.queryByText("Author")).not.toBeInTheDocument();
    });

    it("does not render any tag chips under the title when tags array is empty", () => {
      const { container } = render(<DocDetail docWithNav={mockDocWithNav} />);
      expect(container.querySelector('[aria-label="Tags"]')).not.toBeInTheDocument();
    });

    it("renders the full tag list under the title when tags are present", () => {
      const docWithTags: DocWithNavigation = {
        ...mockDocWithNav,
        doc: { ...mockDocRecord, tags: ["v2", "core"] },
      };
      render(<DocDetail docWithNav={docWithTags} />);
      expect(screen.getByText("v2")).toBeInTheDocument();
      expect(screen.getByText("core")).toBeInTheDocument();
    });
  });

  describe("SPEC-037 D2: plan Execution section", () => {
    function makeChildSummary(overrides: Partial<DocSummary> & { id: string; title: string }): DocSummary {
      return {
        slug: `doc-${overrides.id}`,
        type: "task",
        status: "draft",
        updated_at: "2024-01-01T00:00:00Z",
        tags: [],
        priority: "medium",
        ...overrides,
      };
    }

    it("keeps the flat children list when a plan has zero task children", () => {
      const knowledgeChild = makeChildSummary({ id: "k1", title: "Knowledge Child", type: "knowledge" });
      const planDoc: DocWithNavigation = {
        doc: { ...mockDocRecord, type: "plan" },
        navigation: { ...mockDocWithNav.navigation, children: [knowledgeChild] },
      };

      render(<DocDetail docWithNav={planDoc} />);

      expect(screen.getByText("Children")).toBeInTheDocument();
      expect(screen.getByText("Knowledge Child")).toBeInTheDocument();
      expect(screen.queryByText("Execution")).not.toBeInTheDocument();
    });

    it("renders the Execution section instead of the flat list when the plan has >=1 task child", async () => {
      const taskChild = makeChildSummary({ id: "t1", title: "Task Child" });
      const planDoc: DocWithNavigation = {
        doc: { ...mockDocRecord, id: "01HPLANEXEC000000000000001", type: "plan" },
        navigation: { ...mockDocWithNav.navigation, children: [taskChild] },
      };
      mockedApiGetReady.mockResolvedValue({ ok: true, value: [] });

      renderWithClient(<DocDetail docWithNav={planDoc} />);

      expect(await screen.findByText("Execution")).toBeInTheDocument();
      expect(screen.getByText("Task Child")).toBeInTheDocument();
      expect(screen.queryByText("Children")).not.toBeInTheDocument();
    });
  });

  describe("SPEC-037 D3: task Execution section", () => {
    it("renders the Execution section above the footer when the task has a claim", () => {
      const taskDoc: DocWithNavigation = {
        doc: {
          ...mockDocRecord,
          type: "task",
          extra: { claim: { by: "alice", at: "2026-01-01T00:00:00.000Z" } },
        },
        navigation: mockDocWithNav.navigation,
      };

      render(<DocDetail docWithNav={taskDoc} />);

      expect(screen.getByLabelText("Execution")).toBeInTheDocument();
      expect(screen.getByText("alice")).toBeInTheDocument();
    });

    it("renders no Execution section for a task with neither claim nor evidence", () => {
      const taskDoc: DocWithNavigation = {
        doc: { ...mockDocRecord, type: "task" },
        navigation: mockDocWithNav.navigation,
      };

      render(<DocDetail docWithNav={taskDoc} />);

      expect(screen.queryByLabelText("Execution")).not.toBeInTheDocument();
    });
  });

  describe("SPEC-037 AC-37-6: header meta badge danger color", () => {
    it("renders the destructive badge variant when a task has evidence_fail > 0", () => {
      const taskDoc: DocWithNavigation = {
        doc: {
          ...mockDocRecord,
          type: "task",
          extra: {
            verification_evidence: [
              { oracle: "tsc", command: "x", result: "fail", recorded_at: "2026-01-01T00:00:00.000Z", recorded_by: "alice" },
            ],
          },
        },
        navigation: mockDocWithNav.navigation,
      };

      render(<DocDetail docWithNav={taskDoc} />);

      const badge = screen.getByText("✔0/✘1");
      expect(badge).toHaveClass("text-destructive-foreground");
    });

    it("does not render the destructive variant when evidence_fail === 0", () => {
      const taskDoc: DocWithNavigation = {
        doc: {
          ...mockDocRecord,
          type: "task",
          extra: {
            verification_evidence: [
              { oracle: "tsc", command: "x", result: "pass", recorded_at: "2026-01-01T00:00:00.000Z", recorded_by: "alice" },
            ],
          },
        },
        navigation: mockDocWithNav.navigation,
      };

      render(<DocDetail docWithNav={taskDoc} />);

      const badge = screen.getByText("✔1/✘0");
      expect(badge).not.toHaveClass("text-destructive-foreground");
    });
  });

  describe("SPEC-075: Evidence tab visibility + AdjudicationBar same-screen mount (R-8)", () => {
    it("shows the Evidence tab button for a task doc", () => {
      const taskDoc: DocWithNavigation = { doc: { ...mockDocRecord, type: "task" }, navigation: mockDocWithNav.navigation };
      render(<DocDetail docWithNav={taskDoc} />);
      expect(screen.getByRole("button", { name: "evidence" })).toBeInTheDocument();
    });

    it("hides the Evidence tab button entirely for a prd doc (doc_type: other)", () => {
      render(<DocDetail docWithNav={mockDocWithNav} />);
      expect(screen.queryByRole("button", { name: "evidence" })).not.toBeInTheDocument();
    });

    it("mounts AdjudicationBar in the header, same screen as StatusPill, for an in-review doc", async () => {
      mockedApiGetEvidencePanel.mockResolvedValue({ doc_type: "task", evidence: [], ac_refs: [] });
      const taskDoc: DocWithNavigation = {
        doc: { ...mockDocRecord, type: "task", status: "in-review" },
        navigation: mockDocWithNav.navigation,
      };

      renderWithClient(<DocDetail docWithNav={taskDoc} />);

      // Same header region: the AdjudicationBar's evidence-summary chips and the
      // StatusPill badge both resolve without any tab click / extra navigation.
      expect(await screen.findByLabelText("Evidence summary")).toBeInTheDocument();
      expect(screen.getByText("in-review")).toBeInTheDocument();
    });

    it("does not mount AdjudicationBar for a non-in-review doc", () => {
      const taskDoc: DocWithNavigation = { doc: { ...mockDocRecord, type: "task", status: "draft" }, navigation: mockDocWithNav.navigation };
      renderWithClient(<DocDetail docWithNav={taskDoc} />);
      expect(screen.queryByLabelText("Evidence summary")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Adjudication")).not.toBeInTheDocument();
    });
  });
});
