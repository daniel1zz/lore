// @vitest-environment jsdom
/**
 * Tests for SpecAcCoveragePanel — Evidence-tab rendering for a `spec` doc's
 * projection (SPEC-075 §Module Boundary D7).
 * @spec_ref AC-075-2, AC-075-3
 *
 * Test plan (six-dimension coverage):
 *   HAPPY (AC-075-2):
 *     - renders one row per declared criterion with its ac_id and verify mode
 *     - a criterion with a pass-only fact renders the "pass" coverage state
 *     - task_count renders in the panel header
 *   NEGATIVE:
 *     - a criterion with a coverage fact both pass AND fail renders "fail"
 *       (fail-first precedence, deriveAcCoverageState)
 *   BOUNDARY (AC-075-3):
 *     - zero declared criteria renders an explicit empty state
 *     - a criterion with NO coverage fact at all (index gap) renders "none"
 *   ERROR:
 *     - n/a (pure render of an already-typed projection)
 *   STATE:
 *     - n/a (pure render, no internal state)
 *   REGRESSION:
 *     - an attested pass renders the "attested_pass" state, not plain "pass"
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AcCoverageFact, AcceptanceCriterion } from "@lore/core";
import { SpecAcCoveragePanel } from "../../src/components/evidence/SpecAcCoveragePanel";

function makeCriterion(overrides: Partial<AcceptanceCriterion> = {}): AcceptanceCriterion {
  return {
    id: "AC-1",
    statement: "Some testable statement",
    verify: { mode: "script", oracle: "test", command: "bun test" },
    ...overrides,
  };
}

function makeFact(overrides: Partial<AcCoverageFact> = {}): AcCoverageFact {
  return { ac_id: "AC-1", mode: "script", pass: 0, fail: 0, refs: [], attested_pass: 0, attested_fail: 0, ...overrides };
}

describe("SpecAcCoveragePanel", () => {
  describe("happy path (AC-075-2)", () => {
    it("renders one row per declared criterion with its id and mode", () => {
      render(
        <SpecAcCoveragePanel
          panel={{
            doc_type: "spec",
            criteria: [makeCriterion({ id: "AC-9" })],
            coverage: [makeFact({ ac_id: "AC-9" })],
            task_count: 2,
          }}
        />,
      );
      expect(screen.getByText("AC-9")).toBeInTheDocument();
      expect(screen.getByText("script")).toBeInTheDocument();
    });

    it("renders a pass-only fact as the 'pass' coverage state", () => {
      render(
        <SpecAcCoveragePanel
          panel={{
            doc_type: "spec",
            criteria: [makeCriterion()],
            coverage: [makeFact({ pass: 1 })],
            task_count: 1,
          }}
        />,
      );
      expect(screen.getByText("pass")).toBeInTheDocument();
    });

    it("renders the task_count in the panel header", () => {
      render(
        <SpecAcCoveragePanel
          panel={{ doc_type: "spec", criteria: [makeCriterion()], coverage: [makeFact()], task_count: 3 }}
        />,
      );
      expect(screen.getByText(/3 tasks contributing evidence/)).toBeInTheDocument();
    });
  });

  describe("negative", () => {
    it("renders 'fail' when a fact has both pass and fail (fail-first precedence)", () => {
      render(
        <SpecAcCoveragePanel
          panel={{
            doc_type: "spec",
            criteria: [makeCriterion()],
            coverage: [makeFact({ pass: 3, fail: 1 })],
            task_count: 1,
          }}
        />,
      );
      expect(screen.getByText("fail")).toBeInTheDocument();
      expect(screen.queryByText("pass")).not.toBeInTheDocument();
    });
  });

  describe("boundary (AC-075-3)", () => {
    it("renders an explicit empty state for zero declared criteria", () => {
      render(<SpecAcCoveragePanel panel={{ doc_type: "spec", criteria: [], coverage: [], task_count: 0 }} />);
      expect(screen.getByText("This spec has no declared acceptance criteria.")).toBeInTheDocument();
    });

    it("renders 'none' when a criterion has no matching coverage fact", () => {
      render(
        <SpecAcCoveragePanel
          panel={{ doc_type: "spec", criteria: [makeCriterion()], coverage: [], task_count: 0 }}
        />,
      );
      expect(screen.getByText("none")).toBeInTheDocument();
    });
  });

  describe("regression", () => {
    it("renders 'attested_pass' (not plain 'pass') for an attested-pass fact", () => {
      render(
        <SpecAcCoveragePanel
          panel={{
            doc_type: "spec",
            criteria: [makeCriterion()],
            coverage: [makeFact({ pass: 1, attested_pass: 1 })],
            task_count: 1,
          }}
        />,
      );
      expect(screen.getByText("attested_pass")).toBeInTheDocument();
    });
  });
});
