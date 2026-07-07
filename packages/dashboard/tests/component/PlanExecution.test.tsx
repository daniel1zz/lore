// @vitest-environment jsdom
/**
 * Tests for PlanExecution — plan-detail Execution section (SPEC-037 D2).
 * @spec_ref SPEC-037 §1 D2, AC-37-3, AC-37-4, AC-37-6
 *
 * Test plan:
 *   HAPPY:
 *     - groups task children under declared phase headers, in declaration order
 *     - rollup renders "X / Y tasks done · R ready"
 *     - task rows render accent border + status pill + meta badge (shared-renderer parity)
 *
 *   NEGATIVE:
 *     - a task meta badge with evidence_fail > 0 renders the destructive variant (AC-37-6)
 *
 *   BOUNDARY:
 *     - Unphased group renders only when non-empty
 *     - Other documents group renders only for non-task children, title-only
 *
 *   ERROR:
 *     - a task child with no matching ReadyRecord renders with no readiness
 *       adornments (blocked indicator absent), never throws
 *
 *   STATE:
 *     - clicking a task row calls onNavigate with its id
 *
 *   REGRESSION:
 *     - a blocked non-terminal task shows "blocked by <slug>" (+n for extras)
 *     - a failed/pending readiness fetch omits "R ready" rather than fabricating it
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DocRecord, DocSummary, ReadyRecord } from "@lore/core";

vi.mock("@/lib/api", () => ({
  apiGetReady: vi.fn(),
}));

import { apiGetReady } from "@/lib/api";
import { PlanExecution } from "../../src/components/PlanExecution";

const mockedApiGetReady = vi.mocked(apiGetReady);

function makePlan(overrides: Partial<DocRecord> = {}): DocRecord {
  return {
    id: "01HPLAN0000000000000000001",
    slug: "plan-fixture",
    title: "Plan Fixture",
    type: "plan",
    status: "active",
    priority: "medium",
    content: "",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    created_by: null,
    parent_id: null,
    tags: [],
    extra: {},
    version: 1,
    ...overrides,
  };
}

function makeTask(overrides: Partial<DocSummary> & { id: string; title: string }): DocSummary {
  return {
    slug: `task-${overrides.id}`,
    type: "task",
    status: "draft",
    updated_at: "2026-01-01T00:00:00.000Z",
    tags: [],
    priority: "medium",
    ...overrides,
  };
}

function makeReady(overrides: Partial<ReadyRecord> & { task: ReadyRecord["task"] }): ReadyRecord {
  return { ready: true, unmet_blockers: [], evidence_count: 0, ...overrides };
}

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  mockedApiGetReady.mockReset();
});

describe("PlanExecution", () => {
  describe("happy path", () => {
    it("groups task children under declared phase headers in declaration order, with a rollup", async () => {
      const plan = makePlan({ extra: { phases: [{ name: "Design" }, { name: "Build" }] } });
      const design1 = makeTask({ id: "t1", title: "Design task" });
      const build1 = makeTask({ id: "t2", title: "Build task", status: "archived" });
      mockedApiGetReady.mockResolvedValue({
        ok: true,
        value: [
          makeReady({ task: design1, phase: "Design", ready: true }),
          makeReady({ task: build1, phase: "Build", ready: true }),
        ],
      });

      const { container } = renderWithClient(<PlanExecution plan={plan} children={[design1, build1]} />);

      expect(await screen.findByText("Design")).toBeInTheDocument();
      expect(screen.getByText("Build")).toBeInTheDocument();
      expect(screen.getByText("Design task")).toBeInTheDocument();
      expect(screen.getByText("Build task")).toBeInTheDocument();
      expect(await screen.findByText("1 / 2 tasks done · 2 ready")).toBeInTheDocument();

      // "Design" header appears before "Build" header in document order.
      const html = container.innerHTML;
      expect(html.indexOf("Design")).toBeLessThan(html.indexOf("Build"));
    });
  });

  describe("negative: danger color", () => {
    it("renders the destructive badge variant for a task with evidence_fail > 0", async () => {
      const plan = makePlan();
      const failingTask = makeTask({
        id: "t3",
        title: "Failing task",
        meta: { t: "task", evidence_pass: 1, evidence_fail: 2 },
      });
      mockedApiGetReady.mockResolvedValue({ ok: true, value: [makeReady({ task: failingTask })] });

      renderWithClient(<PlanExecution plan={plan} children={[failingTask]} />);

      const badge = await screen.findByText("✔1/✘2");
      expect(badge).toHaveClass("text-destructive-foreground");
    });
  });

  describe("boundary", () => {
    it("omits the Unphased group entirely when every task has a declared phase", async () => {
      const plan = makePlan({ extra: { phases: [{ name: "Only" }] } });
      const task = makeTask({ id: "t1", title: "Task A" });
      mockedApiGetReady.mockResolvedValue({ ok: true, value: [makeReady({ task, phase: "Only" })] });

      renderWithClient(<PlanExecution plan={plan} children={[task]} />);

      // Wait for the readiness fetch to settle (the task briefly renders under
      // "Unphased" before the phase join resolves) before asserting its absence.
      await screen.findByText("0 / 1 tasks done · 1 ready");
      expect(screen.getByText("Task A")).toBeInTheDocument();
      expect(screen.queryByText("Unphased")).not.toBeInTheDocument();
    });

    it("renders non-task children under 'Other documents', title-only", async () => {
      const plan = makePlan();
      const knowledgeDoc = makeTask({ id: "k1", title: "Retro Notes", type: "knowledge" });
      mockedApiGetReady.mockResolvedValue({ ok: true, value: [] });

      renderWithClient(<PlanExecution plan={plan} children={[knowledgeDoc]} />);

      expect(await screen.findByText("Other documents")).toBeInTheDocument();
      expect(screen.getByText("Retro Notes")).toBeInTheDocument();
    });
  });

  describe("error: missing readiness record", () => {
    it("renders a task with no matching ReadyRecord without adornments, never throws", async () => {
      const plan = makePlan();
      const orphanTask = makeTask({ id: "orphan", title: "Orphan Task" });
      mockedApiGetReady.mockResolvedValue({ ok: true, value: [] });

      expect(() => renderWithClient(<PlanExecution plan={plan} children={[orphanTask]} />)).not.toThrow();

      expect(await screen.findByText("Orphan Task")).toBeInTheDocument();
      expect(screen.queryByText(/blocked by/)).not.toBeInTheDocument();
    });
  });

  describe("state", () => {
    it("calls onNavigate with the task's id when its row is clicked", async () => {
      const plan = makePlan();
      const task = makeTask({ id: "t1", title: "Clickable Task" });
      const onNavigate = vi.fn();
      mockedApiGetReady.mockResolvedValue({ ok: true, value: [makeReady({ task })] });

      renderWithClient(<PlanExecution plan={plan} children={[task]} onNavigate={onNavigate} />);

      const row = await screen.findByText("Clickable Task");
      fireEvent.click(row);

      expect(onNavigate).toHaveBeenCalledWith("t1");
    });
  });

  describe("regression", () => {
    it("shows 'blocked by <slug>' for a blocked non-terminal task, with '+n' for extra blockers", async () => {
      const plan = makePlan();
      const blockedTask = makeTask({ id: "t1", title: "Blocked Task" });
      mockedApiGetReady.mockResolvedValue({
        ok: true,
        value: [
          makeReady({
            task: blockedTask,
            ready: false,
            unmet_blockers: [
              { id: "b1", slug: "spec-blocker-one", status: "draft" },
              { id: "b2", slug: "spec-blocker-two", status: "draft" },
            ],
          }),
        ],
      });

      renderWithClient(<PlanExecution plan={plan} children={[blockedTask]} />);

      expect(await screen.findByText("blocked by spec-blocker-one +1")).toBeInTheDocument();
    });

    it("omits 'R ready' from the rollup when the readiness fetch fails", async () => {
      const plan = makePlan();
      const task = makeTask({ id: "t1", title: "Task A" });
      mockedApiGetReady.mockResolvedValue({
        ok: false,
        error: { name: "ApiError", message: "boom", status: 500, code: "STORE_ERROR" } as never,
      });

      renderWithClient(<PlanExecution plan={plan} children={[task]} />);

      await waitFor(() => expect(screen.getByText(/tasks done/)).toBeInTheDocument());
      expect(screen.getByText("0 / 1 tasks done")).toBeInTheDocument();
      expect(screen.queryByText(/ready/)).not.toBeInTheDocument();
    });
  });
});
