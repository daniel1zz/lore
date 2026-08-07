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
 *
 * Added coverage — the `pass_unfalsified` state (spec-oracle-tier-falsifiability-
 * a-criterion-never-observed-red M1; AC-FALS-2/AC-FALS-3 exercised through this
 * panel's real `deriveAcCoverageState` import, not mocked):
 *   HAPPY:
 *     - a non-attested pass fact with falsified === 0 renders "pass_unfalsified"
 *   BOUNDARY:
 *     - "pass_unfalsified" and "none" share the same "outline" badge variant, so
 *       they are proven distinguishable only by their visible label text
 *     - an attested pass with falsified === 0 still renders "attested_pass", not
 *       "pass_unfalsified" (AC-FALS-3 precedence, forced with falsified explicit)
 *   REGRESSION (adversarial — defeats a stub that maps every state to "outline"):
 *     - "pass_unfalsified" renders a visually distinct badge (no "border-transparent")
 *       from "fail" (which does carry "border-transparent" + "bg-destructive")
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

  // ─── pass_unfalsified state — spec-oracle-tier-falsifiability-a-criterion-
  // never-observed-red M1 (AC-FALS-2/AC-FALS-3, exercised here through the panel's
  // real `deriveAcCoverageState` import — never mocked in this file). ──────────
  describe("pass_unfalsified state (AC-FALS-2/AC-FALS-3)", () => {
    it("HAPPY: renders 'pass_unfalsified' for a non-attested pass fact with falsified === 0", () => {
      render(
        <SpecAcCoveragePanel
          panel={{
            doc_type: "spec",
            criteria: [makeCriterion()],
            // pass > 0, fail === 0, attested_pass === 0, falsified === 0 —
            // deriveAcCoverageState's documented "never observed red" branch.
            coverage: [makeFact({ pass: 1, fail: 0, attested_pass: 0, falsified: 0 })],
            task_count: 1,
          }}
        />,
      );
      expect(screen.getByText("pass_unfalsified")).toBeInTheDocument();
    });

    it("BOUNDARY: 'pass_unfalsified' and 'none' share the outline badge variant but render different visible text", () => {
      // Semantic point (module doc comment, stateVariant JSDoc option A): both
      // states map to the SAME "outline" Badge variant, so the only thing that
      // keeps a reader from confusing "never falsified" with "no evidence at all"
      // is the row's own label text. Assert both halves of that claim in one
      // render: the text differs AND the variant (CSS signature) is identical.
      render(
        <SpecAcCoveragePanel
          panel={{
            doc_type: "spec",
            criteria: [makeCriterion({ id: "AC-UNFALSIFIED" }), makeCriterion({ id: "AC-NONE" })],
            coverage: [
              makeFact({ ac_id: "AC-UNFALSIFIED", pass: 1, fail: 0, attested_pass: 0, falsified: 0 }),
              makeFact({ ac_id: "AC-NONE", pass: 0, fail: 0, attested_pass: 0 }),
            ],
            task_count: 1,
          }}
        />,
      );
      const unfalsifiedBadge = screen.getByText("pass_unfalsified");
      const noneBadge = screen.getByText("none");
      // Visible text is distinguishable — the entire reason this state exists.
      expect(unfalsifiedBadge.textContent).not.toBe(noneBadge.textContent);
      // Both badges are rendered via the SAME "outline" CVA variant: no
      // "border-transparent" (that class only appears on the filled variants —
      // default/secondary/destructive — per badge.tsx's CVA definition).
      expect(unfalsifiedBadge.className).not.toContain("border-transparent");
      expect(noneBadge.className).not.toContain("border-transparent");
      expect(unfalsifiedBadge.className).toContain("text-foreground");
      expect(noneBadge.className).toContain("text-foreground");
    });

    it("BOUNDARY: an attested pass with falsified === 0 still renders 'attested_pass', never 'pass_unfalsified' (AC-FALS-3)", () => {
      // Forces falsified explicitly to 0 (unlike the pre-existing attested_pass
      // regression test above, which leaves falsified unset) to prove the
      // attested_pass branch is checked BEFORE pass_unfalsified in
      // deriveAcCoverageState's precedence chain, not merely inapplicable
      // because falsified happened to be absent.
      render(
        <SpecAcCoveragePanel
          panel={{
            doc_type: "spec",
            criteria: [makeCriterion()],
            coverage: [makeFact({ pass: 1, fail: 0, attested_pass: 1, falsified: 0 })],
            task_count: 1,
          }}
        />,
      );
      expect(screen.getByText("attested_pass")).toBeInTheDocument();
      expect(screen.queryByText("pass_unfalsified")).not.toBeInTheDocument();
    });

    it("REGRESSION: 'pass_unfalsified' renders a visually distinct badge from 'fail' (defeats an all-outline stub)", () => {
      // Adversarial: an implementation that mapped every CoverageState to
      // "outline" would still make the two HAPPY-path text assertions above
      // pass. This test fails such a stub by asserting a DIFFERENT state
      // (fail) renders a DIFFERENT variant's CSS signature in the SAME render.
      render(
        <SpecAcCoveragePanel
          panel={{
            doc_type: "spec",
            criteria: [makeCriterion({ id: "AC-UNFALSIFIED" }), makeCriterion({ id: "AC-FAIL" })],
            coverage: [
              makeFact({ ac_id: "AC-UNFALSIFIED", pass: 1, fail: 0, attested_pass: 0, falsified: 0 }),
              makeFact({ ac_id: "AC-FAIL", pass: 3, fail: 1 }),
            ],
            task_count: 1,
          }}
        />,
      );
      const unfalsifiedBadge = screen.getByText("pass_unfalsified");
      const failBadge = screen.getByText("fail");
      // outline variant (badge.tsx CVA): "text-foreground" only, no
      // "border-transparent", no "bg-destructive".
      expect(unfalsifiedBadge.className).not.toContain("border-transparent");
      expect(unfalsifiedBadge.className).not.toContain("bg-destructive");
      // destructive variant (badge.tsx CVA): "border-transparent bg-destructive
      // text-destructive-foreground shadow hover:bg-destructive/80".
      expect(failBadge.className).toContain("border-transparent");
      expect(failBadge.className).toContain("bg-destructive");
    });
  });
});
