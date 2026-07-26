// @vitest-environment jsdom
/**
 * Tests for PhaseProgressPanel — SPEC-077 S2 execution-page phase scorecards.
 * @spec_ref AC-077-3
 *
 * Fixtures mirror the REAL `GET /api/phase-status/:planIdOrSlug` response
 * shape (`PhaseWorkflowService.planPhaseStatus`, `packages/lore/src/service/
 * phase-workflow-service.ts`) — a prior version of this file asserted against
 * an invented shape (`name`/`checklist: []`/`dropped_item_names`/`trust_label`)
 * that never matched the server and caused a live `/execution` page crash
 * (SPEC-077 T2 client-shape-drift fix).
 *
 * Test plan (six-dimension coverage):
 *   HAPPY:
 *     - renders one scorecard per phase with "a/b attested" counts
 *     - renders per-item checklist state and trust badges verbatim
 *     - renders dropped item names derived from dropped-state checklist_items
 *   NEGATIVE:
 *     - a non-vacuous phase renders no "vacuous" badge
 *     - a phase with an empty checklist_items renders no checklist list
 *   BOUNDARY:
 *     - zero phases renders the explicit empty state
 *     - a phase with zero dropped-state items renders no "Dropped:" text
 *   ERROR:
 *     - n/a (pure render of an already-typed projection; no fallible IO here)
 *   STATE:
 *     - n/a (pure render, no internal state)
 *   REGRESSION:
 *     - the "vacuous" badge renders exactly when the projection's vacuous flag is true,
 *       independent of the phase's ac_scope/checklist contents
 *     - trust labels render VERBATIM (whatever string the projection sends), never
 *       recomputed/renamed by the component
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PhaseScorecard } from "../../src/lib/api";
import { PhaseProgressPanel } from "../../src/components/PhaseProgressPanel";

function makeScorecard(overrides: Partial<PhaseScorecard> = {}): PhaseScorecard {
  return {
    phase_id: "01PHASE0000000000000000000",
    phase_slug: "phase-phase-1",
    phase_title: "Phase 1",
    state: "in-progress",
    vacuous: false,
    ac_scope: { total: 5, attested: 2, blocking: [] },
    checklist: { total: 0, satisfied: 0, blocking: [], dropped_named: [], manual_selfattested: [] },
    checklist_items: [],
    blocking: [],
    claim: null,
    task_count: 0,
    ...overrides,
  };
}

describe("PhaseProgressPanel", () => {
  describe("happy path (AC-077-3)", () => {
    it("renders one scorecard per phase with 'a/b attested' counts", () => {
      render(
        <PhaseProgressPanel
          phases={[makeScorecard({ phase_title: "Phase 1", ac_scope: { total: 5, attested: 2, blocking: [] } })]}
        />,
      );
      expect(screen.getByText("Phase 1")).toBeInTheDocument();
      expect(screen.getByText("2/5 attested")).toBeInTheDocument();
    });

    it("renders per-item checklist state and trust badges", () => {
      const scorecard = makeScorecard({
        checklist_items: [{ id: "CHK-1", statement: "unit suite green", state: "satisfied", trust: "attested" }],
      });
      render(<PhaseProgressPanel phases={[scorecard]} />);
      expect(screen.getByText("satisfied")).toBeInTheDocument();
      expect(screen.getByText("attested")).toBeInTheDocument();
      expect(screen.getByText("unit suite green")).toBeInTheDocument();
    });

    it("renders dropped item names derived from dropped-state checklist_items", () => {
      render(
        <PhaseProgressPanel
          phases={[
            makeScorecard({
              checklist_items: [
                { id: "CHK-2", statement: "CHK-2", state: "dropped", trust: "manual" },
                { id: "CHK-3", statement: "CHK-3", state: "dropped", trust: "attested" },
              ],
            }),
          ]}
        />,
      );
      expect(screen.getByText("Dropped: CHK-2, CHK-3")).toBeInTheDocument();
    });
  });

  describe("negative", () => {
    it("renders no 'vacuous' badge for a non-vacuous phase", () => {
      render(<PhaseProgressPanel phases={[makeScorecard({ vacuous: false })]} />);
      expect(screen.queryByText("vacuous")).not.toBeInTheDocument();
    });

    it("renders no checklist list for an empty checklist_items", () => {
      const { container } = render(<PhaseProgressPanel phases={[makeScorecard({ checklist_items: [] })]} />);
      expect(container.querySelector("ul")).toBeNull();
    });
  });

  describe("boundary", () => {
    it("renders the explicit empty state for zero phases with honest copy (ISSUE-007: never asserts the PLAN has no phases, only that no phase DOCUMENT exists)", () => {
      render(<PhaseProgressPanel phases={[]} />);
      expect(screen.getByText("No phase documents for this plan.")).toBeInTheDocument();
      expect(screen.queryByText(/this plan has no phases/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Phase progress")).not.toBeInTheDocument();
    });

    it("renders no 'Dropped:' text when no checklist_items are in the dropped state", () => {
      render(
        <PhaseProgressPanel
          phases={[
            makeScorecard({
              checklist_items: [{ id: "CHK-1", statement: "still open", state: "blocking", trust: "manual" }],
            }),
          ]}
        />,
      );
      expect(screen.queryByText(/Dropped:/)).not.toBeInTheDocument();
    });
  });

  describe("regression", () => {
    it("renders the 'vacuous' badge exactly when the projection's vacuous flag is true", () => {
      render(
        <PhaseProgressPanel
          phases={[
            makeScorecard({ phase_id: "phase-a", phase_title: "Phase A", vacuous: true, ac_scope: { total: 0, attested: 0, blocking: [] } }),
            makeScorecard({ phase_id: "phase-b", phase_title: "Phase B", vacuous: false }),
          ]}
        />,
      );
      const vacuousBadges = screen.getAllByText("vacuous");
      expect(vacuousBadges).toHaveLength(1);
    });

    it("renders trust labels verbatim from the projection, never recomputed", () => {
      const scorecard = makeScorecard({
        checklist_items: [{ id: "CHK-1", statement: "manual smoke test", state: "blocking", trust: "manual" }],
      });
      render(<PhaseProgressPanel phases={[scorecard]} />);
      expect(screen.getByText("manual")).toBeInTheDocument();
      expect(screen.getByText("blocking")).toBeInTheDocument();
    });
  });
});
