/**
 * Unit tests for the deterministic gate predicates that back `lore gate spec-create`
 * (a separate, not-yet-implemented CLI task). Pure functions only — no store, no IO,
 * no bun:sqlite — hence vitest, not `.bun.test`.
 *
 * Test philosophy: every test encodes a requirement from the IoC vertical-slice
 * tech-spec §4.1/§11, not what the code happens to do.
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / ERROR / REGRESSION.
 * STATE is intentionally absent — these are pure functions with no persisted or
 * mutable state to transition (see "STATE dimension" note at the bottom of this file).
 *
 * @spec_ref TECH-SPEC "Corpus-governed spec-production loop — IoC vertical slice" §4.1 §11
 */

import { describe, it, expect } from "vitest";
import {
  SPEC_KINDS,
  UNRESOLVED_DECLARED_SCOPE,
  type TaskAttestationInfo,
  type AcCoverageFact,
  type DeclaredScopeCoverage,
} from "@lore/core";
import {
  parentLegal,
  specKindValid,
  hasSkeleton,
  upstreamApproved,
  upstreamHasAcceptanceCriteria,
  attestationFloor,
  acCountMeetsFloor,
  NO_ACCEPTANCE_CRITERIA_REASON,
  AC_COUNT_FIELD,
  DEFAULT_MIN_ACS,
  specCitesLiveRulePredicate,
  SPEC_CITES_NO_LIVE_RULE_REASON,
  SPEC_CITATION_FIELD,
} from "../../../src/service/gate-predicates.js";

// Amendment A (task-t3-domain-doc-sync-requires-attribution-to-the-closing-
// plan, spec-plan-close-predicates-measure-invariants-an-applicability §D3) —
// `attestationFloor`'s `acCoverage` 4th parameter lost its `= []` default (a
// silent opt-out of the per-claimed-AC coverage conjunct). Every fixture below
// that declares no acceptance criteria at all passes this NAMED constant
// instead of a bare `[]`, so the intent ("this fixture never declared any
// ACs") is visible at each call site rather than implicit.
const NO_DECLARED_ACS: readonly AcCoverageFact[] = [];

// spec-declared-scope-attestation-contract-task-owned-ac-scope §Facts D4 —
// `attestationFloor` gained a REQUIRED 5th parameter, the DECLARED-scope
// coverage fact. Two named fixtures make each call site's intent explicit
// (a bare literal would read as incidental):
//   - SCOPE_DECLARED_AND_SATISFIED: every evidence-bearing task declared a scope
//     and every declared AC is attested — isolates the OTHER conjuncts;
//   - SCOPE_DECLARED_UNATTESTED: a declared AC with zero attested evidence — the
//     conjunct's own blocking shape.
// `UNRESOLVED_DECLARED_SCOPE` (@lore/core) covers the third case, "nobody
// declared anything", which yields the notApplicable(scope-undeclared) verdict.
const SCOPE_DECLARED_AND_SATISFIED: DeclaredScopeCoverage = {
  declared_acs: ["AC-D-1"],
  unattested_acs: [],
  scope_undeclared: false,
  meets_coverage: true,
};
const SCOPE_DECLARED_UNATTESTED: DeclaredScopeCoverage = {
  declared_acs: ["AC-D-1"],
  unattested_acs: ["AC-D-1"],
  scope_undeclared: false,
  meets_coverage: false,
};

describe("gate-predicates", () => {
  describe("parentLegal", () => {
    // HAPPY (BR-1: a spec takes no parent)
    it("passes when no parent is supplied (null)", () => {
      expect(parentLegal(null)).toEqual({ ok: true });
    });

    // BOUNDARY
    it("passes when parent is undefined", () => {
      expect(parentLegal(undefined)).toEqual({ ok: true });
    });

    // NEGATIVE (BR-2: a parent is refused and the reason names criterion citations)
    it("refuses a prd parent, naming `lore ac cite`, on field 'parent'", () => {
      expect(parentLegal({ type: "prd" })).toEqual({
        ok: false,
        reason: expect.stringContaining("lore ac cite"),
        field: "parent",
      });
    });

    // ERROR
    it.each(["task", "plan", "spec", "adr", "knowledge"])("refuses a %s parent too", (type) => {
      expect(parentLegal({ type })).toMatchObject({ ok: false, field: "parent" });
    });
  });

  describe("specKindValid", () => {
    // HAPPY
    it("passes for kind='tech'", () => {
      expect(specKindValid("tech")).toEqual({ ok: true });
    });

    // BOUNDARY — the key edge: undefined means "will default to feature at create time",
    // and MUST pass, not block.
    it("passes for kind=undefined (defaults to feature at create time, must not block)", () => {
      expect(specKindValid(undefined)).toEqual({ ok: true });
    });

    // NEGATIVE
    it("fails with INVALID_SPEC_KIND for an unrecognized kind string", () => {
      expect(specKindValid("x")).toEqual({ ok: false, reason: "INVALID_SPEC_KIND" });
    });

    // REGRESSION — every SSOT-declared kind passes, sourced from @lore/core, not hardcoded
    it("passes for every kind declared in the SPEC_KINDS SSOT", () => {
      for (const kind of SPEC_KINDS) {
        expect(specKindValid(kind)).toEqual({ ok: true });
      }
    });
  });

  describe("hasSkeleton", () => {
    // HAPPY
    it("passes when content contains a level-2 markdown heading", () => {
      expect(hasSkeleton("## Overview\nx")).toEqual({ ok: true });
    });

    // NEGATIVE
    it("fails with MISSING_SKELETON when content has no heading at all", () => {
      expect(hasSkeleton("no heading here")).toEqual({
        ok: false,
        reason: "MISSING_SKELETON",
      });
    });

    // BOUNDARY
    it("fails with MISSING_SKELETON for empty content", () => {
      expect(hasSkeleton("")).toEqual({ ok: false, reason: "MISSING_SKELETON" });
    });

    it("fails with MISSING_SKELETON when only a level-1 heading is present (not '## ')", () => {
      expect(hasSkeleton("# Title\nx")).toEqual({ ok: false, reason: "MISSING_SKELETON" });
    });

    it("passes when the '## ' heading is not on the first line", () => {
      expect(hasSkeleton("intro text\n## Overview\nx")).toEqual({ ok: true });
    });
  });

  describe("upstreamApproved", () => {
    // HAPPY
    it("passes when upstream.type matches expectedType and status is 'approved'", () => {
      expect(upstreamApproved({ type: "spec", status: "approved" }, "spec")).toEqual({
        ok: true,
      });
    });

    // NEGATIVE — draft and in-review both fail, same reason
    it("fails with UPSTREAM_NOT_APPROVED when status is 'draft'", () => {
      expect(upstreamApproved({ type: "spec", status: "draft" }, "spec")).toEqual({
        ok: false,
        reason: "UPSTREAM_NOT_APPROVED",
      });
    });

    it("fails with UPSTREAM_NOT_APPROVED when status is 'in-review'", () => {
      expect(upstreamApproved({ type: "spec", status: "in-review" }, "spec")).toEqual({
        ok: false,
        reason: "UPSTREAM_NOT_APPROVED",
      });
    });

    // BOUNDARY — the key decision this task made: "active" is a status further along
    // the lifecycle than "approved" but does NOT clear this gate, to stay identical to
    // evaluateReadiness's upstream_unapproved advisory (parentSpecStatus !== "approved").
    it("fails with UPSTREAM_NOT_APPROVED when status is 'active' (deliberately NOT accepted — matches evaluateReadiness)", () => {
      expect(upstreamApproved({ type: "spec", status: "active" }, "spec")).toEqual({
        ok: false,
        reason: "UPSTREAM_NOT_APPROVED",
      });
    });

    // ERROR — wrong type
    it("fails with UPSTREAM_WRONG_TYPE when upstream.type does not match expectedType", () => {
      expect(upstreamApproved({ type: "prd", status: "approved" }, "spec")).toEqual({
        ok: false,
        reason: "UPSTREAM_WRONG_TYPE",
      });
    });

    // BOUNDARY/ERROR — missing upstream
    it("fails with UPSTREAM_MISSING when upstream is null", () => {
      expect(upstreamApproved(null, "spec")).toEqual({ ok: false, reason: "UPSTREAM_MISSING" });
    });

    it("fails with UPSTREAM_MISSING when upstream is undefined", () => {
      expect(upstreamApproved(undefined, "spec")).toEqual({
        ok: false,
        reason: "UPSTREAM_MISSING",
      });
    });

    // STATE — same upstream doc transitioning draft -> approved flips the verdict,
    // exercising the predicate as a state-transition oracle even though the function
    // itself is pure (no mutation, just re-invoked with the "next" state).
    it("flips from NOT_APPROVED to ok as the same upstream's status transitions draft -> approved", () => {
      const draftUpstream = { type: "spec", status: "draft" };
      const approvedUpstream = { type: "spec", status: "approved" };
      expect(upstreamApproved(draftUpstream, "spec")).toEqual({
        ok: false,
        reason: "UPSTREAM_NOT_APPROVED",
      });
      expect(upstreamApproved(approvedUpstream, "spec")).toEqual({ ok: true });
    });

    // BOUNDARY — deleted_at omitted or explicitly null are equivalent to "not deleted".
    it("passes when deleted_at is omitted (backward-compatible default)", () => {
      expect(upstreamApproved({ type: "spec", status: "approved" }, "spec")).toEqual({
        ok: true,
      });
    });

    it("passes when deleted_at is explicitly null", () => {
      expect(
        upstreamApproved({ type: "spec", status: "approved", deleted_at: null }, "spec"),
      ).toEqual({ ok: true });
    });

    // NEGATIVE (adversarial-review FIX 3) — a soft-deleted upstream fails EVEN THOUGH
    // its status still reads "approved". `softDelete` never touches `status`, so
    // without this check a soft-deleted approved spec would silently keep passing
    // this gate forever.
    it("fails with UPSTREAM_DELETED when deleted_at is set, even though status is 'approved'", () => {
      expect(
        upstreamApproved(
          { type: "spec", status: "approved", deleted_at: "2026-07-09T00:00:00.000Z" },
          "spec",
        ),
      ).toEqual({ ok: false, reason: "UPSTREAM_DELETED" });
    });

    // BOUNDARY — deleted_at is checked AFTER the type check: a wrong-type upstream
    // still reports UPSTREAM_WRONG_TYPE even if it happens to carry a deleted_at.
    it("still reports UPSTREAM_WRONG_TYPE (not UPSTREAM_DELETED) when type mismatches and deleted_at is set", () => {
      expect(
        upstreamApproved(
          { type: "prd", status: "approved", deleted_at: "2026-07-09T00:00:00.000Z" },
          "spec",
        ),
      ).toEqual({ ok: false, reason: "UPSTREAM_WRONG_TYPE" });
    });

    // STATE — soft-deleting an otherwise-passing upstream flips the verdict from ok
    // to UPSTREAM_DELETED, mirroring the draft->approved transition test above.
    it("flips from ok to UPSTREAM_DELETED as the same upstream transitions to soft-deleted", () => {
      const liveUpstream = { type: "spec", status: "approved", deleted_at: null };
      const deletedUpstream = {
        type: "spec",
        status: "approved",
        deleted_at: "2026-07-09T00:00:00.000Z",
      };
      expect(upstreamApproved(liveUpstream, "spec")).toEqual({ ok: true });
      expect(upstreamApproved(deletedUpstream, "spec")).toEqual({
        ok: false,
        reason: "UPSTREAM_DELETED",
      });
    });
  });

  describe("upstreamHasAcceptanceCriteria", () => {
    // HAPPY
    it("passes when extra.acceptance_criteria has >= 1 valid entry", () => {
      expect(
        upstreamHasAcceptanceCriteria({
          extra: {
            acceptance_criteria: [
              {
                id: "AC-GATE-1",
                statement: "upstream spec has at least one declared AC",
                verify: { mode: "human" },
              },
            ],
          },
        }),
      ).toEqual({ ok: true });
    });

    // NEGATIVE — declared but empty array
    it("fails with UPSTREAM_NO_AC when extra.acceptance_criteria is an empty array", () => {
      expect(upstreamHasAcceptanceCriteria({ extra: { acceptance_criteria: [] } })).toEqual({
        ok: false,
        reason: "UPSTREAM_NO_AC",
      });
    });

    // BOUNDARY — field entirely absent from extra
    it("fails with UPSTREAM_NO_AC when extra.acceptance_criteria is absent", () => {
      expect(upstreamHasAcceptanceCriteria({ extra: {} })).toEqual({
        ok: false,
        reason: "UPSTREAM_NO_AC",
      });
    });

    // ERROR — malformed shape fails schema validation, must not throw
    it("fails with UPSTREAM_NO_AC when extra.acceptance_criteria fails schema validation (not an array)", () => {
      expect(
        upstreamHasAcceptanceCriteria({ extra: { acceptance_criteria: "not-an-array" } }),
      ).toEqual({ ok: false, reason: "UPSTREAM_NO_AC" });
    });

    // BOUNDARY/ERROR — missing upstream spec entirely (no doc resolved at all)
    it("fails with UPSTREAM_NO_AC when upstreamSpec is null", () => {
      expect(upstreamHasAcceptanceCriteria(null)).toEqual({
        ok: false,
        reason: "UPSTREAM_NO_AC",
      });
    });

    it("fails with UPSTREAM_NO_AC when upstreamSpec is undefined", () => {
      expect(upstreamHasAcceptanceCriteria(undefined)).toEqual({
        ok: false,
        reason: "UPSTREAM_NO_AC",
      });
    });

    // STATE — same spec transitioning from 0 AC to 1 declared AC flips the verdict
    it("flips from UPSTREAM_NO_AC to ok as the same spec's declared AC count goes 0 -> 1", () => {
      const specWithNoAc = { extra: { acceptance_criteria: [] } };
      const specWithOneAc = {
        extra: {
          acceptance_criteria: [
            { id: "AC-GATE-2", statement: "x", verify: { mode: "human" } },
          ],
        },
      };
      expect(upstreamHasAcceptanceCriteria(specWithNoAc)).toEqual({
        ok: false,
        reason: "UPSTREAM_NO_AC",
      });
      expect(upstreamHasAcceptanceCriteria(specWithOneAc)).toEqual({ ok: true });
    });

    // REGRESSION — stays SSOT with AcService's extractCriteria: a spec whose
    // acceptance_criteria entries are individually well-formed per
    // acceptanceCriterionSchema (script mode) is recognized identically to human mode.
    it("passes for a script-mode AC entry, matching AcService's own AC counting", () => {
      expect(
        upstreamHasAcceptanceCriteria({
          extra: {
            acceptance_criteria: [
              {
                id: "AC-GATE-3",
                statement: "script mode AC",
                verify: { mode: "script", oracle: "test", command: "bunx vitest run x" },
              },
            ],
          },
        }),
      ).toEqual({ ok: true });
    });
  });

  // STATE dimension (parentLegal / specKindValid / hasSkeleton): N/A. Those three
  // predicates are pure functions of their arguments with no persisted or mutable
  // state to transition. Exempt per ~/.claude/skills/test/ (pure-function modules
  // carry no STATE dimension). upstreamApproved / upstreamHasAcceptanceCriteria DO
  // get STATE-dimension coverage above (same upstream doc re-checked across a
  // status/AC-count transition), since they gate a corpus doc's own lifecycle.

  // ─── attestationFloor — SPEC-075 AC-075-11 parity suite ────────────────────
  //
  // gate-predicates.ts::attestationFloor is now a thin delegate over
  // @lore/core's deriveAttestationSummary (evidence-panel.ts, SPEC-075 §Design
  // Decisions D6). This suite pins BYTE-IDENTICAL gate behavior across both of
  // attestationFloor's independent failure conditions, plus the vacuous-pass and
  // boundary-ratio cases — the same scenarios attestation-floor.test.ts already
  // exercises end-to-end through CorpusService, now at the pure-predicate layer.
  describe("attestationFloor — AC-075-11: delegates to deriveAttestationSummary, byte-identical gate behavior", () => {
    function taskInfo(overrides: Partial<TaskAttestationInfo>): TaskAttestationInfo {
      return { slug: "task-x", title: "Task X", evidenceCount: 0, attestedCount: 0, ...overrides };
    }

    // REGRESSION (spec-declared-scope-attestation-contract-task-owned-ac-scope
    // §Facts D5 SUPERSEDES AC-075-11 condition 1) — the per-task zero-attested
    // condition is DEMOTED to a reported fact: this exact fixture, which used to
    // be `{ok: false}`, now PASSES. Inverted in the same slice that demoted it;
    // leaving the old expectation would re-legalize the per-task proxy.
    it("D5 supersedes AC-075-11 condition 1: a zero-attested task no longer blocks when the ratio and the declared scope are satisfied", () => {
      // Task A: 10 attested. Task B: 1 self-reported, 0 attested. Ratio ~0.91 (>= 0.5).
      const tasks: TaskAttestationInfo[] = [
        taskInfo({ slug: "task-a", evidenceCount: 10, attestedCount: 10 }),
        taskInfo({ slug: "task-b", evidenceCount: 1, attestedCount: 0 }),
      ];
      expect(attestationFloor(tasks, 0.5, "plan-x", NO_DECLARED_ACS, SCOPE_DECLARED_AND_SATISFIED)).toEqual({
        ok: true,
      });
    });

    it("AC-075-11: a below-floor ratio blocks even when every task has an attested entry", () => {
      // Task A: 4 entries, 1 attested. Task B: 1 entry, 1 attested. Ratio 5/2=0.4 < 0.5.
      // Neither task individually has zero attested entries and the declared scope
      // is satisfied — ONLY the ratio conjunct trips this.
      const tasks: TaskAttestationInfo[] = [
        taskInfo({ slug: "task-a", evidenceCount: 4, attestedCount: 1 }),
        taskInfo({ slug: "task-b", evidenceCount: 1, attestedCount: 1 }),
      ];
      expect(attestationFloor(tasks, 0.5, "plan-x", NO_DECLARED_ACS, SCOPE_DECLARED_AND_SATISFIED)).toEqual({
        ok: false,
        reason: "ATTESTATION_FLOOR_NOT_MET",
        field: "attestation-floor",
      });
    });

    // AC-VS-6 (predicate layer) — the coverage conjunct's three verdicts, keyed
    // ONLY on the declared-scope fact: an unattested DECLARED id blocks; an
    // undeclared scope is notApplicable, never a pass.
    it("AC-VS-6: an unattested DECLARED-scope AC blocks, and an UNDECLARED scope is notApplicable(scope-undeclared) rather than a pass", () => {
      const tasks: TaskAttestationInfo[] = [taskInfo({ slug: "task-a", evidenceCount: 2, attestedCount: 2 })];

      expect(attestationFloor(tasks, null, "plan-x", NO_DECLARED_ACS, SCOPE_DECLARED_UNATTESTED)).toEqual({
        ok: false,
        reason: "ATTESTATION_FLOOR_NOT_MET",
        field: "attestation-floor",
      });

      const undeclared = attestationFloor(tasks, null, "plan-x", NO_DECLARED_ACS, UNRESOLVED_DECLARED_SCOPE);
      expect(undeclared).toEqual({
        notApplicable: true,
        reason: "scope-undeclared",
        referent: "plan-x",
      });
      expect("ok" in undeclared).toBe(false);
    });

    // BOUNDARY (precedence) — a MEASURED ratio violation outranks the
    // applicability verdict: an undeclared scope must never suppress a real
    // violation (a new vacuous pass would be the regression).
    it("AC-VS-6 precedence: a below-floor ratio still blocks even when the scope is undeclared", () => {
      const tasks: TaskAttestationInfo[] = [taskInfo({ slug: "task-a", evidenceCount: 4, attestedCount: 1 })];
      expect(attestationFloor(tasks, 0.5, "plan-x", NO_DECLARED_ACS, UNRESOLVED_DECLARED_SCOPE)).toEqual({
        ok: false,
        reason: "ATTESTATION_FLOOR_NOT_MET",
        field: "attestation-floor",
      });
    });

    // reason: task-t1-applicability-verdict-in-the-predicate-s-own-type-both
    // (spec-plan-close-predicates-measure-invariants-an-applicability §Design
    // Decisions D1/D3) — a plan with NO evidence at all is no longer a SILENT
    // vacuous `{ok: true}` pass; it is a `PredicateNotApplicable` value naming
    // the plan referent, so `GateEnforcer.enforce` can surface it as an
    // advisory + audit row instead of it disappearing into an
    // indistinguishable-from-"everything attested" pass. Updated in the SAME
    // slice that changed the behavior — a stale assertion here would silently
    // re-legalize the old shape.
    it("AC-PCI: a vacuous plan (no evidence anywhere) is notApplicable, never a silent pass", () => {
      expect(attestationFloor(undefined, 0.5, "plan-x", NO_DECLARED_ACS, SCOPE_DECLARED_AND_SATISFIED)).toEqual({
        notApplicable: true,
        reason: "no-evidence",
        referent: "plan-x",
      });
      expect(attestationFloor([], 0.9, "plan-y", NO_DECLARED_ACS, SCOPE_DECLARED_AND_SATISFIED)).toEqual({
        notApplicable: true,
        reason: "no-evidence",
        referent: "plan-y",
      });
      expect(attestationFloor([taskInfo({ evidenceCount: 0, attestedCount: 0 })], 1, "plan-z", NO_DECLARED_ACS, SCOPE_DECLARED_AND_SATISFIED)).toEqual({
        notApplicable: true,
        reason: "no-evidence",
        referent: "plan-z",
      });
    });

    it("AC-075-11: a ratio exactly equal to minRatio passes (boundary, >= not >)", () => {
      const tasks: TaskAttestationInfo[] = [taskInfo({ slug: "task-a", evidenceCount: 2, attestedCount: 1 })];
      expect(attestationFloor(tasks, 0.5, "plan-x", NO_DECLARED_ACS, SCOPE_DECLARED_AND_SATISFIED)).toEqual({ ok: true });
    });

    it("AC-075-11: fully attested evidence at/above the floor with no zero-attested task passes", () => {
      const tasks: TaskAttestationInfo[] = [
        taskInfo({ slug: "task-a", evidenceCount: 2, attestedCount: 2 }),
        taskInfo({ slug: "task-b", evidenceCount: 1, attestedCount: 1 }),
      ];
      expect(attestationFloor(tasks, 0.5, "plan-x", NO_DECLARED_ACS, SCOPE_DECLARED_AND_SATISFIED)).toEqual({ ok: true });
    });

    // ERROR (type-level, Amendment A) — `acCoverage` is a REQUIRED 4th
    // positional parameter (no default) as of this task: a call omitting it
    // must fail `tsc`, proving the requirement is STRUCTURAL, not
    // conventional (a reviewer remembering to pass it). A runtime `it()`
    // cannot express "this must not compile" — JS has no arity enforcement,
    // so actually INVOKING a call missing a required arg would throw at
    // runtime (`deriveAttestationSummary`'s `acCoverage.filter` on
    // `undefined`) rather than prove anything about the type system. This
    // repo's own precedent for a type-level invariant checked exclusively by
    // `bun run typecheck` is `postinstall.test.ts`'s `@ts-expect-error`
    // fixture — same pattern here, via a NEVER-INVOKED function so the
    // offending line is type-checked but never executed.
    it("ERROR (type-level): a call omitting acCoverage must not compile — structural requirement, not conventional", () => {
      expect(typeof typeAssertion_attestationFloorRequiresAcCoverage).toBe("function");
    });
  });

  /**
   * Intentionally NEVER INVOKED — see the "ERROR (type-level)" test above.
   * Its sole purpose is for `bun run typecheck` (the primary oracle for
   * Amendment A, task-t3-domain-doc-sync-requires-attribution-to-the-closing-
   * plan) to fail on the line below if `acCoverage` ever regains a default
   * value: the `@ts-expect-error` directive itself becomes a compile error
   * ("Unused '@ts-expect-error' directive") the moment the call it annotates
   * stops being a type error.
   */
  function typeAssertion_attestationFloorRequiresAcCoverage(): void {
    // @ts-expect-error — acCoverage is REQUIRED (4th positional parameter, no
    // default); a call omitting it must not compile.
    attestationFloor([], 0.5, "plan-x");
  }

  // task-spec-promote-base-1-ac-rule-is-spec-kind-agnostic-spec-080 (option (a),
  // profile-aware AC floor) — spec-promote's base predicate, replacing the old
  // unconditional `count > 0` check `checkSpecPromote` used to inline.
  describe("acCountMeetsFloor", () => {
    // HAPPY — a profile explicitly waiving the floor (min_acs: 0) passes with zero ACs
    it("passes with zero declared ACs when the profile's min_acs is 0", () => {
      expect(acCountMeetsFloor(0, { min_acs: 0 })).toEqual({ ok: true });
    });

    // HAPPY — a profile with an oracle floor but no min_acs still defaults to 1, satisfied
    it("passes when count meets the default floor of 1 and the profile declares no min_acs", () => {
      expect(acCountMeetsFloor(1, { required_oracles: ["e2e"] })).toEqual({ ok: true });
    });

    // NEGATIVE — no profile at all (kind unconfigured) still requires >= 1 (REGRESSION target)
    it("fails with zero ACs and no profile at all (unconditional pre-existing default)", () => {
      expect(acCountMeetsFloor(0, null)).toEqual({
        ok: false,
        reason: NO_ACCEPTANCE_CRITERIA_REASON,
        field: AC_COUNT_FIELD,
      });
      expect(acCountMeetsFloor(0, undefined)).toEqual({
        ok: false,
        reason: NO_ACCEPTANCE_CRITERIA_REASON,
        field: AC_COUNT_FIELD,
      });
    });

    // NEGATIVE — a profile present but declaring no min_acs still requires >= 1
    it("fails with zero ACs when the profile omits min_acs (kind with no knob)", () => {
      expect(acCountMeetsFloor(0, { required_oracles: ["test"] })).toEqual({
        ok: false,
        reason: NO_ACCEPTANCE_CRITERIA_REASON,
        field: AC_COUNT_FIELD,
      });
    });

    // BOUNDARY — a configured min_acs is exactly met
    it("passes when count exactly equals a configured min_acs > 1", () => {
      expect(acCountMeetsFloor(2, { min_acs: 2 })).toEqual({ ok: true });
    });

    // BOUNDARY — one short of a configured min_acs fails
    it("fails when count is exactly one short of a configured min_acs", () => {
      expect(acCountMeetsFloor(1, { min_acs: 2 })).toEqual({
        ok: false,
        reason: NO_ACCEPTANCE_CRITERIA_REASON,
        field: AC_COUNT_FIELD,
      });
    });

    // BOUNDARY — DEFAULT_MIN_ACS is the literal 1, never a magic number re-derived elsewhere
    it("DEFAULT_MIN_ACS is 1", () => {
      expect(DEFAULT_MIN_ACS).toBe(1);
    });

    // REGRESSION — feature/tech/design kinds (no min_acs ever declared for them in
    // this codebase's shipped template) keep the exact pre-existing ">= 1" behavior
    // byte-compatible: 0 ACs blocks, 1 AC passes, regardless of which oracle floor
    // the profile itself declares.
    it("REGRESSION: a feature-kind-shaped profile (required_oracles: ['test'], no min_acs) blocks 0 ACs and passes 1", () => {
      const featureProfile = { required_oracles: ["test" as const] };
      expect(acCountMeetsFloor(0, featureProfile)).toEqual({
        ok: false,
        reason: NO_ACCEPTANCE_CRITERIA_REASON,
        field: AC_COUNT_FIELD,
      });
      expect(acCountMeetsFloor(1, featureProfile)).toEqual({ ok: true });
    });
  });
});

// ─── specCitesLiveRulePredicate (BR-1007, issue #137) ───────────────────────────

describe("specCitesLiveRulePredicate — spec-promote's citation parity predicate", () => {
  it("HAPPY: a measured `true` passes", () => {
    expect(specCitesLiveRulePredicate(true)).toEqual({ ok: true });
  });

  it("NEGATIVE: a measured `false` fails with the dedicated reason and field", () => {
    expect(specCitesLiveRulePredicate(false)).toEqual({
      ok: false,
      reason: SPEC_CITES_NO_LIVE_RULE_REASON,
      field: SPEC_CITATION_FIELD,
    });
  });

  it("BOUNDARY: `undefined` (the caller did not measure) is NOT evaluated — passes, and is distinct from `false`", () => {
    expect(specCitesLiveRulePredicate(undefined)).toEqual({ ok: true });
    expect(specCitesLiveRulePredicate(undefined)).not.toEqual(specCitesLiveRulePredicate(false));
  });

  it("REGRESSION: the failure reason/field are the stable machine-readable literals", () => {
    expect(SPEC_CITES_NO_LIVE_RULE_REASON).toBe("SPEC_CITES_NO_LIVE_RULE");
    expect(SPEC_CITATION_FIELD).toBe("acceptance-criteria-cites");
  });
});
