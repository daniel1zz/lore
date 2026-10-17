// @vitest-environment jsdom
/**
 * @layer dashboard-component (SpecAcCoveragePanel rendering; the ACs' oracle is deriveAcCoverageState in core)
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
 *
 * Added coverage — `fail_superseded`/`not_measured` (M4/M5, AC-FALS-20/AC-FALS-21):
 *   HAPPY:
 *     - a fail fact whose only fail ref is older than a strictly-newer attested pass
 *       ref renders "fail_superseded"
 *     - a pass-only fact whose falsified is genuinely ABSENT at runtime (deleted,
 *       defeating the type system on purpose) renders "not_measured"
 *   BOUNDARY (AC-FALS-20):
 *     - "fail_superseded", "not_measured", and "pass_unfalsified" render three
 *       MUTUALLY distinct badge variants in the same render
 *   REGRESSION (AC-FALS-21 — proves makeFact's default falsified is load-bearing,
 *   not cosmetic; no expectation in this file could have been green only because
 *   the field was absent):
 *     - makeFact() with no override yields a fact whose falsified is typeof "number"
 *     - the SAME fact with falsified deleted renders a DIFFERENT coverage state
 *       than the defaulted one ("not_measured" vs "pass_unfalsified")
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

/**
 * Builds a fact whose `falsified` is genuinely ABSENT at runtime — the exact
 * shape M5 (spec-oracle-tier-falsifiability-a-criterion-never-observed-red)
 * defends against: `AcCoverageFact.falsified` is typed `number` (required), but
 * that is a COMPILE-TIME claim only, and a hand-built fixture is precisely where
 * the runtime does not honor it. The `as unknown as AcCoverageFact` cast is
 * DELIBERATE, not sloppy — defeating the type system on purpose is the whole
 * point of this fixture (AC-FALS-21), never used for a "real" fact elsewhere in
 * this file.
 */
function makeFactWithoutFalsified(overrides: Partial<Omit<AcCoverageFact, "falsified">> = {}): AcCoverageFact {
  const withoutFalsified: Record<string, unknown> = {
    ac_id: "AC-1",
    mode: "script",
    pass: 0,
    fail: 0,
    refs: [],
    attested_pass: 0,
    attested_fail: 0,
    ...overrides,
  };
  return withoutFalsified as unknown as AcCoverageFact;
}

// reason: `falsified: 0` is an explicit DEFAULT, not an omission (spec-oracle-tier-
// falsifiability-a-criterion-never-observed-red M5) — before this fix, this helper's
// return literal never mentioned `falsified` at all, which `tsc` correctly rejected
// once the field became required-but-actually-unenforced-at-runtime (M5's own
// premise): every pre-existing call site in this file that overrode `pass`/`fail`
// but not `falsified` was GREEN for the wrong reason, since `falsified` was simply
// absent from the object rather than a real `0`. AC-FALS-21 (below) pins that a
// DELETED `falsified` now renders a DIFFERENT state (`not_measured`) than this
// default (`pass_unfalsified`), proving the default is load-bearing, not cosmetic.
function makeFact(overrides: Partial<AcCoverageFact> = {}): AcCoverageFact {
  return {
    ac_id: "AC-1",
    mode: "script",
    pass: 0,
    fail: 0,
    refs: [],
    attested_pass: 0,
    attested_fail: 0,
    falsified: 0,
    ...overrides,
  };
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

    it("renders a pass-only fact WITH falsified evidence as the 'pass' coverage state", () => {
      // ⛔ CORRECTED (spec-oracle-tier-falsifiability-a-criterion-never-observed-red
      // M5): this test previously called `makeFact({ pass: 1 })` with NO
      // `falsified` override, back when the helper's own return literal omitted
      // the field entirely. That absence — not a real `falsified: 0` — is EXACTLY
      // what made `deriveAcCoverageState` read `"pass"` before M5: an ABSENT
      // `falsified` fell through the old two-branch check (`falsified === 0` is
      // false for `undefined`) into the plain-pass fallback, the same optimistic
      // misread M5 exists to close. Once `makeFact`'s default became a REAL `0`
      // (this file's own fix, above), the identical call site correctly reads
      // `"pass_unfalsified"` instead — this test was GREEN FOR THE WRONG REASON.
      // `falsified: 1` makes the fixture genuinely mean what its title claims: a
      // pass that WAS observed able to go red at least once.
      render(
        <SpecAcCoveragePanel
          panel={{
            doc_type: "spec",
            criteria: [makeCriterion()],
            coverage: [makeFact({ pass: 1, falsified: 1 })],
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

  // ─── fail_superseded / not_measured states — spec-oracle-tier-falsifiability-
  // a-criterion-never-observed-red M4/M5 (AC-FALS-20/AC-FALS-21). ──────────────
  describe("fail_superseded / not_measured states (AC-FALS-20)", () => {
    it("HAPPY: renders 'fail_superseded' for a fail fact whose only fail ref is older than a strictly-newer attested pass ref", () => {
      render(
        <SpecAcCoveragePanel
          panel={{
            doc_type: "spec",
            criteria: [makeCriterion()],
            coverage: [
              makeFact({
                pass: 1,
                fail: 1,
                attested_pass: 1,
                falsified: 1,
                refs: [
                  { task_id: "t1", result: "fail", recorded_at: "2026-08-01T00:00:00.000Z" },
                  { task_id: "t2", result: "pass", attested: true, recorded_at: "2026-08-02T00:00:00.000Z" },
                ],
              }),
            ],
            task_count: 1,
          }}
        />,
      );
      expect(screen.getByText("fail_superseded")).toBeInTheDocument();
      expect(screen.queryByText("fail")).not.toBeInTheDocument();
    });

    it("HAPPY: renders 'not_measured' for a pass-only fact whose falsified is genuinely absent at runtime", () => {
      render(
        <SpecAcCoveragePanel
          panel={{
            doc_type: "spec",
            criteria: [makeCriterion()],
            coverage: [makeFactWithoutFalsified({ pass: 1, fail: 0, attested_pass: 0 })],
            task_count: 1,
          }}
        />,
      );
      expect(screen.getByText("not_measured")).toBeInTheDocument();
    });

    it("BOUNDARY: new-coverage-states — 'fail_superseded', 'not_measured', and 'pass_unfalsified' render three MUTUALLY distinct badge variants in the same render (AC-FALS-20)", () => {
      render(
        <SpecAcCoveragePanel
          panel={{
            doc_type: "spec",
            criteria: [
              makeCriterion({ id: "AC-SUPERSEDED" }),
              makeCriterion({ id: "AC-NOTMEASURED" }),
              makeCriterion({ id: "AC-UNFALSIFIED" }),
            ],
            coverage: [
              makeFact({
                ac_id: "AC-SUPERSEDED",
                pass: 1,
                fail: 1,
                attested_pass: 1,
                falsified: 1,
                refs: [
                  { task_id: "t1", result: "fail", recorded_at: "2026-08-01T00:00:00.000Z" },
                  { task_id: "t2", result: "pass", attested: true, recorded_at: "2026-08-02T00:00:00.000Z" },
                ],
              }),
              makeFactWithoutFalsified({ ac_id: "AC-NOTMEASURED", pass: 1, fail: 0, attested_pass: 0 }),
              makeFact({ ac_id: "AC-UNFALSIFIED", pass: 1, fail: 0, attested_pass: 0, falsified: 0 }),
            ],
            task_count: 1,
          }}
        />,
      );
      const supersededBadge = screen.getByText("fail_superseded");
      const notMeasuredBadge = screen.getByText("not_measured");
      const unfalsifiedBadge = screen.getByText("pass_unfalsified");

      // Three pairwise-distinct className signatures (badge.tsx CVA: "secondary" has
      // "border-transparent bg-secondary", "destructive" has "border-transparent
      // bg-destructive", "outline" has neither and carries "text-foreground" alone).
      expect(supersededBadge.className).not.toBe(notMeasuredBadge.className);
      expect(supersededBadge.className).not.toBe(unfalsifiedBadge.className);
      expect(notMeasuredBadge.className).not.toBe(unfalsifiedBadge.className);
    });
  });

  describe("makeFact's default falsified is load-bearing (AC-FALS-21)", () => {
    it("REGRESSION: makefact-falsified-required — makeFact() with no override yields a fact whose falsified is typeof number, and the SAME fact with falsified deleted renders a DIFFERENT coverage state", () => {
      const defaulted = makeFact({ pass: 1 });
      // Runtime assertion on the fixture itself — not just the rendered text —
      // so this test cannot pass merely because deriveAcCoverageState happens to
      // tolerate an absent field for THIS particular pass/fail combination.
      expect(typeof defaulted.falsified).toBe("number");

      const withoutFalsified = makeFactWithoutFalsified({ pass: 1 });
      expect("falsified" in withoutFalsified).toBe(false);

      render(
        <SpecAcCoveragePanel
          panel={{
            doc_type: "spec",
            criteria: [makeCriterion({ id: "AC-DEFAULTED" }), makeCriterion({ id: "AC-NOFALSIFIED" })],
            coverage: [
              { ...defaulted, ac_id: "AC-DEFAULTED" },
              { ...withoutFalsified, ac_id: "AC-NOFALSIFIED" },
            ],
            task_count: 1,
          }}
        />,
      );
      // The defaulted fact (falsified: 0) reads "pass_unfalsified"; the identical
      // fact with falsified deleted reads "not_measured" — a DIFFERENT state. No
      // expectation elsewhere in this file could have been green only because
      // makeFact's `falsified` field happened to be absent, because absence and
      // presence now provably diverge.
      expect(screen.getByText("pass_unfalsified")).toBeInTheDocument();
      expect(screen.getByText("not_measured")).toBeInTheDocument();
    });
  });
});
