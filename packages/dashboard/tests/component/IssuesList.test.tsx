// @vitest-environment jsdom
/**
 * @spec_ref SPEC-078 T13 dispatch deliverable, AC-078-7/AC-078-8
 *
 * Tests for `IssuesList` (`components/IssuesList.tsx`) — the SPEC-074 issues
 * triage list body. Unlike `ExecutionPage`/`IssueDetail`/`TriageQueue`,
 * `IssuesList` takes NO explicit `project` prop: it reads the shared
 * `useIssueReportsQuery()` hook (`lib/issue-reports-query.ts`), which calls
 * `useProjectParam()` (`project-api.ts`) internally — a route-agnostic hook
 * that resolves the active project straight from the router's live pathname.
 * That means `IssuesList` already resolves the correct project scope under
 * `routes/p.$name.issues.tsx` with ZERO code changes of its own; these tests
 * exist to pin that "already works" claim down as an oracle, the same way
 * `ProjectSwitcher.test.tsx` pins `useProjectParam()`'s pathname parsing.
 * (No prior test file existed for this component before this task.)
 *
 * Test plan (six-dimension coverage, scoped to project threading — row
 * rendering/empty/error states are SPEC-074's own already-covered concern by
 * construction; this file exists to pin the T13 project-scoping claim):
 *   HAPPY — registry-less pathname ("/issues"): `apiGetIssueReports` called
 *     with `null`, cache key carries no project segment.
 *   STATE (project scoping) — `/p/acme/issues` pathname: `apiGetIssueReports`
 *     called with `"acme"`, cache key carries the `project:acme` segment.
 *   REGRESSION — clicking a row still calls `onNavigate` with the report id
 *     regardless of which pathname (registry-less or project-scoped) mounted it.
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockUseRouterState = vi.fn();
vi.mock("@tanstack/react-router", async (importOriginal) => {
  // reason: same seam as `SearchPageBody.test.tsx` — only `useRouterState`
  // (what `useProjectParam()` reads) needs mocking; `IssuesList` itself
  // never calls `createFileRoute`, but its dependency chain
  // (`issue-reports-query.ts` -> `project-api.ts`) imports the real module,
  // so a full replace (rather than `importOriginal` passthrough) would still
  // work here — using the SAME pattern as the other T13 test files for
  // consistency.
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useRouterState: (opts: { select: (state: { location: { pathname: string } }) => string }) =>
      opts.select({ location: { pathname: mockUseRouterState() as string } }),
  };
});

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiGetIssueReports: vi.fn() };
});

import { apiGetIssueReports } from "@/lib/api";
import { IssuesList } from "@/components/IssuesList";

const mockedApiGetIssueReports = vi.mocked(apiGetIssueReports);

function renderList(onNavigate: (id: string) => void = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={client}>
      <IssuesList onNavigate={onNavigate} />
    </QueryClientProvider>,
  );
  return { ...result, client };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedApiGetIssueReports.mockResolvedValue({
    open_count: 1,
    rows: [
      {
        id: "01HISSUE0000000000000000001",
        slug: "task-issue",
        title: "Bug report",
        reporter_project: "acme-agent",
        reporter_actor: "agent:x",
        lore_version: "1.0.0",
        reported_at: "2026-07-01T00:00:00Z",
        possible_duplicates: [],
        status: "in-review",
      },
    ],
  });
});

describe("IssuesList (SPEC-078 T13)", () => {
  describe("happy path — registry-less mode", () => {
    it("calls apiGetIssueReports with null and keys the query without a project segment", async () => {
      mockUseRouterState.mockReturnValue("/issues");
      const { client } = renderList();

      await screen.findByText("Bug report");

      expect(mockedApiGetIssueReports).toHaveBeenCalledWith(null);
      const keys = client.getQueryCache().getAll().map((q) => q.queryKey);
      expect(keys).toContainEqual(["issue-reports"]);
    });
  });

  describe("state — project scoping (AC-078-8)", () => {
    it("calls apiGetIssueReports with the resolved project and keys the query with a project segment", async () => {
      mockUseRouterState.mockReturnValue("/p/acme/issues");
      const { client } = renderList();

      await screen.findByText("Bug report");

      await waitFor(() => expect(mockedApiGetIssueReports).toHaveBeenCalledWith("acme"));
      const keys = client.getQueryCache().getAll().map((q) => q.queryKey);
      expect(keys).toContainEqual(["project:acme", "issue-reports"]);
    });
  });

  describe("regression — row navigation unaffected by project scoping", () => {
    it("calls onNavigate with the report id when a row is clicked under a project-scoped pathname", async () => {
      mockUseRouterState.mockReturnValue("/p/acme/issues");
      const onNavigate = vi.fn();
      const user = userEvent.setup();
      renderList(onNavigate);

      await user.click(await screen.findByTestId("issue-report-row"));

      expect(onNavigate).toHaveBeenCalledWith("01HISSUE0000000000000000001");
    });
  });
});
