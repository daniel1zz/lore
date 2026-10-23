/**
 * Unit tests for `verifyReachability` (gate-predicates.ts) and `plan-promote`'s
 * reachability EARLY-WARNING advisory (`planPromoteReachabilityAdvisory`,
 * checkpoint-registry.ts) — spec-verify-reachability-plan-promote-early-warning
 * §Scope M1 / §Design Decisions D1/D2.
 *
 * `verifyReachability` is a pure PREDICTION of whether `lore verify` can
 * structurally run against a plan (the SAME two preconditions
 * `VerifyRunnerService.verifyPlan` itself enforces: an ancestor spec must
 * resolve, and it must declare >= 1 script-mode acceptance criterion).
 * `planPromoteReachabilityAdvisory` surfaces that prediction at plan-promote
 * time as a SEPARATE, non-blocking output from `checkPlanPromote`'s own
 * verdict — D1 requires the advisory to NEVER change the gate's pass/fail
 * outcome, which this suite asserts directly by comparing
 * `isCheckpointBlocked` across a reachable/unreachable ctx pair that is
 * otherwise identical.
 *
 * Pure functions only — no store, no IO, no bun:sqlite — hence vitest.
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / STATE / REGRESSION.
 *
 * @spec_ref spec-verify-reachability-plan-promote-early-warning §Scope M1,
 *   §Acceptance Criteria AC-VRW-1
 */

import { describe, it, expect } from "vitest";
import { verifyReachability } from "../../../src/service/gate-predicates.js";
import {
  checkpointRegistry,
  isCheckpointBlocked,
  planPromoteReachabilityAdvisory,
  type GateContext,
} from "../../../src/service/checkpoint-registry.js";

const checkPlanPromote = checkpointRegistry["plan-promote"];
if (checkPlanPromote === undefined) {
  throw new Error("plan-promote checkpoint not registered — test fixture assumption broken");
}

describe("verifyReachability", () => {
  // ─── Truth table (>= 4 cases) ────────────────────────────────────────────

  // NEGATIVE — no spec-tier ancestor at all.
  it("parent-not-spec: planParentType null → unreachable, why 'parent-not-spec'", () => {
    expect(verifyReachability(null, undefined)).toEqual({
      reachable: false,
      why: "parent-not-spec",
    });
  });

  // NEGATIVE — ancestor resolved but isn't a spec (e.g. a prd-parented plan).
  it("parent-not-spec: planParentType 'prd' (with script ACs available) → unreachable, why 'parent-not-spec'", () => {
    expect(verifyReachability("prd", 5)).toEqual({
      reachable: false,
      why: "parent-not-spec",
    });
  });

  // NEGATIVE — spec ancestor, explicitly zero script-mode ACs.
  it("no-script-acs: planParentType 'spec' with parentSpecScriptAcCount=0 → unreachable, why 'no-script-acs'", () => {
    expect(verifyReachability("spec", 0)).toEqual({
      reachable: false,
      why: "no-script-acs",
    });
  });

  // BOUNDARY — zero-AC case expressed as `undefined` (caller never resolved any
  // criteria at all) MUST be treated identically to the explicit `0` case.
  it("BOUNDARY: planParentType 'spec' with parentSpecScriptAcCount=undefined → unreachable, why 'no-script-acs'", () => {
    expect(verifyReachability("spec", undefined)).toEqual({
      reachable: false,
      why: "no-script-acs",
    });
  });

  // HAPPY — reachable.
  it("reachable: planParentType 'spec' with >= 1 script AC → reachable, why null", () => {
    expect(verifyReachability("spec", 3)).toEqual({ reachable: true, why: null });
  });

  it("reachable: the boundary count of exactly 1 script AC is sufficient", () => {
    expect(verifyReachability("spec", 1)).toEqual({ reachable: true, why: null });
  });

  // NEGATIVE — anything other than the literal "spec" string is "parent-not-spec",
  // no partial credit for other doc types.
  it("parent-not-spec: an arbitrary non-spec doc type is unreachable, why 'parent-not-spec'", () => {
    expect(verifyReachability("task", 3)).toEqual({
      reachable: false,
      why: "parent-not-spec",
    });
  });
});

describe("planPromoteReachabilityAdvisory", () => {
  // NEGATIVE (presence) — no spec-tier ancestor at all.
  it("returns a non-null advisory string when the plan has no spec-tier ancestor", () => {
    const ctx: GateContext = { hasSpecParent: false, targetIdOrSlug: "plan-x" };
    const advisory = planPromoteReachabilityAdvisory(ctx);
    expect(advisory).not.toBeNull();
    expect(advisory).toContain("lore verify");
    expect(advisory).toContain("plan-x");
  });

  // NEGATIVE (presence) — spec ancestor with zero script-mode ACs.
  it("returns a non-null advisory string when the ancestor spec has zero script-mode ACs", () => {
    const ctx: GateContext = {
      hasSpecParent: true,
      parentSpecScriptAcCount: 0,
      targetIdOrSlug: "plan-y",
    };
    const advisory = planPromoteReachabilityAdvisory(ctx);
    expect(advisory).not.toBeNull();
    // names the milestone review and the one real option
    expect(advisory).toContain("script-mode acceptance criterion");
    expect(advisory).toContain("milestone review");
    expect(advisory).not.toContain("exempt");
  });

  // HAPPY (absence) — reachable plan gets NO advisory.
  it("returns null when the plan is reachable (spec ancestor with >= 1 script AC)", () => {
    const ctx: GateContext = {
      hasSpecParent: true,
      parentSpecScriptAcCount: 2,
      targetIdOrSlug: "plan-z",
    };
    expect(planPromoteReachabilityAdvisory(ctx)).toBeNull();
  });

  // BOUNDARY (absence) — the caller never populated `hasSpecParent`/`parentSpecScriptAcCount`
  // at all (a checkpoint context built before this spec landed) — still resolves
  // deterministically (unreachable, since absent hasSpecParent reads as "not spec").
  it("returns a non-null advisory for a ctx that never populated the new reachability fields", () => {
    const ctx: GateContext = { targetIdOrSlug: "plan-legacy" };
    expect(planPromoteReachabilityAdvisory(ctx)).not.toBeNull();
  });
});

describe("plan-promote advisory NEVER changes the gate verdict (D1)", () => {
  // STATE — same upstream-approval/AC-declared facts, only reachability differs;
  // the checkpoint's pass/fail verdict (isCheckpointBlocked) must be IDENTICAL.
  const approvedSpecWithAc = {
    type: "spec",
    status: "approved",
    extra: {
      acceptance_criteria: [
        {
          id: "AC-1",
          statement: "the parser round-trips every fixture file",
          verify: { mode: "script" as const, oracle: "test" as const, command: "bun test parser.test.ts" },
        },
      ],
    },
    deleted_at: null,
  };

  it("verdict is PASS in both the reachable and unreachable branch (upstream spec approved + has AC)", () => {
    const reachableCtx: GateContext = {
      hasSpecParent: true,
      parentSpec: approvedSpecWithAc,
      parentSpecScriptAcCount: 2,
      requiresUatEnabled: false,
    };
    const unreachableCtx: GateContext = {
      hasSpecParent: true,
      parentSpec: approvedSpecWithAc,
      parentSpecScriptAcCount: 0,
      requiresUatEnabled: false,
    };

    const reachableBlocked = isCheckpointBlocked(checkPlanPromote.check(reachableCtx));
    const unreachableBlocked = isCheckpointBlocked(checkPlanPromote.check(unreachableCtx));

    expect(reachableBlocked).toBe(false);
    expect(unreachableBlocked).toBe(false);
    expect(reachableBlocked).toBe(unreachableBlocked);

    // Sanity: the advisory itself DOES differ (reachable → null, unreachable → string)
    // even though the verdict above does not.
    expect(planPromoteReachabilityAdvisory(reachableCtx)).toBeNull();
    expect(planPromoteReachabilityAdvisory(unreachableCtx)).not.toBeNull();
  });

  it("verdict is BLOCKED in both branches (upstream spec not approved), regardless of reachability", () => {
    const unapprovedSpec = { ...approvedSpecWithAc, status: "draft" };
    const reachableCtx: GateContext = {
      hasSpecParent: true,
      parentSpec: unapprovedSpec,
      parentSpecScriptAcCount: 2,
      requiresUatEnabled: false,
    };
    const unreachableCtx: GateContext = {
      hasSpecParent: true,
      parentSpec: unapprovedSpec,
      parentSpecScriptAcCount: 0,
      requiresUatEnabled: false,
    };

    const reachableBlocked = isCheckpointBlocked(checkPlanPromote.check(reachableCtx));
    const unreachableBlocked = isCheckpointBlocked(checkPlanPromote.check(unreachableCtx));

    expect(reachableBlocked).toBe(true);
    expect(unreachableBlocked).toBe(true);
    expect(reachableBlocked).toBe(unreachableBlocked);
  });

  // REGRESSION — no spec-tier ancestor at all: `checkPlanPromote`'s own
  // pre-existing short-circuit (vacuous PASS) is unaffected by this spec —
  // the advisory still fires (unreachable) alongside a PASS verdict.
  it("REGRESSION: a plan with no spec-tier ancestor stays a vacuous PASS at plan-promote, advisory still fires", () => {
    const ctx: GateContext = { hasSpecParent: false };
    expect(isCheckpointBlocked(checkPlanPromote.check(ctx))).toBe(false);
    expect(planPromoteReachabilityAdvisory(ctx)).not.toBeNull();
  });
});
