// @vitest-environment jsdom
/**
 * @spec_ref SPEC-033 §2.2; SPEC-037 §1 D1, AC-37-2
 *
 * Tests for ActivePlansPanel — home-page side panel listing active plans,
 * each row now showing computed readiness ("N ready / M tasks") fetched from
 * `apiGetReady` (SPEC-037 D1 — this panel previously stood in for that data
 * with a "not ready-aware" placeholder badge, now removed).
 *
 * Spec expectations (written from the module's documented invariants, before
 * reading the implementation body):
 *   - Fetches via `apiList({ type: "plan", status: "active" })` — the filter
 *     must be exactly this shape, not e.g. all plans or all active docs.
 *   - Shows at most ACTIVE_PLANS_LIMIT (documented as 8) plans, server order.
 *   - Loading, empty-list, and fetch-error states each render a distinct
 *     labeled state — never a blank panel.
 *   - Clicking a listed plan's title calls onNavigate with that plan's id.
 *   - Each plan row fetches its own readiness (`apiGetReady`) and renders
 *     "N ready / M tasks"; a plan with zero tasks renders "no tasks"; a
 *     failed readiness fetch renders a degraded note WITHOUT blanking the row
 *     or the panel.
 *
 * Test plan (six-dimension coverage):
 *   HAPPY — two active plans with different titles both render; a plan with
 *     readiness data renders "N ready / M tasks".
 *   NEGATIVE — n/a beyond BOUNDARY/ERROR cases below.
 *   BOUNDARY — empty list renders "No active plans."; a list of 10 plans
 *     still renders only 8 rows (panel cap); a plan with zero tasks renders
 *     "no tasks", never a fabricated "0 ready / 0 tasks".
 *   ERROR — apiList rejecting renders the failure message; a failed
 *     apiGetReady degrades only that row, not the whole panel.
 *   STATE — loading state shows skeletons before data resolves; clicking a
 *     title calls onNavigate with that plan's id.
 *   REGRESSION — apiList is called with the exact `{type:"plan",status:"active"}`
 *     filter (guards against silently widening/narrowing the query); the
 *     "not ready-aware" placeholder badge is gone (SPEC-037 D1 supersedes it).
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ListResponse } from "../../src/lib/api";
import type { DocSummary, ReadyRecord } from "@lore/core";

vi.mock("@/lib/api", () => ({
  apiList: vi.fn(),
  apiGetReady: vi.fn(),
}));

import { apiList, apiGetReady } from "@/lib/api";
import { ActivePlansPanel } from "../../src/components/ActivePlansPanel";

const mockedApiList = vi.mocked(apiList);
const mockedApiGetReady = vi.mocked(apiGetReady);

function makePlan(overrides: Partial<DocSummary> & { id: string; title: string }): DocSummary {
  return {
    slug: "plan-fixture",
    type: "plan",
    status: "active",
    updated_at: "2026-07-01T00:00:00.000Z",
    tags: [],
    priority: "medium",
    ...overrides,
  };
}

function makeReadyRecord(overrides: Partial<ReadyRecord> & { task: ReadyRecord["task"] }): ReadyRecord {
  return {
    ready: true,
    unmet_blockers: [],
    evidence_count: 0,
    ...overrides,
  };
}

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  mockedApiList.mockReset();
  mockedApiGetReady.mockReset();
  // reason: default every plan row to "zero tasks" unless a test overrides it —
  // keeps tests that don't care about readiness from needing per-test mocking.
  mockedApiGetReady.mockResolvedValue({ ok: true, value: [] });
});

describe("ActivePlansPanel", () => {
  describe("happy path", () => {
    it("renders two active plans with distinct titles", async () => {
      const plan1 = makePlan({ id: "01HPLAN0000000000000000001", title: "Plan Alpha" });
      const plan2 = makePlan({ id: "01HPLAN0000000000000000002", title: "Plan Beta" });
      mockedApiList.mockResolvedValue({ docs: [plan1, plan2], total: 2 });

      renderWithClient(<ActivePlansPanel />);

      expect(await screen.findByText("Plan Alpha")).toBeInTheDocument();
      expect(screen.getByText("Plan Beta")).toBeInTheDocument();
    });

    it("renders 'N ready / M tasks' for a plan with readiness data", async () => {
      const plan1 = makePlan({ id: "01HPLAN0000000000000000001", title: "Plan Alpha" });
      mockedApiList.mockResolvedValue({ docs: [plan1], total: 1 });
      mockedApiGetReady.mockResolvedValue({
        ok: true,
        value: [
          makeReadyRecord({
            task: { id: "t1", slug: "task-1", type: "task", title: "T1", status: "draft", updated_at: "", tags: [], priority: "medium" },
            ready: true,
          }),
          makeReadyRecord({
            task: { id: "t2", slug: "task-2", type: "task", title: "T2", status: "draft", updated_at: "", tags: [], priority: "medium" },
            ready: false,
          }),
        ],
      });

      renderWithClient(<ActivePlansPanel />);

      expect(await screen.findByText("1 ready / 2 tasks")).toBeInTheDocument();
    });
  });

  describe("regression: query filter shape", () => {
    it('calls apiList with exactly {type: "plan", status: "active"}', async () => {
      mockedApiList.mockResolvedValue({ docs: [], total: 0 });

      renderWithClient(<ActivePlansPanel />);

      await waitFor(() => expect(mockedApiList).toHaveBeenCalledWith({ type: "plan", status: "active" }));
    });

    it("no longer renders the 'not ready-aware' placeholder badge (SPEC-037 D1)", async () => {
      mockedApiList.mockResolvedValue({ docs: [], total: 0 });

      renderWithClient(<ActivePlansPanel />);

      await screen.findByText("No active plans.");
      expect(screen.queryByText("not ready-aware")).not.toBeInTheDocument();
    });
  });

  describe("boundary: empty list", () => {
    it('renders "No active plans." for an empty result', async () => {
      mockedApiList.mockResolvedValue({ docs: [], total: 0 });

      renderWithClient(<ActivePlansPanel />);

      expect(await screen.findByText("No active plans.")).toBeInTheDocument();
    });
  });

  describe("boundary: zero-task plan", () => {
    it("renders muted 'no tasks' text, not a fabricated 0/0 counter", async () => {
      const plan1 = makePlan({ id: "01HPLAN0000000000000000001", title: "Plan Alpha" });
      mockedApiList.mockResolvedValue({ docs: [plan1], total: 1 });
      mockedApiGetReady.mockResolvedValue({ ok: true, value: [] });

      renderWithClient(<ActivePlansPanel />);

      expect(await screen.findByText("no tasks")).toBeInTheDocument();
      expect(screen.queryByText(/0 ready/)).not.toBeInTheDocument();
    });
  });

  describe("boundary: panel cap", () => {
    it("renders only 8 rows for a 10-plan result", async () => {
      const docs: ListResponse["docs"] = Array.from({ length: 10 }, (_, i) =>
        makePlan({ id: `01HPLAN000000000000000${String(i).padStart(3, "0")}`, title: `Plan ${i}` }),
      );
      mockedApiList.mockResolvedValue({ docs, total: 10 });

      renderWithClient(<ActivePlansPanel />);

      await screen.findByText("Plan 0");
      expect(screen.queryByText("Plan 8")).not.toBeInTheDocument();
      expect(screen.queryByText("Plan 9")).not.toBeInTheDocument();
    });
  });

  describe("error", () => {
    it("renders a failure message when apiList rejects", async () => {
      mockedApiList.mockRejectedValue(new Error("network down"));

      renderWithClient(<ActivePlansPanel />);

      expect(await screen.findByText("Failed to load active plans.")).toBeInTheDocument();
    });

    it("degrades a single row's readiness fetch failure without blanking the panel", async () => {
      const plan1 = makePlan({ id: "01HPLAN0000000000000000001", title: "Plan Alpha" });
      mockedApiList.mockResolvedValue({ docs: [plan1], total: 1 });
      // reason: the component only branches on `data.ok` — it never reads
      // `.error`'s fields, so a plain shape (not a real ApiError instance) is
      // sufficient and avoids importing the class through the mocked module.
      mockedApiGetReady.mockResolvedValue({
        ok: false,
        error: { name: "ApiError", message: "boom", status: 500, code: "STORE_ERROR" } as never,
      });

      renderWithClient(<ActivePlansPanel />);

      // The panel and the plan title are still intact.
      expect(await screen.findByText("Plan Alpha")).toBeInTheDocument();
      expect(await screen.findByText("readiness unavailable")).toBeInTheDocument();
    });
  });

  describe("state", () => {
    it("shows loading skeletons before data resolves", async () => {
      let resolveList!: (r: ListResponse) => void;
      mockedApiList.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveList = resolve;
          }),
      );

      const { container } = renderWithClient(<ActivePlansPanel />);

      expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);

      resolveList({ docs: [], total: 0 });
      await screen.findByText("No active plans.");
    });

    it("calls onNavigate with the clicked plan's id", async () => {
      const plan1 = makePlan({ id: "01HPLAN0000000000000000001", title: "Plan Alpha" });
      mockedApiList.mockResolvedValue({ docs: [plan1], total: 1 });
      const onNavigate = vi.fn();
      const user = userEvent.setup();

      renderWithClient(<ActivePlansPanel onNavigate={onNavigate} />);

      const title = await screen.findByText("Plan Alpha");
      await user.click(title);

      expect(onNavigate).toHaveBeenCalledWith("01HPLAN0000000000000000001");
    });
  });
});
