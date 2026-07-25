// @vitest-environment jsdom
/**
 * @spec_ref SPEC-078 T13 dispatch deliverable, AC-078-7/AC-078-8
 *
 * Tests for `SearchPageBody` (`routes/search.tsx`) — the route-agnostic
 * search-results body reused verbatim by `routes/p.$name.search.tsx`.
 *
 * Test plan (six-dimension coverage, scoped to the T13 project-scoping split
 * — SearchBar/SearchResultCard's own rendering behavior is already covered by
 * their dedicated component test files):
 *   HAPPY — registry-less mode (`useProjectParam()` resolves `null` for a
 *     bare "/search" pathname): `apiSearch` is called with `null`, and the
 *     TanStack Query cache key carries no project-scope segment (byte-stable
 *     pre-T13 shape).
 *   STATE (project scoping) — mounted under a `/p/:name/search` pathname:
 *     `apiSearch` is called with the resolved project name, and the cache key
 *     carries the `project:<name>` segment (AC-078-8's per-route assertion).
 *   REGRESSION — switching the mocked pathname from one project to another
 *     re-keys the query into a genuinely distinct cache entry (mirrors
 *     `ActivePlansPanel.test.tsx`'s "project re-key on switch" regression).
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockUseRouterState = vi.fn();
vi.mock("@tanstack/react-router", async (importOriginal) => {
  // reason: `SearchPageBody` is exported from `routes/search.tsx`, which also
  // calls the REAL `createFileRoute` at module scope (defining `Route`) — a
  // full mock (as `ProjectSwitcher.test.tsx` uses, since that component never
  // calls `createFileRoute` itself) would leave that call undefined and throw
  // at import time. Only `useRouterState` (the seam `useProjectParam()`
  // reads) needs mocking; every other export passes through untouched.
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
    apiSearch: vi.fn(),
  };
});

import { apiSearch } from "@/lib/api";
import { SearchPageBody } from "@/routes/search";

const mockedApiSearch = vi.mocked(apiSearch);

function renderBody(q: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={client}>
      <SearchPageBody q={q} onSearch={vi.fn()} onOpenDoc={vi.fn()} />
    </QueryClientProvider>,
  );
  return { ...result, client };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedApiSearch.mockResolvedValue({ results: [] });
});

describe("SearchPageBody (SPEC-078 T13)", () => {
  describe("happy path — registry-less mode", () => {
    it("calls apiSearch with null and keys the query without a project segment", async () => {
      mockUseRouterState.mockReturnValue("/search");
      const { client } = renderBody("widgets");

      await waitFor(() => expect(mockedApiSearch).toHaveBeenCalledWith(null, "widgets"));

      const keys = client.getQueryCache().getAll().map((q) => q.queryKey);
      expect(keys).toContainEqual(["search", "widgets"]);
    });
  });

  describe("state — project scoping (AC-078-8)", () => {
    it("calls apiSearch with the resolved project and keys the query with a project segment", async () => {
      mockUseRouterState.mockReturnValue("/p/acme/search");
      const { client } = renderBody("widgets");

      await waitFor(() => expect(mockedApiSearch).toHaveBeenCalledWith("acme", "widgets"));

      const keys = client.getQueryCache().getAll().map((q) => q.queryKey);
      expect(keys).toContainEqual(["project:acme", "search", "widgets"]);
    });

    it("renders results for the scoped project", async () => {
      mockUseRouterState.mockReturnValue("/p/acme/search");
      mockedApiSearch.mockResolvedValue({
        results: [
          {
            id: "doc-1",
            slug: "doc-1",
            type: "knowledge",
            status: "approved",
            title: "Acme doc",
            snippet: "…",
            score: 1,
            created_at: "2026-07-01T00:00:00.000Z",
          },
        ],
      });
      renderBody("widgets");
      expect(await screen.findByText("Acme doc")).toBeInTheDocument();
    });
  });

  describe("regression — project re-key on switch", () => {
    it("switching from project A to project B re-keys into a genuinely distinct cache entry", async () => {
      mockUseRouterState.mockReturnValue("/p/project-a/search");
      const { client, rerender } = renderBody("widgets");
      await waitFor(() => expect(mockedApiSearch).toHaveBeenCalledWith("project-a", "widgets"));

      mockUseRouterState.mockReturnValue("/p/project-b/search");
      rerender(
        <QueryClientProvider client={client}>
          <SearchPageBody q="widgets" onSearch={vi.fn()} onOpenDoc={vi.fn()} />
        </QueryClientProvider>,
      );
      await waitFor(() => expect(mockedApiSearch).toHaveBeenCalledWith("project-b", "widgets"));

      const keys = client.getQueryCache().getAll().map((q) => q.queryKey);
      expect(keys).toContainEqual(["project:project-a", "search", "widgets"]);
      expect(keys).toContainEqual(["project:project-b", "search", "widgets"]);
    });
  });
});
