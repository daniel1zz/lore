/**
 * The `plan-close` predicate contract table (`PREDICATE_CONTRACTS`) and `lore gate --explain <checkpoint>`'s render
 * function (`renderPredicateContractsExplain`), spec-plan-close-predicates-measure-invariants-an-applicability §D7.
 *
 * Plan close measures two things since BR-1372 (the UAT verdict for a plan that opted in, and the milestone review), so
 * the table has two fields. Pure data/render-function tests only — no store, no IO — hence vitest.
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 *
 * @spec_ref spec-plan-close-predicates-measure-invariants-an-applicability §Design Decisions D7, AC-PCI-11;
 *   spec-lean-governance-batch-verbs-judgment-only-at-milestones BR-1372
 */

import { describe, it, expect } from "vitest";
import { PLAN_CLOSE_FIELD, MILESTONE_REVIEW_FIELD } from "../../../src/service/gate-predicates.js";
import {
  PREDICATE_CONTRACTS,
  renderPredicateContractsExplain,
  type PlanCloseField,
} from "../../../src/service/predicate-contracts.js";
import { checkpointRegistry, selectFailures, type GateContext } from "../../../src/service/checkpoint-registry.js";

const planClose = checkpointRegistry["plan-close"];
if (planClose === undefined) {
  throw new Error("plan-close checkpoint not registered — test fixture assumption broken");
}

// The TRUE source of "every field checkPlanClose can emit" — imported from gate-predicates.ts, never retyped.
const EMITTED_PLAN_CLOSE_FIELDS: readonly PlanCloseField[] = [PLAN_CLOSE_FIELD, MILESTONE_REVIEW_FIELD];

describe("PREDICATE_CONTRACTS — contract table exhaustiveness (AC-PCI-11)", () => {
  it("HAPPY: PREDICATE_CONTRACTS declares an entry for every field checkPlanClose can emit — contract table", () => {
    expect(Object.keys(PREDICATE_CONTRACTS).sort()).toEqual([...EMITTED_PLAN_CLOSE_FIELDS].sort());
  });

  it("NEGATIVE: every contract entry has non-empty invariant and measured text — contract table", () => {
    for (const field of EMITTED_PLAN_CLOSE_FIELDS) {
      expect(PREDICATE_CONTRACTS[field].invariant.trim().length, field).toBeGreaterThan(0);
      expect(PREDICATE_CONTRACTS[field].measured.trim().length, field).toBeGreaterThan(0);
    }
  });

  it("BOUNDARY: the milestone review contract records its known deltas, naming the rule — contract table", () => {
    const contract = PREDICATE_CONTRACTS[MILESTONE_REVIEW_FIELD];
    expect(contract.measured).toContain("BR-1372");
    expect(contract.known_false_pass.length).toBeGreaterThan(0);
    expect(contract.known_false_block.length).toBeGreaterThan(0);
    // the removed predicates have no entry any more
    expect(Object.keys(PREDICATE_CONTRACTS)).not.toContain("attestation-floor");
    expect(Object.keys(PREDICATE_CONTRACTS)).not.toContain("cited-rule-state");
    expect(Object.keys(PREDICATE_CONTRACTS)).not.toContain("assessment-freshness");
  });

  it("ERROR: renderPredicateContractsExplain for an unsupported checkpoint renders a graceful notice, never throws — contract table", () => {
    const text = renderPredicateContractsExplain("spec-create");
    expect(text).toContain("No predicate contract table is recorded");
    expect(text).toContain("spec-create");
  });

  it("STATE: renderPredicateContractsExplain('plan-close') prints every predicate's field/invariant/measured/deltas — contract table", () => {
    const text = renderPredicateContractsExplain("plan-close");
    for (const field of EMITTED_PLAN_CLOSE_FIELDS) {
      expect(text).toContain(`field: ${field}`);
      expect(text).toContain(PREDICATE_CONTRACTS[field].invariant);
    }
    expect(text).toContain("known_false_pass:");
    expect(text).toContain("known_false_block:");
  });

  it("REGRESSION: the milestone-review feeding pack names the rule, the state and the command that fixes it — contract table", () => {
    const ctx: GateContext = {
      targetIdOrSlug: "plan-example",
      milestoneReview: { state: "failed", failed: ["security"], reviewSlug: "knowledge-milestone-review-x" },
    };
    const text = planClose.feed(ctx, selectFailures(planClose.check(ctx)));
    expect(text).toContain("BR-1372");
    expect(text).toContain("security");
    expect(text).toContain("lore assess plan-example");
  });
});

describe("checkPlanClose — only the milestone review (and UAT when opted in) are measured", () => {
  it("a current passing review passes with nothing else measured", () => {
    const results = planClose.check({ targetIdOrSlug: "p", milestoneReview: { state: "pass", reviewSlug: "r" } });
    expect(results).toEqual([{ ok: true }]);
  });

  it("an unresolved review state refuses as absent, never as a pass", () => {
    const failures = selectFailures(planClose.check({ targetIdOrSlug: "p" }));
    expect(failures.map((f) => f.reason)).toEqual(["MILESTONE_REVIEW_MISSING"]);
    expect(failures[0]?.rule).toBe("BR-1372");
  });

  it("stale and failed reviews refuse with their own reasons", () => {
    const stale = selectFailures(
      planClose.check({ targetIdOrSlug: "p", milestoneReview: { state: "stale", reviewed: "a", current: "b", reviewSlug: "r" } }),
    );
    const failed = selectFailures(
      planClose.check({ targetIdOrSlug: "p", milestoneReview: { state: "failed", failed: ["regression"], reviewSlug: "r" } }),
    );
    expect(stale.map((f) => f.reason)).toEqual(["MILESTONE_REVIEW_STALE"]);
    expect(failed.map((f) => f.reason)).toEqual(["MILESTONE_REVIEW_FAILED"]);
  });

  it("a plan with no tasks is reported not-applicable (audited), never as a pass", () => {
    const results = planClose.check({ targetIdOrSlug: "p", milestoneReview: { state: "no-tasks" } });
    expect(results).toEqual([{ notApplicable: true, reason: "no-evidence", referent: "p" }]);
    expect(selectFailures(results)).toEqual([]);
  });

  it("requires_uat still applies: an opted-in plan with no UAT verdict is refused alongside the review", () => {
    const ctx: GateContext = {
      targetIdOrSlug: "p",
      requiresUat: true,
      uatVerdictPresent: false,
      milestoneReview: { state: "pass", reviewSlug: "r" },
    };
    const failures = selectFailures(planClose.check(ctx));
    expect(failures.map((f) => f.field)).toEqual([PLAN_CLOSE_FIELD]);
  });
});
