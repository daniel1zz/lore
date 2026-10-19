// @vitest-environment jsdom
/**
 * @layer dashboard-component AC-GS-14 (IssueDetail on the live join)
 * @spec_ref spec-github-owns-issue-report-state-no-mirror-task-work-carries T9
 *
 * Tests for `IssueDetail` (`components/IssueDetail.tsx`): one listed GitHub issue, its derived status and
 * the carriers that name it, read from the shared `GET /api/issue-reports` live join.
 *
 *   HAPPY — the matching issue renders its title, derived status badge and carrier links.
 *   STATE (project scoping) — `project="acme"` scopes the fetch, the cache key and the carrier links.
 *   NEGATIVE — an issue number GitHub does not list renders "not found", never a guessed status.
 *   ERROR — a refused listing (401) renders the `gh auth login` hint, not "not found".
 *   BOUNDARY — an issue no work carries says so and renders no carrier link.
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { IssueReportsResponse } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiGetIssueReports: vi.fn() };
});

import { ApiError, apiGetIssueReports } from "@/lib/api";
import { IssueDetail } from "@/components/IssueDetail";

const mockedApiGetIssueReports = vi.mocked(apiGetIssueReports);

const LIVE: IssueReportsResponse = {
  open_count: 1,
  rows: [
    { number: 30, title: "Bug thirty", state: "open", status: "adopted", carrier: "task-fix-30", carriers: ["task-fix-30"] },
    { number: 31, title: "Bug thirty-one", state: "open", status: "open", carrier: null, carriers: [] },
  ],
};

function renderDetail(issueNumber: string, project?: string | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={client}>
      <IssueDetail issueNumber={issueNumber} {...(project === undefined ? {} : { project })} />
    </QueryClientProvider>,
  );
  return { ...result, client };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedApiGetIssueReports.mockResolvedValue(LIVE);
});

describe("IssueDetail (live join, AC-GS-14)", () => {
  it("HAPPY: renders the title, the derived status and the carrier link", async () => {
    const { client } = renderDetail("30");

    expect(await screen.findByText("Bug thirty")).toBeInTheDocument();
    expect(screen.getByTestId("issue-report-resolution")).toHaveTextContent("adopted");
    expect(screen.getByTestId("issue-carrier-link")).toHaveAttribute("href", "/docs/task-fix-30");
    expect(mockedApiGetIssueReports).toHaveBeenCalledWith(null);
    expect(client.getQueryCache().getAll().map((q) => q.queryKey)).toContainEqual(["issue-reports"]);
  });

  it("STATE: a project prop scopes the fetch, the cache key and the carrier link", async () => {
    const { client } = renderDetail("30", "acme");

    await screen.findByText("Bug thirty");
    expect(mockedApiGetIssueReports).toHaveBeenCalledWith("acme");
    expect(client.getQueryCache().getAll().map((q) => q.queryKey)).toContainEqual(["project:acme", "issue-reports"]);
    expect(screen.getByTestId("issue-carrier-link")).toHaveAttribute("href", "/p/acme/docs/task-fix-30");
  });

  it("BOUNDARY: an issue no work carries says so and renders no carrier link", async () => {
    renderDetail("31");

    expect(await screen.findByText("Bug thirty-one")).toBeInTheDocument();
    expect(screen.getByText("No task or plan names this issue.")).toBeInTheDocument();
    expect(screen.queryByTestId("issue-carrier-link")).not.toBeInTheDocument();
  });

  it("NEGATIVE: an issue number GitHub does not list renders not found", async () => {
    renderDetail("999");

    expect(await screen.findByText("Issue not found")).toBeInTheDocument();
    expect(screen.queryByTestId("issue-report-resolution")).not.toBeInTheDocument();
  });

  it("ERROR: a 401 listing renders the gh auth login hint, not 'not found'", async () => {
    mockedApiGetIssueReports.mockRejectedValue(new ApiError(401, "AUTH_REQUIRED", "run gh auth login"));
    renderDetail("30");

    expect(await screen.findByText("gh auth login")).toBeInTheDocument();
    expect(screen.queryByText("Issue not found")).not.toBeInTheDocument();
  });
});
