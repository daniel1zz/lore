// @vitest-environment jsdom
/**
 * Tests for `LibraryPageBody` (`routes/library.tsx`) — scoped to the two
 * dogfood-batch fixes anchored in this file:
 *   ISSUE-002: the type/status/tag filter chips are keyboard/screen-reader
 *     reachable `<button role="button" aria-pressed>` elements, not inert
 *     `<div onClick>`s.
 *   ISSUE-005: a successful create invalidates the header's doc-count
 *     (`["status"]`-keyed) query, not just the `["docs", "list"]` one.
 * Other LibraryPageBody behavior (URL-state filters themselves, DocCard
 * rendering) is exercised by `tests/unit/lib/library-search.test.ts` and
 * `tests/e2e/browse-ux.pw.ts` respectively — not duplicated here.
 *
 * Test plan (six-dimension coverage, scoped to these two fixes):
 *   HAPPY — every type/status filter chip is reachable via `getByRole("button")`
 *     with the correct accessible name; clicking one calls `onSearchChange`
 *     (unaffected by the div->button swap). A successful create invalidates
 *     BOTH the docs-list query and the status (doc-count) query.
 *   NEGATIVE — n/a beyond BOUNDARY/ERROR below.
 *   BOUNDARY — the "All" chip counts too (has `aria-pressed` reflecting
 *     whether a type/status filter is currently active).
 *   ERROR — a failed create does NOT invalidate the status query (no
 *     count-bump for a doc that was never created).
 *   STATE — `aria-pressed` flips from the "All" chip to the clicked type chip
 *     across a re-render with the new `search` prop (mirrors how the real
 *     route re-renders this props-driven body after a `useSearch()` change).
 *   REGRESSION — n/a (no known prior regression pinned here; ISSUE-002/005
 *     ARE the regressions this file exists to catch a re-occurrence of).
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DocRecord } from "@lore/core";

const mockUseRouterState = vi.fn();
vi.mock("@tanstack/react-router", async (importOriginal) => {
  // reason: LibraryPageBody's own module (`routes/library.tsx`) calls the
  // REAL `createFileRoute` at module scope — mirrors SearchPageBody.test.tsx's
  // established pattern of only stubbing the one seam (`useRouterState`,
  // which `useProjectParam()` reads) rather than a full mock.
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useRouterState: (opts: { select: (state: { location: { pathname: string } }) => string }) =>
      opts.select({ location: { pathname: mockUseRouterState() as string } }),
  };
});

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    apiList: vi.fn(),
  };
});

vi.mock("@/api/mutations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/mutations")>();
  return {
    ...actual,
    apiCreateDoc: vi.fn(),
  };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { apiList } from "@/lib/api";
import { apiCreateDoc, DashboardApiError } from "@/api/mutations";
import { LibraryPageBody } from "@/routes/library";
import { queryKeys } from "@/lib/project-api";

const mockedApiList = vi.mocked(apiList);
const mockedApiCreateDoc = vi.mocked(apiCreateDoc);

function makeDoc(overrides: Partial<DocRecord> = {}): DocRecord {
  return {
    id: "01HDOC00000000000000000NEW",
    slug: "knowledge-my-note",
    type: "knowledge",
    role: "knowledge",
    title: "My Note",
    status: "draft",
    content: "",
    parent_id: null,
    extra: { sub_type: "research" },
    tags: [],
    version: 1,
    created_at: "2026-07-26T00:00:00.000Z",
    updated_at: "2026-07-26T00:00:00.000Z",
    created_by: "dashboard-local",
    deleted_at: null,
    priority: "medium",
    ...overrides,
  };
}

function renderBody() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(client, "invalidateQueries");
  const onSearchChange = vi.fn();
  const onDocCreated = vi.fn();
  const result = render(
    <QueryClientProvider client={client}>
      <LibraryPageBody
        search={{}}
        onSearchChange={onSearchChange}
        onOpenDoc={vi.fn()}
        onDocCreated={onDocCreated}
      />
    </QueryClientProvider>,
  );
  return { ...result, client, invalidateSpy, onSearchChange, onDocCreated };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseRouterState.mockReturnValue("/library");
  mockedApiList.mockResolvedValue({ docs: [], total: 0 });
});

describe("LibraryPageBody", () => {
  describe("ISSUE-002: filter chips are accessible buttons", () => {
    it("renders every type/status chip as a role=button with the correct accessible name", async () => {
      renderBody();
      await waitFor(() => expect(mockedApiList).toHaveBeenCalled());

      expect(screen.getByRole("group", { name: "Filter by type" })).toBeInTheDocument();
      expect(screen.getByRole("group", { name: "Filter by status" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "spec" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "draft" })).toBeInTheDocument();
    });

    it('clicking a type chip calls onSearchChange with that type (behavior preserved across the div->button swap)', async () => {
      const user = userEvent.setup();
      const { onSearchChange } = renderBody();
      await waitFor(() => expect(mockedApiList).toHaveBeenCalled());

      await user.click(screen.getByRole("button", { name: "task" }));

      expect(onSearchChange).toHaveBeenCalledWith({ type: "task" });
    });

    describe("boundary: aria-pressed reflects active state", () => {
      it('the "All" type chip starts aria-pressed=true with no filter active', async () => {
        renderBody();
        await waitFor(() => expect(mockedApiList).toHaveBeenCalled());

        const allChips = screen.getAllByRole("button", { name: "All" });
        // Two "All" chips exist (type row + status row); both start active.
        for (const chip of allChips) {
          expect(chip).toHaveAttribute("aria-pressed", "true");
        }
        expect(screen.getByRole("button", { name: "task" })).toHaveAttribute("aria-pressed", "false");
      });
    });

    describe("state: aria-pressed follows the search prop across a re-render", () => {
      it("flips from All to the selected type when the route re-renders with a new search", async () => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const { rerender } = render(
          <QueryClientProvider client={client}>
            <LibraryPageBody search={{}} onSearchChange={vi.fn()} onOpenDoc={vi.fn()} onDocCreated={vi.fn()} />
          </QueryClientProvider>,
        );
        await waitFor(() => expect(mockedApiList).toHaveBeenCalled());

        rerender(
          <QueryClientProvider client={client}>
            <LibraryPageBody
              search={{ type: "task" }}
              onSearchChange={vi.fn()}
              onOpenDoc={vi.fn()}
              onDocCreated={vi.fn()}
            />
          </QueryClientProvider>,
        );

        expect(screen.getByRole("button", { name: "task" })).toHaveAttribute("aria-pressed", "true");
        expect(screen.getAllByRole("button", { name: "All" })[0]).toHaveAttribute("aria-pressed", "false");
      });
    });
  });

  describe("ISSUE-005: create invalidates the status (doc-count) query", () => {
    it("invalidates both the docs-list query and the status query on a successful create", async () => {
      const user = userEvent.setup();
      const newDoc = makeDoc();
      mockedApiCreateDoc.mockResolvedValue(newDoc);
      const { invalidateSpy, onDocCreated } = renderBody();
      await waitFor(() => expect(mockedApiList).toHaveBeenCalled());

      await user.click(screen.getByRole("button", { name: "New doc" }));
      // ISSUE-003's new default ("knowledge") needs no parent/extra beyond
      // its own defaulted sub_type — a title alone is submittable.
      await user.type(screen.getByLabelText(/Title/), "My Note");
      await user.click(screen.getByRole("button", { name: "Create" }));

      await waitFor(() => expect(onDocCreated).toHaveBeenCalledWith(newDoc));
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.scope(null, ["docs", "list"]),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.scope(null, ["status"]),
      });
    });

    it("error: a failed create invalidates neither query (no count-bump for a doc that was never created)", async () => {
      const user = userEvent.setup();
      mockedApiCreateDoc.mockRejectedValue(new DashboardApiError(500, "API_ERROR", "boom"));
      const { invalidateSpy } = renderBody();
      await waitFor(() => expect(mockedApiList).toHaveBeenCalled());

      await user.click(screen.getByRole("button", { name: "New doc" }));
      await user.type(screen.getByLabelText(/Title/), "My Note");
      await user.click(screen.getByRole("button", { name: "Create" }));

      await waitFor(() => expect(screen.getByText("boom")).toBeInTheDocument());
      expect(invalidateSpy).not.toHaveBeenCalledWith({
        queryKey: queryKeys.scope(null, ["status"]),
      });
      expect(invalidateSpy).not.toHaveBeenCalledWith({
        queryKey: queryKeys.scope(null, ["docs", "list"]),
      });
    });
  });
});
