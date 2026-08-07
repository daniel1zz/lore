// @vitest-environment jsdom
/**
 * @spec_ref SPEC-033 §2.2, AC-33-1
 *
 * Tests for ResolvedPrdBody — renders a document's resolved MDX body: markdown
 * prose interleaved with typed React renderings of each placeholder component.
 *
 * Spec expectations (written from the module's documented invariants, before
 * reading the implementation body):
 *   - Plain markdown with zero placeholders renders as real markdown (e.g. a
 *     `#` heading becomes an <h1>), never as raw text.
 *   - Empty content renders a labeled empty state, not a blank/collapsed div.
 *   - NEVER dangerouslySetInnerHTML / spliced-markdown-as-HTML — placeholder
 *     tag text must never leak into the rendered text content (AC-33-1).
 *   - ChildrenOf (and by the same DocSummaryList machinery, other doc-list
 *     components) renders each child's title as a clickable control plus
 *     type/status badges, and calls onNavigate with the doc's id on click.
 *   - An empty children array renders a labeled "No children yet." empty
 *     state, not a blank box.
 *   - HealthStats renders numeric stat tiles computed from the data payload
 *     (not hardcoded placeholders).
 *   - An unrecognized component name renders a labeled "unsupported
 *     placeholder" notice, never a crash and never the raw tag.
 *   - A resolution warning renders a labeled note using the warning's own
 *     `component` and `message` fields.
 *   - Multiple placeholders in one document render in document order.
 *
 * Test plan (six-dimension coverage):
 *   HAPPY — plain markdown -> heading; ChildrenOf with 3 children renders
 *     titles + badges; HealthStats renders computed numeric tiles.
 *   NEGATIVE — n/a per-component (covered by BOUNDARY empty-state cases below).
 *   BOUNDARY — empty content -> empty state; ChildrenOf with 0 children ->
 *     "No children yet."; unrecognized component name -> unsupported note.
 *   ERROR — n/a (this component receives already-resolved data, no fetch of
 *     its own; a resolution failure surfaces as a `warnings` entry, tested below).
 *   STATE — clicking a child's title calls onNavigate with that doc's id
 *     (not some other doc's id — two children, two distinct assertions).
 *   REGRESSION — AC-33-1: raw placeholder tag text never appears in rendered
 *     output, even when the content string of the fixture Literally contains
 *     the tag; multiple placeholders preserve document order.
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ResolvedPrdBody } from "../../src/components/ResolvedPrdBody";
import type { ResolvedComponent, ResolutionWarning } from "../../src/lib/api";
import type { DocSummary } from "@lore/core";

function makeDoc(overrides: Partial<DocSummary> & { id: string; title: string }): DocSummary {
  return {
    slug: "spec-fixture",
    type: "spec",
    status: "active",
    updated_at: "2026-07-01T00:00:00.000Z",
    tags: [],
    priority: "medium",
    ...overrides,
  };
}

/** Builds a {content, position} pair from concatenated before/tag/after strings, so
 * offsets are always computed from real string lengths rather than hand-counted. */
function buildTaggedContent(before: string, tag: string, after: string) {
  const content = before + tag + after;
  return { content, position: { start: before.length, end: before.length + tag.length } };
}

describe("ResolvedPrdBody", () => {
  describe("happy path: plain markdown, zero placeholders", () => {
    it("renders a level-1 markdown heading as an <h1>, not raw text", () => {
      render(<ResolvedPrdBody content={"# Hello World\n\nA paragraph."} resolvedComponents={[]} warnings={[]} />);
      expect(screen.getByRole("heading", { level: 1, name: "Hello World" })).toBeInTheDocument();
      expect(screen.queryByText("# Hello World")).not.toBeInTheDocument();
    });
  });

  describe("boundary: empty content", () => {
    it('renders "This document has no content yet." instead of a blank div', () => {
      const { container } = render(<ResolvedPrdBody content="" resolvedComponents={[]} warnings={[]} />);
      expect(screen.getByText("This document has no content yet.")).toBeInTheDocument();
      expect(container.textContent?.trim().length).toBeGreaterThan(0);
    });
  });

  describe("happy path + state: ChildrenOf with children", () => {
    it("renders each child's title, type badge, status badge, and fires onNavigate with that doc's id on click", async () => {
      const { userEvent } = await import("@testing-library/user-event");
      const user = userEvent.setup();

      const child1 = makeDoc({ id: "01HCHILD00000000000000001", title: "Child Spec One", type: "spec", status: "active" });
      const child2 = makeDoc({ id: "01HCHILD00000000000000002", title: "Child Task Two", type: "task", status: "draft" });
      const child3 = makeDoc({ id: "01HCHILD00000000000000003", title: "Child ADR Three", type: "adr", status: "approved" });

      const { before, tag, after } = { before: "Intro.\n\n", tag: "<ChildrenOf/>", after: "\n\nOutro." };
      const { content, position } = buildTaggedContent(before, tag, after);
      const component: ResolvedComponent = {
        name: "ChildrenOf",
        props: {},
        data: { children: [child1, child2, child3] },
        position,
      };

      const onNavigate = vi.fn();
      render(
        <ResolvedPrdBody content={content} resolvedComponents={[component]} warnings={[]} onNavigate={onNavigate} />,
      );

      expect(screen.getByText("Child Spec One")).toBeInTheDocument();
      expect(screen.getByText("Child Task Two")).toBeInTheDocument();
      expect(screen.getByText("Child ADR Three")).toBeInTheDocument();
      // type + status badges
      expect(screen.getByText("spec")).toBeInTheDocument();
      expect(screen.getByText("task")).toBeInTheDocument();
      expect(screen.getByText("adr")).toBeInTheDocument();
      expect(screen.getByText("active")).toBeInTheDocument();
      expect(screen.getByText("draft")).toBeInTheDocument();
      expect(screen.getByText("approved")).toBeInTheDocument();

      await user.click(screen.getByText("Child Task Two"));
      expect(onNavigate).toHaveBeenCalledWith("01HCHILD00000000000000002");
      expect(onNavigate).not.toHaveBeenCalledWith("01HCHILD00000000000000001");
    });
  });

  describe("boundary: ChildrenOf with zero children", () => {
    it('renders "No children yet." instead of a blank box', () => {
      const { before, tag, after } = { before: "Intro.\n\n", tag: "<ChildrenOf/>", after: "\n\nOutro." };
      const { content, position } = buildTaggedContent(before, tag, after);
      const component: ResolvedComponent = { name: "ChildrenOf", props: {}, data: { children: [] }, position };

      render(<ResolvedPrdBody content={content} resolvedComponents={[component]} warnings={[]} />);

      expect(screen.getByText("No children yet.")).toBeInTheDocument();
    });
  });

  describe("happy path: HealthStats", () => {
    it("renders computed numeric stat tiles from the data payload (not hardcoded)", () => {
      const { before, tag, after } = { before: "Intro.\n\n", tag: "<HealthStats/>", after: "\n\nOutro." };
      const { content, position } = buildTaggedContent(before, tag, after);
      const component: ResolvedComponent = {
        name: "HealthStats",
        props: {},
        data: {
          stats: {
            total: 42,
            by_type: { prd: 1, spec: 5 }, // 2 distinct type keys -> Types tile == 2
            by_status: { draft: 2, active: 5 },
            stale: 7,
            orphans: 3,
          },
        },
        position,
      };

      render(<ResolvedPrdBody content={content} resolvedComponents={[component]} warnings={[]} />);

      const region = screen.getByRole("region", { name: "Health Stats" });
      // All four expected values (42, 7, 3, 2) are pairwise distinct so each
      // getByText call unambiguously targets one tile.
      expect(within(region).getByText("42")).toBeInTheDocument(); // total
      expect(within(region).getByText("7")).toBeInTheDocument(); // stale
      expect(within(region).getByText("3")).toBeInTheDocument(); // orphans
      expect(within(region).getByText("2")).toBeInTheDocument(); // Object.keys(by_type).length === 2
    });

    it("renders a different set of numbers for a different stats payload (defeats a hardcoded-tile stub)", () => {
      const { before, tag, after } = { before: "Intro.\n\n", tag: "<HealthStats/>", after: "\n\nOutro." };
      const { content, position } = buildTaggedContent(before, tag, after);
      const component: ResolvedComponent = {
        name: "HealthStats",
        props: {},
        data: {
          stats: { total: 100, by_type: { knowledge: 9 }, by_status: {}, stale: 0, orphans: 2 },
        },
        position,
      };

      render(<ResolvedPrdBody content={content} resolvedComponents={[component]} warnings={[]} />);

      const region = screen.getByRole("region", { name: "Health Stats" });
      // total=100, stale=0, orphans=2, Types=1 (single by_type key) — all distinct.
      expect(within(region).getByText("100")).toBeInTheDocument();
      expect(within(region).getByText("0")).toBeInTheDocument(); // stale
      expect(within(region).getByText("2")).toBeInTheDocument(); // orphans
      expect(within(region).getByText("1")).toBeInTheDocument(); // Types count === 1
    });
  });

  describe("boundary: unrecognized component name", () => {
    it('renders a labeled "Unsupported placeholder" note, not a crash and not the raw tag', () => {
      const { before, tag, after } = { before: "Intro.\n\n", tag: "<SomeFutureComponent/>", after: "\n\nOutro." };
      const { content, position } = buildTaggedContent(before, tag, after);
      const component: ResolvedComponent = { name: "SomeFutureComponent", props: {}, data: null, position };

      const { container } = render(<ResolvedPrdBody content={content} resolvedComponents={[component]} warnings={[]} />);

      const note = screen.getByRole("note", { name: "SomeFutureComponent" });
      expect(within(note).getByText(/Unsupported placeholder/)).toBeInTheDocument();
      expect(container.textContent).not.toContain("<SomeFutureComponent");
    });
  });

  describe("happy path: resolution warning", () => {
    it("renders a labeled note using warning.component and warning.message", () => {
      const { before, tag, after } = { before: "Intro.\n\n", tag: "<LegacyEmbed/>", after: "\n\nOutro." };
      const content = before + tag + after;
      const warning: ResolutionWarning = {
        message: "Unknown placeholder component: LegacyEmbed",
        component: "LegacyEmbed",
        position: { start: before.length, end: before.length + tag.length },
      };

      render(<ResolvedPrdBody content={content} resolvedComponents={[]} warnings={[warning]} />);

      const note = screen.getByRole("note", { name: "LegacyEmbed" });
      expect(within(note).getByText(/Unknown placeholder component: LegacyEmbed/)).toBeInTheDocument();
    });
  });

  describe("regression: multiple placeholders render in document order", () => {
    it("renders a ChildrenOf region before a HealthStats region when ChildrenOf appears first in content", () => {
      const seg1 = "Intro.\n\n";
      const tag1 = "<ChildrenOf/>";
      const seg2 = "\n\nMiddle.\n\n";
      const tag2 = "<HealthStats/>";
      const seg3 = "\n\nOutro.";
      const content = seg1 + tag1 + seg2 + tag2 + seg3;

      const childrenComponent: ResolvedComponent = {
        name: "ChildrenOf",
        props: {},
        data: { children: [] },
        position: { start: seg1.length, end: seg1.length + tag1.length },
      };
      const healthStart = seg1.length + tag1.length + seg2.length;
      const healthComponent: ResolvedComponent = {
        name: "HealthStats",
        props: {},
        data: { stats: { total: 1, by_type: {}, by_status: {}, stale: 0, orphans: 0 } },
        position: { start: healthStart, end: healthStart + tag2.length },
      };

      render(
        <ResolvedPrdBody
          content={content}
          resolvedComponents={[healthComponent, childrenComponent]}
          warnings={[]}
        />,
      );

      const regions = screen.getAllByRole("region");
      const names = regions.map((r) => r.getAttribute("aria-label"));
      expect(names.indexOf("Children")).toBeLessThan(names.indexOf("Health Stats"));
    });
  });

  describe("regression: AC-33-1 — zero raw placeholder tags rendered as text", () => {
    it("never shows the literal <ChildrenOf tag text anywhere in rendered output", () => {
      const before = "Some prose before.\n\n";
      const tag = '<ChildrenOf limit="5" />';
      const after = "\n\nSome prose after.";
      const content = before + tag + after;

      const component: ResolvedComponent = {
        name: "ChildrenOf",
        props: { limit: "5" },
        data: { children: [makeDoc({ id: "01HCHILD00000000000000009", title: "Only Child" })] },
        position: { start: before.length, end: before.length + tag.length },
      };

      const { container } = render(<ResolvedPrdBody content={content} resolvedComponents={[component]} warnings={[]} />);

      expect(container.textContent).not.toContain("<ChildrenOf");
      expect(screen.getByText("Only Child")).toBeInTheDocument();
    });
  });
});
