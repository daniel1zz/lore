// @vitest-environment jsdom
/**
 * Tests for ExecutionPage — SPEC-077 S1 `/execution` page body.
 * @spec_ref AC-077-1
 *
 * Test plan (six-dimension coverage):
 *   HAPPY:
 *     - renders the plan selector populated from active plans
 *     - renders the four panel sections for the effective plan
 *     - selecting a different plan in the selector calls onPlanChange (URL sync)
 *   NEGATIVE:
 *     - zero active plans renders "No active plans." and no panel sections
 *   BOUNDARY:
 *     - an explicit planParam is used as the selected value, not the
 *       most-recently-active fallback
 *     - planParam absent falls back to the first (most-recently-active) plan
 *   ERROR:
 *     - a failed ready-report fetch (ok: false) renders a labeled error, never a crash
 *     - a rejected phase-status fetch renders a labeled error, never a crash
 *   STATE:
 *     - renders a loading skeleton while the active-plans query is pending
 *   REGRESSION:
 *     - clicking a ready-task row calls onNavigateToDoc with its doc id
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DocSummary } from "@lore/core";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/api")>();
  return {
    ...actual,
    apiList: vi.fn(),
    apiGetReadyReport: vi.fn(),
    apiGetPhaseStatus: vi.fn(),
  };
});

import { apiList, apiGetReadyReport, apiGetPhaseStatus } from "@/lib/api";
import { ExecutionPage } from "../../src/components/ExecutionPage";

const mockedApiList = vi.mocked(apiList);
const mockedApiGetReadyReport = vi.mocked(apiGetReadyReport);
const mockedApiGetPhaseStatus = vi.mocked(apiGetPhaseStatus);

function makePlan(overrides: Partial<DocSummary> = {}): DocSummary {
  return {
    id: "01HPLAN0000000000000000001",
    slug: "plan-a",
    type: "plan",
    title: "Plan A",
    status: "active",
    updated_at: "2026-07-01T00:00:00.000Z",
    tags: [],
    priority: "medium",
    ...overrides,
  };
}

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedApiGetReadyReport.mockResolvedValue({
    ok: true,
    value: { records: [], sessions: [], anchor_conflicts: [], claim_ttl_minutes: 120 },
  });
  mockedApiGetPhaseStatus.mockResolvedValue({
    plan: { id: "01HPLAN0000000000000000001", slug: "plan-a", title: "Plan A" },
    phases: [],
  });
});

describe("ExecutionPage", () => {
  describe("happy path (AC-077-1)", () => {
    it("renders the plan selector populated from active plans", async () => {
      mockedApiList.mockResolvedValue({ docs: [makePlan()], total: 1 });
      renderWithClient(<ExecutionPage planParam={undefined} onPlanChange={vi.fn()} onNavigateToDoc={vi.fn()} />);
      expect(await screen.findByRole("option", { name: "Plan A" })).toBeInTheDocument();
    });

    it("renders the four panel sections for the effective plan", async () => {
      mockedApiList.mockResolvedValue({ docs: [makePlan()], total: 1 });
      renderWithClient(<ExecutionPage planParam="plan-a" onPlanChange={vi.fn()} onNavigateToDoc={vi.fn()} />);
      expect(await screen.findByText("Ready Tasks")).toBeInTheDocument();
      expect(screen.getByText("Sessions")).toBeInTheDocument();
      expect(screen.getByText("Anchor Conflicts")).toBeInTheDocument();
      expect(screen.getByText("Phase Progress")).toBeInTheDocument();
    });

    it("calls onPlanChange with the new plan id when the selector changes (URL sync)", async () => {
      const user = userEvent.setup();
      const onPlanChange = vi.fn();
      mockedApiList.mockResolvedValue({
        docs: [makePlan({ id: "plan-a-id", title: "Plan A" }), makePlan({ id: "plan-b-id", slug: "plan-b", title: "Plan B" })],
        total: 2,
      });
      renderWithClient(<ExecutionPage planParam="plan-a-id" onPlanChange={onPlanChange} onNavigateToDoc={vi.fn()} />);
      await screen.findByRole("option", { name: "Plan B" });

      await user.selectOptions(screen.getByLabelText("Plan"), "plan-b-id");

      expect(onPlanChange).toHaveBeenCalledWith("plan-b-id");
    });
  });

  describe("negative", () => {
    it("renders 'No active plans.' and no panel sections for zero active plans", async () => {
      mockedApiList.mockResolvedValue({ docs: [], total: 0 });
      renderWithClient(<ExecutionPage planParam={undefined} onPlanChange={vi.fn()} onNavigateToDoc={vi.fn()} />);
      expect(await screen.findByText("No active plans.")).toBeInTheDocument();
      expect(screen.queryByText("Ready Tasks")).not.toBeInTheDocument();
    });
  });

  describe("boundary", () => {
    it("uses an explicit planParam as the selected value", async () => {
      mockedApiList.mockResolvedValue({
        docs: [makePlan({ id: "plan-a-id", title: "Plan A" }), makePlan({ id: "plan-b-id", slug: "plan-b", title: "Plan B" })],
        total: 2,
      });
      renderWithClient(<ExecutionPage planParam="plan-b-id" onPlanChange={vi.fn()} onNavigateToDoc={vi.fn()} />);
      await screen.findByRole("option", { name: "Plan B" });
      expect(mockedApiGetReadyReport).toHaveBeenCalledWith("plan-b-id");
    });

    it("falls back to the first (most-recently-active) plan when planParam is absent", async () => {
      mockedApiList.mockResolvedValue({
        docs: [makePlan({ id: "plan-a-id", title: "Plan A" }), makePlan({ id: "plan-b-id", slug: "plan-b", title: "Plan B" })],
        total: 2,
      });
      renderWithClient(<ExecutionPage planParam={undefined} onPlanChange={vi.fn()} onNavigateToDoc={vi.fn()} />);
      await screen.findByRole("option", { name: "Plan A" });
      expect(mockedApiGetReadyReport).toHaveBeenCalledWith("plan-a-id");
    });
  });

  describe("error", () => {
    it("renders a labeled error when the ready-report fetch fails, never a crash", async () => {
      mockedApiList.mockResolvedValue({ docs: [makePlan()], total: 1 });
      mockedApiGetReadyReport.mockResolvedValue({
        ok: false,
        error: { status: 422, code: "VALIDATION_ERROR", message: "not a plan" } as never,
      });
      renderWithClient(<ExecutionPage planParam="plan-a" onPlanChange={vi.fn()} onNavigateToDoc={vi.fn()} />);
      expect(await screen.findByText("Failed to load readiness.")).toBeInTheDocument();
    });

    it("renders a labeled error when the phase-status fetch rejects, never a crash", async () => {
      mockedApiList.mockResolvedValue({ docs: [makePlan()], total: 1 });
      mockedApiGetPhaseStatus.mockRejectedValue(new Error("boom"));
      renderWithClient(<ExecutionPage planParam="plan-a" onPlanChange={vi.fn()} onNavigateToDoc={vi.fn()} />);
      expect(await screen.findByText("Failed to load phase status.")).toBeInTheDocument();
    });
  });

  describe("state", () => {
    it("renders a loading skeleton while the active-plans query is pending", () => {
      mockedApiList.mockReturnValue(new Promise(() => {})); // never resolves
      const { container } = renderWithClient(
        <ExecutionPage planParam={undefined} onPlanChange={vi.fn()} onNavigateToDoc={vi.fn()} />,
      );
      expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    });
  });

  describe("regression", () => {
    it("calls onNavigateToDoc with the doc id when a ready-task row is clicked", async () => {
      const user = userEvent.setup();
      const onNavigateToDoc = vi.fn();
      mockedApiList.mockResolvedValue({ docs: [makePlan()], total: 1 });
      mockedApiGetReadyReport.mockResolvedValue({
        ok: true,
        value: {
          records: [
            {
              task: {
                id: "01HTASK0000000000000000001",
                slug: "task-a",
                type: "task",
                title: "Task A",
                status: "draft",
                updated_at: "2026-07-01T00:00:00.000Z",
                tags: [],
                priority: "medium",
              },
              ready: true,
              unmet_blockers: [],
              evidence_count: 0,
            },
          ],
          sessions: [],
          anchor_conflicts: [],
          claim_ttl_minutes: 120,
        },
      });
      renderWithClient(<ExecutionPage planParam="plan-a" onPlanChange={vi.fn()} onNavigateToDoc={onNavigateToDoc} />);
      await user.click(await screen.findByText("Task A"));
      expect(onNavigateToDoc).toHaveBeenCalledWith("01HTASK0000000000000000001");
    });
  });
});
