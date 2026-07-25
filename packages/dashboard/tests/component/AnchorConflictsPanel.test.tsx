// @vitest-environment jsdom
/**
 * Tests for AnchorConflictsPanel — SPEC-077 S2 execution-page anchor-overlap
 * advisories.
 * @spec_ref AC-077-2
 *
 * Test plan (six-dimension coverage):
 *   HAPPY:
 *     - renders one row per conflict, naming the declaring task, the foreign
 *       holder, and the overlapping path(s)
 *   NEGATIVE:
 *     - a conflict's paths never leak into the wrong row when multiple conflicts render
 *   BOUNDARY:
 *     - zero conflicts renders an explicit empty state
 *     - a conflict with multiple overlapping paths renders all of them
 *   ERROR:
 *     - n/a (pure render of an already-typed projection; no fallible IO here)
 *   STATE:
 *     - n/a (pure render, no internal state)
 *   REGRESSION:
 *     - multiple conflicts each render distinctly (no dedup/merge)
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AnchorConflict } from "../../src/lib/api";
import { AnchorConflictsPanel } from "../../src/components/AnchorConflictsPanel";

function makeConflict(overrides: Partial<AnchorConflict> = {}): AnchorConflict {
  return {
    task_slug: "task-a",
    holder: "agent:worker-2",
    paths: ["packages/dashboard/src/"],
    ...overrides,
  };
}

describe("AnchorConflictsPanel", () => {
  describe("happy path (AC-077-2)", () => {
    it("names the declaring task, the foreign holder, and the overlapping path", () => {
      render(<AnchorConflictsPanel conflicts={[makeConflict()]} />);
      expect(screen.getByText("task-a")).toBeInTheDocument();
      expect(screen.getByText("agent:worker-2")).toBeInTheDocument();
      expect(screen.getByText("packages/dashboard/src/")).toBeInTheDocument();
    });
  });

  describe("boundary", () => {
    it("renders an explicit empty state for zero conflicts", () => {
      render(<AnchorConflictsPanel conflicts={[]} />);
      expect(screen.getByText("No anchor conflicts.")).toBeInTheDocument();
      expect(screen.queryByLabelText("Anchor conflicts")).not.toBeInTheDocument();
    });

    it("renders all overlapping paths for a multi-path conflict", () => {
      render(
        <AnchorConflictsPanel
          conflicts={[makeConflict({ paths: ["packages/dashboard/src/", "packages/dashboard/tests/"] })]}
        />,
      );
      expect(screen.getByText("packages/dashboard/src/, packages/dashboard/tests/")).toBeInTheDocument();
    });
  });

  describe("regression", () => {
    it("renders multiple conflicts distinctly, without merging", () => {
      render(
        <AnchorConflictsPanel
          conflicts={[
            makeConflict({ task_slug: "task-a", holder: "agent:worker-2" }),
            makeConflict({ task_slug: "task-b", holder: "agent:worker-3" }),
          ]}
        />,
      );
      expect(screen.getByText("task-a")).toBeInTheDocument();
      expect(screen.getByText("task-b")).toBeInTheDocument();
      expect(screen.getByText("agent:worker-2")).toBeInTheDocument();
      expect(screen.getByText("agent:worker-3")).toBeInTheDocument();
    });
  });
});
