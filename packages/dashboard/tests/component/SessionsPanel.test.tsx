// @vitest-environment jsdom
/**
 * Tests for SessionsPanel — SPEC-077 S2 execution-page sessions roster.
 * @spec_ref AC-077-2
 *
 * Test plan (six-dimension coverage):
 *   HAPPY:
 *     - renders one row per derived session with actor and held-task count
 *     - renders machine and worktree when present
 *   NEGATIVE:
 *     - renders "unknown machine" (never blank) when machine is absent
 *   BOUNDARY:
 *     - zero sessions renders the explicit "no active sessions" empty state
 *   ERROR:
 *     - n/a (pure render of an already-typed projection; no fallible IO here)
 *   STATE:
 *     - n/a (pure render, no internal state)
 *   REGRESSION:
 *     - held-task count reflects task_slugs.length, not the slugs themselves
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReadySession } from "@lore/core";
import { SessionsPanel } from "../../src/components/SessionsPanel";

function makeSession(overrides: Partial<ReadySession> = {}): ReadySession {
  return {
    by: "agent:worker-1",
    branches: [],
    task_slugs: ["task-a", "task-b"],
    newest_at: "2026-07-01T00:00:00.000Z",
    message_address: null,
    ...overrides,
  };
}

describe("SessionsPanel", () => {
  describe("happy path (AC-077-2)", () => {
    it("renders one row per session with actor and held-task count", () => {
      render(<SessionsPanel sessions={[makeSession()]} />);
      expect(screen.getByText("agent:worker-1")).toBeInTheDocument();
      expect(screen.getByText("2 held")).toBeInTheDocument();
    });

    it("renders machine and worktree when present", () => {
      render(
        <SessionsPanel
          sessions={[makeSession({ machine: "alices-mbp", worktree: "/repo/.worktrees/t1" })]}
        />,
      );
      expect(screen.getByText(/alices-mbp/)).toBeInTheDocument();
      expect(screen.getByText(/\/repo\/\.worktrees\/t1/)).toBeInTheDocument();
    });
  });

  describe("negative", () => {
    it("renders 'unknown machine' when machine is absent, never a blank field", () => {
      render(<SessionsPanel sessions={[makeSession({ machine: undefined })]} />);
      expect(screen.getByText(/unknown machine/)).toBeInTheDocument();
    });
  });

  describe("boundary", () => {
    it("renders the explicit 'no active sessions' empty state for zero sessions", () => {
      render(<SessionsPanel sessions={[]} />);
      expect(screen.getByText("No active sessions.")).toBeInTheDocument();
      expect(screen.queryByLabelText("Sessions")).not.toBeInTheDocument();
    });
  });

  describe("regression", () => {
    it("renders the held-task COUNT, not the individual task slugs", () => {
      render(<SessionsPanel sessions={[makeSession({ task_slugs: ["task-a", "task-b", "task-c"] })]} />);
      expect(screen.getByText("3 held")).toBeInTheDocument();
      expect(screen.queryByText("task-a")).not.toBeInTheDocument();
    });
  });
});
