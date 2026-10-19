// @vitest-environment jsdom
/**
 * @layer dashboard-component AC-GS-14 (IssuesList on the live join)
 * @spec_ref spec-github-owns-issue-report-state-no-mirror-task-work-carries T9; SPEC-078 AC-078-7/AC-078-8
 *
 * Tests for `IssuesList` (`components/IssuesList.tsx`), which reads the shared `useIssueReportsQuery()` hook
 * (project resolved from the router pathname) and renders one row per GitHub-listed issue.
 *
 *   HAPPY — registry-less pathname: `apiGetIssueReports(null)`, key without a project segment.
 *   STATE (project scoping) — `/p/acme/issues`: `apiGetIssueReports("acme")`, key with `project:acme`.
 *   REGRESSION — clicking a row calls `onNavigate` with the issue NUMBER as a string.
 *   STATE — the badge shows the row's derived status, including an anomaly status.
 *   ERROR — a 401 renders the `gh auth login` hint and NO list items (AC-GS-14); 429 / 503 / other
 *     failures render an error, never the empty-list text.
 *   BOUNDARY — an empty listing renders the labeled empty state.
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockUseRouterState = vi.fn();
vi.mock("@tanstack/react-router", async (importOriginal) => {
  // reason: only `useRouterState` (what `useProjectParam()` reads) needs mocking.
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

import { ApiError, apiGetIssueReports } from "@/lib/api";
import { IssuesList } from "@/components/IssuesList";

const mockedApiGetIssueReports = vi.mocked(apiGetIssueReports);

const SPEC = "spec-github-owns-issue-report-state-no-mirror-task-work-carries";

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
    rows: [{ number: 12, title: "Bug report", state: "open", status: "open", carrier: null, carriers: [] }],
  });
});

describe("IssuesList (live join)", () => {
  it("HAPPY: calls apiGetIssueReports with null and keys the query without a project segment", async () => {
    mockUseRouterState.mockReturnValue("/issues");
    const { client } = renderList();

    await screen.findByText("Bug report");

    expect(mockedApiGetIssueReports).toHaveBeenCalledWith(null);
    expect(client.getQueryCache().getAll().map((q) => q.queryKey)).toContainEqual(["issue-reports"]);
  });

  it("STATE: a project-scoped pathname scopes the fetch and the cache key", async () => {
    mockUseRouterState.mockReturnValue("/p/acme/issues");
    const { client } = renderList();

    await screen.findByText("Bug report");

    await waitFor(() => expect(mockedApiGetIssueReports).toHaveBeenCalledWith("acme"));
    expect(client.getQueryCache().getAll().map((q) => q.queryKey)).toContainEqual(["project:acme", "issue-reports"]);
  });

  it("REGRESSION: clicking a row calls onNavigate with the issue number as a string", async () => {
    mockUseRouterState.mockReturnValue("/p/acme/issues");
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    renderList(onNavigate);

    await user.click(await screen.findByTestId("issue-report-row"));

    expect(onNavigate).toHaveBeenCalledWith("12");
  });

  it("STATE: the badge shows the derived status, including an anomaly status", async () => {
    mockedApiGetIssueReports.mockResolvedValue({
      open_count: 0,
      rows: [
        { number: 3, title: "Pending close", state: "open", status: "fixed (close pending)", carrier: "task-x", carriers: ["task-x"] },
      ],
    });
    mockUseRouterState.mockReturnValue("/issues");
    renderList();

    expect(await screen.findByTestId("issue-report-resolution")).toHaveTextContent("fixed (close pending)");
    expect(screen.getByText("carried by task-x")).toBeInTheDocument();
  });

  it("BOUNDARY: an empty listing renders the labeled empty state", async () => {
    mockedApiGetIssueReports.mockResolvedValue({ open_count: 0, rows: [] });
    mockUseRouterState.mockReturnValue("/issues");
    renderList();

    expect(await screen.findByText("GitHub lists no issues.")).toBeInTheDocument();
  });

  it(`${SPEC}#AC-GS-14 ERROR: a 401 renders the gh auth login hint and no list items`, async () => {
    mockedApiGetIssueReports.mockRejectedValue(new ApiError(401, "AUTH_REQUIRED", "run gh auth login"));
    mockUseRouterState.mockReturnValue("/issues");
    renderList();

    const state = await screen.findByTestId("issues-auth-required");
    expect(state).toHaveTextContent("gh auth login");
    expect(screen.queryAllByTestId("issue-report-row")).toHaveLength(0);
    expect(screen.queryByText("GitHub lists no issues.")).not.toBeInTheDocument();
  });

  it("ERROR: 429 and 503 render an error, never the empty-list text", async () => {
    mockUseRouterState.mockReturnValue("/issues");
    for (const [status, code, fragment] of [
      [429, "RATE_LIMITED", "rate limit"],
      [503, "TRANSPORT_UNAVAILABLE", "could not be reached"],
    ] as const) {
      mockedApiGetIssueReports.mockRejectedValue(new ApiError(status, code, "gh failed"));
      const { unmount } = renderList();
      expect(await screen.findByRole("alert")).toHaveTextContent(fragment);
      expect(screen.queryAllByTestId("issue-report-row")).toHaveLength(0);
      expect(screen.queryByText("GitHub lists no issues.")).not.toBeInTheDocument();
      unmount();
    }
  });
});
