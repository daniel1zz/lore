// @vitest-environment jsdom
/**
 * Tests for PlanAttestationPanel — Evidence-tab rendering for a `plan` doc's
 * projection (SPEC-075 §Module Boundary D7).
 * @spec_ref AC-075-2, AC-075-3
 *
 * Test plan (six-dimension coverage):
 *   HAPPY (AC-075-2):
 *     - renders "meets floor" when attestation.meets_floor is true
 *     - renders each task's title and attested/evidence counts
 *     - zero_attested_tasks renders its own labeled list of slugs
 *   NEGATIVE:
 *     - renders "below floor" (destructive) when meets_floor is false
 *   BOUNDARY (AC-075-3):
 *     - zero task children renders an explicit empty state
 *     - ratio === null (vacuous pass) renders explicit "not applicable" copy,
 *       NEVER "0%"
 *   ERROR:
 *     - n/a (pure render of an already-typed projection)
 *   STATE:
 *     - n/a (pure render, no internal state)
 *   REGRESSION:
 *     - a non-null ratio renders as a rounded percentage (e.g. 0.5 -> "50%")
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AttestationSummary, TaskAttestationInfo } from "@lore/core";
import { PlanAttestationPanel } from "../../src/components/evidence/PlanAttestationPanel";

function makeSummary(overrides: Partial<AttestationSummary> = {}): AttestationSummary {
  return {
    total_evidence: 4,
    attested: 2,
    ratio: 0.5,
    min_ratio: 0.5,
    claimed_ac_coverage: { exercised_acs: [], unattested_acs: [], meets_coverage: true },
    meets_floor: true,
    zero_attested_tasks: [],
    ...overrides,
  };
}

function makeTaskInfo(overrides: Partial<TaskAttestationInfo> = {}): TaskAttestationInfo {
  return { slug: "task-x", title: "Task X", evidenceCount: 2, attestedCount: 1, ...overrides };
}

describe("PlanAttestationPanel", () => {
  describe("happy path (AC-075-2)", () => {
    it("renders 'meets floor' when the plan clears the attestation floor", () => {
      render(
        <PlanAttestationPanel panel={{ doc_type: "plan", attestation: makeSummary({ meets_floor: true }), tasks: [makeTaskInfo()] }} />,
      );
      expect(screen.getByText("meets floor")).toBeInTheDocument();
    });

    it("renders each task's title and its attested/evidence counts", () => {
      render(
        <PlanAttestationPanel
          panel={{ doc_type: "plan", attestation: makeSummary(), tasks: [makeTaskInfo({ title: "Ship the widget", attestedCount: 3, evidenceCount: 5 })] }}
        />,
      );
      expect(screen.getByText("Ship the widget")).toBeInTheDocument();
      expect(screen.getByText("3 / 5 attested")).toBeInTheDocument();
    });

    it("renders zero_attested_tasks as its own labeled list", () => {
      render(
        <PlanAttestationPanel
          panel={{
            doc_type: "plan",
            attestation: makeSummary({ meets_floor: false, zero_attested_tasks: ["task-unattested"] }),
            tasks: [makeTaskInfo({ slug: "task-unattested" })],
          }}
        />,
      );
      expect(screen.getByText("Tasks with unattested evidence:")).toBeInTheDocument();
      expect(screen.getByText("task-unattested")).toBeInTheDocument();
    });
  });

  describe("negative", () => {
    it("renders 'below floor' when the plan fails the attestation floor", () => {
      render(
        <PlanAttestationPanel panel={{ doc_type: "plan", attestation: makeSummary({ meets_floor: false }), tasks: [makeTaskInfo()] }} />,
      );
      expect(screen.getByText("below floor")).toBeInTheDocument();
    });
  });

  describe("boundary (AC-075-3)", () => {
    it("renders an explicit empty state for a plan with zero task children", () => {
      render(<PlanAttestationPanel panel={{ doc_type: "plan", attestation: makeSummary({ total_evidence: 0, attested: 0, ratio: null }), tasks: [] }} />);
      expect(screen.getByText("This plan has no task children yet.")).toBeInTheDocument();
    });

    it("renders an explicit 'not applicable' copy for a null ratio, never '0%'", () => {
      render(
        <PlanAttestationPanel
          panel={{
            doc_type: "plan",
            attestation: makeSummary({ total_evidence: 0, attested: 0, ratio: null, meets_floor: true }),
            tasks: [makeTaskInfo({ evidenceCount: 0, attestedCount: 0 })],
          }}
        />,
      );
      expect(screen.getByText(/not applicable/)).toBeInTheDocument();
      expect(screen.queryByText("0%")).not.toBeInTheDocument();
    });
  });

  describe("regression", () => {
    it("renders a non-null ratio as a rounded percentage", () => {
      render(
        <PlanAttestationPanel panel={{ doc_type: "plan", attestation: makeSummary({ ratio: 0.5 }), tasks: [makeTaskInfo()] }} />,
      );
      expect(screen.getByText("50%")).toBeInTheDocument();
    });
  });

  describe("ratio disabled render (AC-PCI-14)", () => {
    it("AC-PCI-14 ratio disabled render: renders the literal text 'ratio conjunct disabled' when min_ratio is null, and the rendered output contains neither '0%' nor '50%'", () => {
      render(
        <PlanAttestationPanel
          panel={{
            doc_type: "plan",
            // reason: ratio deliberately set to 0.75 (never 0 or 0.5) so this
            // test isolates the FLOOR field's own null-rendering — a coincidental
            // "50%"/"0%" from the UNRELATED attested-ratio field would make a
            // bare absence assertion ambiguous.
            attestation: makeSummary({ min_ratio: null, ratio: 0.75, meets_floor: true }),
            tasks: [makeTaskInfo()],
          }}
        />,
      );
      expect(screen.getByText("ratio conjunct disabled")).toBeInTheDocument();
      expect(screen.queryByText("0%")).not.toBeInTheDocument();
      expect(screen.queryByText("50%")).not.toBeInTheDocument();
    });

    it("AC-PCI-14 ratio disabled render: renders the numeric floor percentage when min_ratio is explicitly configured", () => {
      render(
        <PlanAttestationPanel
          panel={{ doc_type: "plan", attestation: makeSummary({ min_ratio: 0.3 }), tasks: [makeTaskInfo()] }}
        />,
      );
      expect(screen.getByText(/30%/)).toBeInTheDocument();
      expect(screen.queryByText("ratio conjunct disabled")).not.toBeInTheDocument();
    });
  });
});
