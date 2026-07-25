// @vitest-environment jsdom
/**
 * Tests for ReadyTaskList — SPEC-077 S2 execution-page ready-task rows.
 * @spec_ref AC-077-1
 *
 * Test plan (six-dimension coverage):
 *   HAPPY:
 *     - renders one row per record, with title, ready badge, and evidence count
 *     - a blocked record renders the "blocked" badge and its unmet-blocker slugs
 *     - a fresh claim renders the holder plus remaining minutes = ttl - age_minutes
 *   NEGATIVE:
 *     - a ready record renders no "Blocked by" text
 *     - a record with no claim renders no claim badge at all
 *   BOUNDARY:
 *     - zero records renders the explicit empty state
 *     - remaining minutes clamps at 0 (never negative) when age_minutes >= ttl
 *   ERROR:
 *     - n/a (pure render of an already-typed projection; no fallible IO here)
 *   STATE:
 *     - the fresh-claim countdown decrements after a 60s tick (client-side, no refetch)
 *   REGRESSION:
 *     - a stale claim renders the literal label "stale" (own badge, never merged
 *       into a combined string) and does NOT tick down
 *     - clicking a row calls onTaskClick with the task's doc id
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReadyRecord } from "@lore/core";
import { ReadyTaskList } from "../../src/components/ReadyTaskList";

function makeRecord(overrides: Partial<ReadyRecord> = {}): ReadyRecord {
  return {
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
    ...overrides,
  };
}

describe("ReadyTaskList", () => {
  describe("happy path (AC-077-1)", () => {
    it("renders one row per record with title, ready badge, and evidence count", () => {
      render(
        <ReadyTaskList
          records={[makeRecord({ evidence_count: 3 })]}
          claimTtlMinutes={120}
        />,
      );
      expect(screen.getByText("Task A")).toBeInTheDocument();
      expect(screen.getByText("ready")).toBeInTheDocument();
      expect(screen.getByText("3 evidence")).toBeInTheDocument();
    });

    it("renders 'blocked' and unmet-blocker slugs for a blocked record", () => {
      const record = makeRecord({
        ready: false,
        unmet_blockers: [{ id: "01HBLOCK000000000000000001", slug: "spec-x", status: "draft" }],
      });
      render(<ReadyTaskList records={[record]} claimTtlMinutes={120} />);
      expect(screen.getByText("blocked")).toBeInTheDocument();
      expect(screen.getByText("Blocked by: spec-x")).toBeInTheDocument();
    });

    it("renders holder + remaining minutes for a fresh claim", () => {
      const record = makeRecord({
        claim: { by: "alice", at: "2026-07-01T00:00:00.000Z", stale: false, age_minutes: 30 },
      });
      render(<ReadyTaskList records={[record]} claimTtlMinutes={120} />);
      expect(screen.getByText("alice")).toBeInTheDocument();
      expect(screen.getByText("90m left")).toBeInTheDocument();
      expect(screen.queryByText("stale")).not.toBeInTheDocument();
    });
  });

  describe("negative", () => {
    it("renders no 'Blocked by' text for a ready record", () => {
      render(<ReadyTaskList records={[makeRecord()]} claimTtlMinutes={120} />);
      expect(screen.queryByText(/Blocked by/)).not.toBeInTheDocument();
    });

    it("renders no claim badge when claim is absent", () => {
      render(<ReadyTaskList records={[makeRecord()]} claimTtlMinutes={120} />);
      expect(screen.queryByText(/m left/)).not.toBeInTheDocument();
      expect(screen.queryByText("stale")).not.toBeInTheDocument();
    });
  });

  describe("boundary", () => {
    it("renders the explicit empty state for zero records", () => {
      render(<ReadyTaskList records={[]} claimTtlMinutes={120} />);
      expect(screen.getByText("No tasks in this plan.")).toBeInTheDocument();
      expect(screen.queryByLabelText("Ready tasks")).not.toBeInTheDocument();
    });

    it("clamps remaining minutes at 0 when age_minutes equals the TTL", () => {
      const record = makeRecord({
        claim: { by: "alice", at: "2026-07-01T00:00:00.000Z", stale: false, age_minutes: 120 },
      });
      render(<ReadyTaskList records={[record]} claimTtlMinutes={120} />);
      expect(screen.getByText("0m left")).toBeInTheDocument();
    });

    it("clamps remaining minutes at 0 rather than negative when age_minutes exceeds the TTL", () => {
      const record = makeRecord({
        claim: { by: "alice", at: "2026-07-01T00:00:00.000Z", stale: false, age_minutes: 150 },
      });
      render(<ReadyTaskList records={[record]} claimTtlMinutes={120} />);
      expect(screen.getByText("0m left")).toBeInTheDocument();
      expect(screen.queryByText(/-\d+m left/)).not.toBeInTheDocument();
    });
  });

  describe("state", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("decrements the fresh-claim countdown after a 60s client-side tick", () => {
      const record = makeRecord({
        claim: { by: "alice", at: "2026-07-01T00:00:00.000Z", stale: false, age_minutes: 30 },
      });
      render(<ReadyTaskList records={[record]} claimTtlMinutes={120} />);
      expect(screen.getByText("90m left")).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(60_000);
      });

      expect(screen.getByText("89m left")).toBeInTheDocument();
      expect(screen.queryByText("90m left")).not.toBeInTheDocument();
    });
  });

  describe("regression", () => {
    it("renders the literal label 'stale' as its own badge for a stale claim, without ticking", () => {
      vi.useFakeTimers();
      const record = makeRecord({
        claim: { by: "bob", at: "2026-01-01T00:00:00.000Z", stale: true, age_minutes: 999 },
      });
      render(<ReadyTaskList records={[record]} claimTtlMinutes={120} />);
      expect(screen.getByText("bob")).toBeInTheDocument();
      expect(screen.getByText("stale")).toBeInTheDocument();
      expect(screen.queryByText(/m left/)).not.toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(120_000);
      });
      expect(screen.getByText("stale")).toBeInTheDocument();
      vi.useRealTimers();
    });

    it("calls onTaskClick with the task's doc id when a row is clicked", async () => {
      const user = userEvent.setup();
      const onTaskClick = vi.fn();
      render(<ReadyTaskList records={[makeRecord()]} claimTtlMinutes={120} onTaskClick={onTaskClick} />);
      await user.click(screen.getByText("Task A"));
      expect(onTaskClick).toHaveBeenCalledWith("01HTASK0000000000000000001");
    });
  });
});
