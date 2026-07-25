// @vitest-environment jsdom
/**
 * Tests for PhaseProgressPanel — SPEC-077 S2 execution-page phase scorecards.
 * @spec_ref AC-077-3
 *
 * Test plan (six-dimension coverage):
 *   HAPPY:
 *     - renders one scorecard per phase with "a/b attested" counts
 *     - renders per-item checklist state and trust-label badges verbatim
 *     - renders dropped item names
 *   NEGATIVE:
 *     - a non-vacuous phase renders no "vacuous" badge
 *     - a phase with an empty checklist renders no checklist list
 *   BOUNDARY:
 *     - zero phases renders the explicit empty state
 *     - a phase with zero dropped items renders no "Dropped:" text
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
    name: "Phase 1",
    ac_scope: { attested: 2, total: 5 },
    checklist: [],
    dropped_item_names: [],
    vacuous: false,
    ...overrides,
  };
}

describe("PhaseProgressPanel", () => {
  describe("happy path (AC-077-3)", () => {
    it("renders one scorecard per phase with 'a/b attested' counts", () => {
      render(<PhaseProgressPanel phases={[makeScorecard({ name: "Phase 1", ac_scope: { attested: 2, total: 5 } })]} />);
      expect(screen.getByText("Phase 1")).toBeInTheDocument();
      expect(screen.getByText("2/5 attested")).toBeInTheDocument();
    });

    it("renders per-item checklist state and trust-label badges", () => {
      const scorecard = makeScorecard({
        checklist: [{ id: "CHK-1", statement: "unit suite green", state: "satisfied", trust_label: "attested" }],
      });
      render(<PhaseProgressPanel phases={[scorecard]} />);
      expect(screen.getByText("satisfied")).toBeInTheDocument();
      expect(screen.getByText("attested")).toBeInTheDocument();
      expect(screen.getByText("unit suite green")).toBeInTheDocument();
    });

    it("renders dropped item names", () => {
      render(<PhaseProgressPanel phases={[makeScorecard({ dropped_item_names: ["CHK-2", "CHK-3"] })]} />);
      expect(screen.getByText("Dropped: CHK-2, CHK-3")).toBeInTheDocument();
    });
  });

  describe("negative", () => {
    it("renders no 'vacuous' badge for a non-vacuous phase", () => {
      render(<PhaseProgressPanel phases={[makeScorecard({ vacuous: false })]} />);
      expect(screen.queryByText("vacuous")).not.toBeInTheDocument();
    });

    it("renders no checklist list for an empty checklist", () => {
      const { container } = render(<PhaseProgressPanel phases={[makeScorecard({ checklist: [] })]} />);
      expect(container.querySelector("ul")).toBeNull();
    });
  });

  describe("boundary", () => {
    it("renders the explicit empty state for zero phases", () => {
      render(<PhaseProgressPanel phases={[]} />);
      expect(screen.getByText("This plan has no phases yet.")).toBeInTheDocument();
      expect(screen.queryByLabelText("Phase progress")).not.toBeInTheDocument();
    });

    it("renders no 'Dropped:' text when dropped_item_names is empty", () => {
      render(<PhaseProgressPanel phases={[makeScorecard({ dropped_item_names: [] })]} />);
      expect(screen.queryByText(/Dropped:/)).not.toBeInTheDocument();
    });
  });

  describe("regression", () => {
    it("renders the 'vacuous' badge exactly when the projection's vacuous flag is true", () => {
      render(
        <PhaseProgressPanel
          phases={[
            makeScorecard({ name: "Phase A", vacuous: true, ac_scope: { attested: 0, total: 0 } }),
            makeScorecard({ name: "Phase B", vacuous: false }),
          ]}
        />,
      );
      const vacuousBadges = screen.getAllByText("vacuous");
      expect(vacuousBadges).toHaveLength(1);
    });

    it("renders trust labels verbatim from the projection, never recomputed", () => {
      const scorecard = makeScorecard({
        checklist: [{ id: "CHK-1", statement: "manual smoke test", state: "blocking", trust_label: "manual" }],
      });
      render(<PhaseProgressPanel phases={[scorecard]} />);
      expect(screen.getByText("manual")).toBeInTheDocument();
      expect(screen.getByText("blocking")).toBeInTheDocument();
    });
  });
});
