// @vitest-environment jsdom
/**
 * @spec_ref SPEC-078 T13 dispatch deliverable, AC-078-7/AC-078-8
 *
 * Tests for `IssueDetail` (`components/IssueDetail.tsx`) — the SPEC-074
 * issue-report detail + adjudication body, project-scoped since SPEC-078 T13
 * threads its explicit `project` prop into `apiGetDoc`/the query cache key.
 * (No prior test file existed for this component before this task.)
 *
 * Test plan (six-dimension coverage, scoped to project threading — the
 * approve/reject adjudication flow itself is SPEC-074's own concern and
 * reuses `TriageQueue`'s already-tested write path verbatim):
 *   HAPPY — registry-less mode (`project` omitted, defaults `null`):
 *     `apiGetDoc` is called with `null`, cache key carries no project segment.
 *   STATE (project scoping) — `project="acme"` passed explicitly (the value
 *     `routes/p.$name.issues_.$id.tsx` resolves from `Route.useParams()`):
 *     `apiGetDoc` is called with `"acme"`, cache key carries the
 *     `project:acme` segment, and the visible identity label renders "acme".
 *   REGRESSION — approving invalidates BOTH the doc query key and the shared
 *     issue-reports key, each still scoped to the SAME project the detail
 *     view was rendered with (a project mismatch here would silently leave a
 *     stale badge/list in the other project after an adjudication).
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DocRecord } from "@lore/core";
import type { DocWithNavigation, IssueReportsResponse } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiGetDoc: vi.fn(), apiGetIssueReports: vi.fn() };
});

vi.mock("@/api/mutations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/mutations")>();
  return { ...actual, apiApproveDoc: vi.fn(), apiRejectDoc: vi.fn() };
});

const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...args: unknown[]) => toastSuccess(...args), error: vi.fn() } }));

import { apiGetDoc, apiGetIssueReports } from "@/lib/api";
import { apiApproveDoc } from "@/api/mutations";
import { IssueDetail } from "@/components/IssueDetail";

const mockedApiGetDoc = vi.mocked(apiGetDoc);
const mockedApiGetIssueReports = vi.mocked(apiGetIssueReports);
const mockedApprove = vi.mocked(apiApproveDoc);

/**
 * D8 (spec-issue-closure-loop-computed-resolution-agent-reachable) —
 * `IssueDetail` now ALSO reads the shared issue-reports projection (for
 * `resolution`), so every test in this file needs it mocked, not just the
 * ones that care about the resolution badge. Defaults to an EMPTY
 * projection (no matching row -> no resolution badge rendered) so the
 * pre-existing project-scoping/adjudication tests below are unaffected;
 * tests that DO care override this in their own `beforeEach`/call.
 */
function emptyIssueReports(): IssueReportsResponse {
  return { open_count: 0, rows: [] };
}

function makeIssueDoc(overrides: Partial<DocRecord> = {}): DocWithNavigation {
  const doc: DocRecord = {
    id: "01HISSUE0000000000000000001",
    slug: "task-issue-report",
    title: "Bug: something broke",
    type: "task",
    status: "in-review",
    priority: "medium",
    content: "It broke.",
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    created_by: "reporter",
    parent_id: "01HPARENT000000000000000001",
    tags: [],
    extra: { issue_report: { reported_at: "2026-07-01T00:00:00Z" } },
    version: 1,
    ...overrides,
  };
  return {
    doc,
    navigation: { parent: null, ancestors: [], siblings: [], children: [], related: [] },
  };
}

function renderDetail(project?: string | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={client}>
      <IssueDetail reportId="01HISSUE0000000000000000001" project={project} onAdjudicated={vi.fn()} />
    </QueryClientProvider>,
  );
  return { ...result, client };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedApiGetDoc.mockResolvedValue(makeIssueDoc());
  mockedApiGetIssueReports.mockResolvedValue(emptyIssueReports());
  mockedApprove.mockResolvedValue(undefined as never);
});

describe("IssueDetail (SPEC-078 T13)", () => {
  describe("happy path — registry-less mode", () => {
    it("calls apiGetDoc with null and keys the query without a project segment", async () => {
      const { client } = renderDetail(null);

      await screen.findByText("Bug: something broke");

      expect(mockedApiGetDoc).toHaveBeenCalledWith(null, "01HISSUE0000000000000000001");
      const keys = client.getQueryCache().getAll().map((q) => q.queryKey);
      expect(keys).toContainEqual(["doc", "01HISSUE0000000000000000001"]);
    });
  });

  describe("state — project scoping (AC-078-8)", () => {
    it("calls apiGetDoc with the resolved project and keys the query with a project segment", async () => {
      const { client } = renderDetail("acme");

      await screen.findByText("Bug: something broke");

      expect(mockedApiGetDoc).toHaveBeenCalledWith("acme", "01HISSUE0000000000000000001");
      const keys = client.getQueryCache().getAll().map((q) => q.queryKey);
      expect(keys).toContainEqual(["project:acme", "doc", "01HISSUE0000000000000000001"]);
    });

    it("renders the project identity label", async () => {
      renderDetail("acme");
      await screen.findByText("Bug: something broke");
      expect(screen.getByText(/acme/i)).toBeInTheDocument();
    });
  });

  describe("regression — adjudication invalidates project-scoped keys", () => {
    it("approving calls apiApproveDoc with the same project the detail view was rendered with", async () => {
      const user = userEvent.setup();
      renderDetail("acme");
      await screen.findByText("Bug: something broke");

      await user.click(screen.getByRole("button", { name: "Approve" }));

      await waitFor(() => expect(mockedApprove).toHaveBeenCalledWith("acme", "01HISSUE0000000000000000001"));
      expect(toastSuccess).toHaveBeenCalledWith("Issue report approved");
    });
  });

  describe("D8 resolution rendering (spec-issue-closure-loop-computed-resolution-agent-reachable, AC-ICL-9)", () => {
    it("renders the computed resolution badge matched from the shared issue-reports projection", async () => {
      mockedApiGetIssueReports.mockResolvedValue({
        open_count: 0,
        rows: [
          {
            id: "01HISSUE0000000000000000001",
            slug: "task-issue-report",
            title: "Bug: something broke",
            reporter_project: "acme-agent",
            reporter_actor: "agent:x",
            lore_version: "1.0.0",
            reported_at: "2026-07-01T00:00:00Z",
            possible_duplicates: [],
            status: "draft",
            resolution: "fixed",
          },
        ],
      });

      renderDetail(null);
      await screen.findByText("Bug: something broke");

      const badge = await screen.findByTestId("issue-report-resolution");
      expect(badge).toHaveTextContent("fixed");
    });

    it("NEGATIVE: renders no resolution badge when the report is absent from the shared projection", async () => {
      renderDetail(null); // beforeEach already stubs an EMPTY issue-reports projection
      await screen.findByText("Bug: something broke");

      expect(screen.queryByTestId("issue-report-resolution")).not.toBeInTheDocument();
    });
  });
});
