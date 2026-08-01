// @vitest-environment jsdom
/**
 * Tests for PlanAttestationPanel — Evidence-tab rendering for a `plan` doc's
 * projection (SPEC-075 §Module Boundary D7; task-meets-floor-renders-pass-
 * while-the-declared-scope-conjunct for the declared-scope conjunct badge).
 * @spec_ref AC-075-2, AC-075-3
 *
 * Test plan (six-dimension coverage):
 *   HAPPY (AC-075-2):
 *     - renders "meets floor" when attestation.meets_floor is true AND the
 *       declared-scope conjunct resolves ok — the CONTROL fixture proving a
 *       genuinely-passing plan still reads as passing (not everything turned
 *       red by this fix)
 *     - renders each task's title and attested/evidence counts
 *     - zero_attested_tasks renders its own labeled list of slugs
 *   NEGATIVE:
 *     - renders "below floor" (destructive) when meets_floor is false
 *     - renders "below floor" when the RATIO conjunct alone passes but the
 *       declared-scope conjunct measurably fails (unattested declared ACs) —
 *       never "meets floor"
 *   BOUNDARY (AC-075-3):
 *     - zero task children renders an explicit empty state
 *     - ratio === null (vacuous pass) renders explicit "not applicable" copy,
 *       NEVER "0%"
 *     - declared_scope_verdict.notApplicable (scope undeclared) renders the
 *       THIRD "scope undeclared" state — the external oracle: this fixture
 *       must NEVER render "meets floor" even though the ratio conjunct alone
 *       passes (the exact defect task-meets-floor-renders-pass-while-the-
 *       declared-scope-conjunct removes), and must NEVER render "below floor"
 *       either (the proxy-for-invariant collapse the governing task forbids)
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
import type {
  AttestationSummary,
  DeclaredScopeCoverage,
  DeclaredScopeCoverageVerdict,
  PlanEvidencePanel,
  TaskAttestationInfo,
} from "@lore/core";
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

/** A resolved, fully-satisfied declared-scope fact — the default for every
 *  test in this file that isn't specifically about the declared-scope conjunct. */
const RESOLVED_DECLARED_SCOPE: DeclaredScopeCoverage = {
  declared_acs: [],
  unattested_acs: [],
  scope_undeclared: false,
  meets_coverage: true,
};

/** Pairs with {@link RESOLVED_DECLARED_SCOPE} — the conjunct's passing verdict. */
const DECLARED_SCOPE_OK: DeclaredScopeCoverageVerdict = { ok: true };

/**
 * Builds a full `PlanEvidencePanel` fixture. Defaults the declared-scope
 * conjunct to a resolved pass ({@link RESOLVED_DECLARED_SCOPE}/
 * {@link DECLARED_SCOPE_OK}) so every pre-existing test in this file — which
 * predates the declared-scope conjunct and only exercises the ratio conjunct —
 * keeps its original meaning unchanged; only the tests in the "declared-scope
 * conjunct" describe block below override these two fields.
 */
function makePlanPanel(
  overrides: {
    attestation?: Partial<AttestationSummary>;
    tasks?: TaskAttestationInfo[];
    declared_scope_coverage?: DeclaredScopeCoverage;
    declared_scope_verdict?: DeclaredScopeCoverageVerdict;
  } = {},
): PlanEvidencePanel {
  return {
    doc_type: "plan",
    attestation: makeSummary(overrides.attestation),
    tasks: overrides.tasks ?? [makeTaskInfo()],
    declared_scope_coverage: overrides.declared_scope_coverage ?? RESOLVED_DECLARED_SCOPE,
    declared_scope_verdict: overrides.declared_scope_verdict ?? DECLARED_SCOPE_OK,
  };
}

describe("PlanAttestationPanel", () => {
  describe("happy path (AC-075-2)", () => {
    it("renders 'meets floor' when the plan clears the attestation floor", () => {
      render(<PlanAttestationPanel panel={makePlanPanel({ attestation: { meets_floor: true } })} />);
      expect(screen.getByText("meets floor")).toBeInTheDocument();
    });

    it("renders each task's title and its attested/evidence counts", () => {
      render(
        <PlanAttestationPanel
          panel={makePlanPanel({ tasks: [makeTaskInfo({ title: "Ship the widget", attestedCount: 3, evidenceCount: 5 })] })}
        />,
      );
      expect(screen.getByText("Ship the widget")).toBeInTheDocument();
      expect(screen.getByText("3 / 5 attested")).toBeInTheDocument();
    });

    it("renders zero_attested_tasks as its own labeled list", () => {
      render(
        <PlanAttestationPanel
          panel={makePlanPanel({
            attestation: { meets_floor: false, zero_attested_tasks: ["task-unattested"] },
            tasks: [makeTaskInfo({ slug: "task-unattested" })],
          })}
        />,
      );
      expect(screen.getByText("Tasks with unattested evidence:")).toBeInTheDocument();
      expect(screen.getByText("task-unattested")).toBeInTheDocument();
    });
  });

  describe("negative", () => {
    it("renders 'below floor' when the plan fails the attestation floor", () => {
      render(<PlanAttestationPanel panel={makePlanPanel({ attestation: { meets_floor: false } })} />);
      expect(screen.getByText("below floor")).toBeInTheDocument();
    });
  });

  describe("boundary (AC-075-3)", () => {
    it("renders an explicit empty state for a plan with zero task children", () => {
      render(
        <PlanAttestationPanel
          panel={makePlanPanel({ attestation: { total_evidence: 0, attested: 0, ratio: null }, tasks: [] })}
        />,
      );
      expect(screen.getByText("This plan has no task children yet.")).toBeInTheDocument();
    });

    it("renders an explicit 'not applicable' copy for a null ratio, never '0%'", () => {
      render(
        <PlanAttestationPanel
          panel={makePlanPanel({
            attestation: { total_evidence: 0, attested: 0, ratio: null, meets_floor: true },
            tasks: [makeTaskInfo({ evidenceCount: 0, attestedCount: 0 })],
          })}
        />,
      );
      expect(screen.getByText(/not applicable/)).toBeInTheDocument();
      expect(screen.queryByText("0%")).not.toBeInTheDocument();
    });
  });

  describe("regression", () => {
    it("renders a non-null ratio as a rounded percentage", () => {
      render(<PlanAttestationPanel panel={makePlanPanel({ attestation: { ratio: 0.5 } })} />);
      expect(screen.getByText("50%")).toBeInTheDocument();
    });
  });

  describe("ratio disabled render (AC-PCI-14)", () => {
    it("AC-PCI-14 ratio disabled render: renders the literal text 'ratio conjunct disabled' when min_ratio is null, and the rendered output contains neither '0%' nor '50%'", () => {
      render(
        <PlanAttestationPanel
          panel={makePlanPanel({
            // reason: ratio deliberately set to 0.75 (never 0 or 0.5) so this
            // test isolates the FLOOR field's own null-rendering — a coincidental
            // "50%"/"0%" from the UNRELATED attested-ratio field would make a
            // bare absence assertion ambiguous.
            attestation: { min_ratio: null, ratio: 0.75, meets_floor: true },
          })}
        />,
      );
      expect(screen.getByText("ratio conjunct disabled")).toBeInTheDocument();
      expect(screen.queryByText("0%")).not.toBeInTheDocument();
      expect(screen.queryByText("50%")).not.toBeInTheDocument();
    });

    it("AC-PCI-14 ratio disabled render: renders the numeric floor percentage when min_ratio is explicitly configured", () => {
      render(<PlanAttestationPanel panel={makePlanPanel({ attestation: { min_ratio: 0.3 } })} />);
      expect(screen.getByText(/30%/)).toBeInTheDocument();
      expect(screen.queryByText("ratio conjunct disabled")).not.toBeInTheDocument();
    });
  });

  describe("declared-scope conjunct (task-meets-floor-renders-pass-while-the-declared-scope-conjunct)", () => {
    it("HAPPY (control fixture, AC #4 bullet 2): a plan that genuinely meets BOTH conjuncts still renders 'meets floor', not turned red by this fix", () => {
      render(
        <PlanAttestationPanel
          panel={makePlanPanel({
            attestation: { meets_floor: true },
            declared_scope_coverage: { declared_acs: ["AC-1"], unattested_acs: [], scope_undeclared: false, meets_coverage: true },
            declared_scope_verdict: { ok: true },
          })}
        />,
      );
      expect(screen.getByText("meets floor")).toBeInTheDocument();
      expect(screen.queryByText("below floor")).not.toBeInTheDocument();
      expect(screen.queryByText("scope undeclared")).not.toBeInTheDocument();
    });

    it("NEGATIVE (the external oracle, mirrors AC-VS-6): a scope-undeclared fixture MUST NOT render as passing — renders 'scope undeclared', never 'meets floor'", () => {
      render(
        <PlanAttestationPanel
          panel={makePlanPanel({
            // The RATIO conjunct alone passes — this is exactly the defect:
            // meets_floor is true while the declared-scope conjunct has
            // nothing to audit at all.
            attestation: { meets_floor: true },
            declared_scope_coverage: { declared_acs: [], unattested_acs: [], scope_undeclared: true, meets_coverage: true },
            declared_scope_verdict: { notApplicable: true, reason: "scope-undeclared", referent: "plan-x" },
          })}
        />,
      );
      expect(screen.getByText("scope undeclared")).toBeInTheDocument();
      expect(screen.queryByText("meets floor")).not.toBeInTheDocument();
      // AC #2: the third state must not collapse into "below floor" either.
      expect(screen.queryByText("below floor")).not.toBeInTheDocument();
      expect(screen.getByLabelText("Declared scope undeclared notice")).toBeInTheDocument();
    });

    it("NEGATIVE: a declared-but-unattested scope renders 'below floor' even when the ratio conjunct alone passes, and lists the unattested declared AC ids", () => {
      render(
        <PlanAttestationPanel
          panel={makePlanPanel({
            attestation: { meets_floor: true },
            declared_scope_coverage: { declared_acs: ["AC-9"], unattested_acs: ["AC-9"], scope_undeclared: false, meets_coverage: false },
            declared_scope_verdict: { ok: false, unattested_acs: ["AC-9"] },
          })}
        />,
      );
      expect(screen.getByText("below floor")).toBeInTheDocument();
      expect(screen.queryByText("meets floor")).not.toBeInTheDocument();
      expect(screen.getByText("Declared-scope acceptance criteria with no attested evidence:")).toBeInTheDocument();
      expect(screen.getByText("AC-9")).toBeInTheDocument();
    });

    it("BOUNDARY: a failing ratio conjunct wins precedence over an undeclared scope — still renders 'below floor', not 'scope undeclared'", () => {
      render(
        <PlanAttestationPanel
          panel={makePlanPanel({
            attestation: { meets_floor: false },
            declared_scope_coverage: { declared_acs: [], unattested_acs: [], scope_undeclared: true, meets_coverage: true },
            declared_scope_verdict: { notApplicable: true, reason: "scope-undeclared", referent: "plan-x" },
          })}
        />,
      );
      expect(screen.getByText("below floor")).toBeInTheDocument();
      expect(screen.queryByText("scope undeclared")).not.toBeInTheDocument();
      // the undeclared-scope FACT is still surfaced independently of the badge's precedence pick.
      expect(screen.getByLabelText("Declared scope undeclared notice")).toBeInTheDocument();
    });
  });
});
