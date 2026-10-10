/**
 * RED suite (task-t4-plan-close-predicate-contract-table-lore-gate-explain) for
 * spec-plan-close-predicates-measure-invariants-an-applicability §D7 — the
 * `plan-close` predicate contract table (`PREDICATE_CONTRACTS`) and
 * `lore gate --explain <checkpoint>`'s render function
 * (`renderPredicateContractsExplain`), plus Amendment A's fix to
 * `checkPlanClose`'s `ctx.planClaimedAcCoverage ?? []` silent fallback
 * (checkpoint-registry.ts).
 *
 * Pure data/render-function tests only — no store, no IO, no `bun:sqlite` —
 * hence vitest. `checkpointRegistry` is imported to exercise `checkPlanClose`/
 * `feedPlanClose` (both module-private, reached only via the registry's
 * `check`/`feed` fields) with constructed `GateContext` fixtures, mirroring
 * `predicate-applicability.test.ts`'s established harness shape.
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION,
 * split across two top-level concerns:
 *   - "contract table" (AC-PCI-11's pinned test-name substring) — exhaustiveness
 *     + `--explain` rendering.
 *   - "Amendment A" (deliberately NOT matching "contract table") — the
 *     undefined-vs-explicit-[] divergence in `checkPlanClose`.
 *
 * @spec_ref spec-plan-close-predicates-measure-invariants-an-applicability
 *   §Design Decisions D7, §Acceptance Criteria AC-PCI-11; Amendment A
 *   (task-t4-plan-close-predicate-contract-table-lore-gate-explain)
 */

import { describe, it, expect } from "vitest";
import type { DeclaredScopeCoverage } from "@lore/core";
import {
  PLAN_CLOSE_FIELD,
  ATTESTATION_FLOOR_FIELD,
  ATTESTATION_SCOPE_UNDECLARED_FIELD,
  ATTESTATION_EXEMPT_KIND_FIELD,
  CITED_RULE_STATE_FIELD,
  ASSESSMENT_FRESHNESS_FIELD,
} from "../../../src/service/gate-predicates.js";
import {
  PREDICATE_CONTRACTS,
  renderPredicateContractsExplain,
  type PlanCloseField,
} from "../../../src/service/predicate-contracts.js";
import {
  checkpointRegistry,
  selectFailures,
  type GateContext,
} from "../../../src/service/checkpoint-registry.js";

const planClose = checkpointRegistry["plan-close"];
if (planClose === undefined) {
  throw new Error("plan-close checkpoint not registered — test fixture assumption broken");
}

// The TRUE source of "every field checkPlanClose can emit" — imported directly
// from gate-predicates.ts (never hand-retyped string literals), so this array
// can only drift from PREDICATE_CONTRACTS's key set, never from the predicates
// that actually emit these fields.
const EMITTED_PLAN_CLOSE_FIELDS: readonly PlanCloseField[] = [
  PLAN_CLOSE_FIELD,
  ATTESTATION_FLOOR_FIELD,
  // task-plan-close-must-block-when-the-coverage-conjunct-is-scope — an
  // undeclared scope carrying evidence is a DENIAL with its own field, so the
  // contract table owes it an entry.
  ATTESTATION_SCOPE_UNDECLARED_FIELD,
  ATTESTATION_EXEMPT_KIND_FIELD,
  CITED_RULE_STATE_FIELD,
  ASSESSMENT_FRESHNESS_FIELD,
];

// ─── contract table (AC-PCI-11) ─────────────────────────────────────────────

describe("PREDICATE_CONTRACTS — contract table exhaustiveness (AC-PCI-11)", () => {
  // HAPPY — the pinned contract: the table's key set equals the emitted-field
  // constants, compared PROGRAMMATICALLY (both sides sourced from the same
  // gate-predicates.ts constants) rather than against a hand-written list.
  it("HAPPY: PREDICATE_CONTRACTS declares an entry for every field checkPlanClose can emit — contract table", () => {
    expect(Object.keys(PREDICATE_CONTRACTS).sort()).toEqual(
      [...EMITTED_PLAN_CLOSE_FIELDS].sort(),
    );
  });

  // NEGATIVE — every entry carries non-empty invariant/measured prose (a
  // contract with blank prose would be a silent placeholder, not a contract).
  it("NEGATIVE: every contract entry has non-empty invariant and measured text — contract table", () => {
    for (const field of EMITTED_PLAN_CLOSE_FIELDS) {
      const contract = PREDICATE_CONTRACTS[field];
      expect(contract.invariant.length).toBeGreaterThan(0);
      expect(contract.measured.length).toBeGreaterThan(0);
    }
  });

  // BOUNDARY — the two predicates the task body names explicit known deltas
  // for carry them; the other three (no deltas recorded in the task body)
  // carry EMPTY arrays, meaning "none recorded", never "none exist".
  it("BOUNDARY: attestation-floor and cited-rule-state carry their documented known deltas — contract table", () => {
    const floor = PREDICATE_CONTRACTS[ATTESTATION_FLOOR_FIELD];
    expect(floor.known_false_block.some((d) => d.includes("min_ratio"))).toBe(true);
    expect(
      floor.known_false_pass.some((d) => d.toLowerCase().includes("no acceptance criteria") || d.toLowerCase().includes("no ac")),
    ).toBe(true);
    expect(floor.known_false_pass.some((d) => d.includes("planClaimedAcCoverage"))).toBe(true);

    const citedRule = PREDICATE_CONTRACTS[CITED_RULE_STATE_FIELD];
    expect(citedRule.known_false_pass.some((d) => d.includes("ANOTHER plan"))).toBe(true);
    expect(citedRule.known_false_pass.some((d) => d.includes("unknown"))).toBe(true);
    expect(citedRule.known_false_block.some((d) => d.includes("shared code anchor"))).toBe(true);

    for (const field of [PLAN_CLOSE_FIELD, ATTESTATION_EXEMPT_KIND_FIELD, ASSESSMENT_FRESHNESS_FIELD] as const) {
      expect(PREDICATE_CONTRACTS[field].known_false_pass).toEqual([]);
      expect(PREDICATE_CONTRACTS[field].known_false_block).toEqual([]);
    }
  });

  // ERROR (misuse-shaped) — an unsupported checkpoint name never throws and
  // never fabricates table content; it renders a one-line "not recorded" notice.
  it("ERROR: renderPredicateContractsExplain for an unsupported checkpoint renders a graceful notice, never throws — contract table", () => {
    expect(() => renderPredicateContractsExplain("spec-create")).not.toThrow();
    const text = renderPredicateContractsExplain("spec-create");
    expect(text).toContain("spec-create");
    expect(text.toLowerCase()).toContain("no predicate contract table");
  });

  // STATE — `lore gate --explain plan-close` renders every predicate's field/
  // invariant/measured/both delta lists.
  it("STATE: renderPredicateContractsExplain('plan-close') prints every predicate's field/invariant/measured/deltas — contract table", () => {
    const text = renderPredicateContractsExplain("plan-close");
    for (const field of EMITTED_PLAN_CLOSE_FIELDS) {
      expect(text).toContain(field);
      expect(text).toContain(PREDICATE_CONTRACTS[field].invariant);
      expect(text).toContain(PREDICATE_CONTRACTS[field].measured);
    }
    expect(text).toContain("known_false_pass");
    expect(text).toContain("known_false_block");
    expect(text).toContain("(none recorded)");
  });

  // REGRESSION — the feeding pack for a cited-rule-state denial quotes a
  // pointer-sized slice of its own contract (field + invariant + measured,
  // never the full delta lists) — Deliver item 4, D7.
  it("REGRESSION: the cited-rule-state feeding pack quotes its own contract pointer and names each offending rule — contract table", () => {
    const ctx: GateContext = {
      targetIdOrSlug: "plan-x",
      attestationMinRatio: 0.5,
      planTasksAttestation: [{ slug: "task-1", title: "T1", evidenceCount: 1, attestedCount: 1 }],
      planClaimedAcCoverage: [],
      prdSyncEnabled: true,
      citedRuleViolations: [
        { rule_id: "BR-5", state: "stale" },
        { rule_id: "BR-9", state: "contradicted" },
      ],
      parentSpecPointer: { slug: "spec-x", title: "Spec X", status: "approved" },
    };
    const failures = selectFailures(planClose.check(ctx));
    const text = planClose.feed(ctx, failures);
    const contract = PREDICATE_CONTRACTS[CITED_RULE_STATE_FIELD];
    expect(text).toContain(contract.invariant);
    expect(text).toContain(contract.measured);
    expect(text).toContain("BR-5 (stale)");
    expect(text).toContain("BR-9 (contradicted)");
    // Pointer-sized — the full delta lists are NOT quoted into the pack.
    for (const delta of [...contract.known_false_pass, ...contract.known_false_block]) {
      expect(text).not.toContain(delta);
    }
  });
});

// ─── Amendment A — undefined vs explicit [] divergence ─────────────────────

describe("checkPlanClose — planClaimedAcCoverage undefined is a caller-contract violation, not []", () => {
  // reason: task-report-why-each-plan-close-predicate-passed-so-a-vacuous —
  // this describe block never resolves `planDeclaredScopeCoverage`, so it
  // defaulted (via `checkPlanClose`'s `?? UNRESOLVED_DECLARED_SCOPE`) to the
  // UNDECLARED sentinel; `declaredScopeCoverageVerdict` reports THAT as its
  // own `notApplicable("scope-undeclared")` verdict (evidence-panel.ts), which
  // is what `attestationFloor` returns as ITS whole verdict here — never a
  // bare `{ok: true}`. Pre-fix, these tests' "the real verdict still passes"
  // assertions were satisfied ONLY by `assessmentFreshness`'s OWN vacuous
  // `{ok: true}` (the exact defect this task removes), never by
  // `attestationFloor`'s conditions 1/3 as the comments claim. A RESOLVED
  // "claims nothing" scope fact makes `attestationFloor`'s own verdict a
  // genuine `{ok: true}`, so the assertion means what its comment says.
  const SCOPE_RESOLVED_CLAIMING_NOTHING: DeclaredScopeCoverage = {
    declared_acs: [],
    unattested_acs: [],
    scope_undeclared: false,
    meets_coverage: true,
  };

  function realEvidenceCtx(overrides: Partial<GateContext>): GateContext {
    return {
      targetIdOrSlug: "plan-x",
      attestationMinRatio: 0.5,
      planTasksAttestation: [{ slug: "task-1", title: "T1", evidenceCount: 2, attestedCount: 2 }],
      planDeclaredScopeCoverage: SCOPE_RESOLVED_CLAIMING_NOTHING,
      // reason: task-report-why-each-plan-close-predicate-passed-so-a-vacuous —
      // this describe block's fixtures never populate newestAssessmentAt/
      // newestTaskActivityAt; now that the vacuous case pushes its own
      // notApplicable("no-evidence") entry, an unexempted fixture here would
      // trip a THIRD conjunct these planClaimedAcCoverage-focused assertions
      // never anticipated.
      assessmentFreshnessExempt: true,
      ...overrides,
    };
  }

  // HAPPY — an OMITTED planClaimedAcCoverage field, alongside real evidence
  // that would otherwise pass outright, produces an ADDITIONAL notApplicable
  // entry naming "planClaimedAcCoverage" as the absent referent — the coverage
  // conjunct is visibly UNEVALUATED, never silently vacuously satisfied.
  it("omitted planClaimedAcCoverage pushes a companion notApplicable(referent-absent) entry alongside the real verdict", () => {
    const ctx = realEvidenceCtx({});
    const results = planClose.check(ctx);

    expect(
      results.some(
        (r) => "notApplicable" in r && r.reason === "referent-absent" && r.referent === "planClaimedAcCoverage",
      ),
    ).toBe(true);
    // The real per-task/ratio conditions still evaluate and still pass —
    // Amendment A does not perturb conditions 1/3, only makes condition 2's
    // omission visible.
    expect(results.some((r) => "ok" in r && r.ok === true)).toBe(true);
  });

  // NEGATIVE — an EXPLICIT `[]` is a resolved fact ("this plan claims no
  // declared script-mode ACs") and keeps meaning what it means: a vacuous pass
  // on condition 2, NO companion notApplicable entry.
  it("an explicit [] is a resolved fact — vacuous pass, no companion notApplicable entry", () => {
    const ctx = realEvidenceCtx({ planClaimedAcCoverage: [] });
    const results = planClose.check(ctx);

    expect(
      results.some((r) => "notApplicable" in r && r.referent === "planClaimedAcCoverage"),
    ).toBe(false);
    expect(results.some((r) => "ok" in r && r.ok === true)).toBe(true);
  });

  // BOUNDARY — when attestationFloor is ALREADY notApplicable for an unrelated
  // reason (zero evidence anywhere on the plan), the companion entry is
  // suppressed rather than piling a second not-applicable verdict onto the
  // same predicate concern.
  it("BOUNDARY: no companion entry when attestationFloor is already notApplicable (zero evidence)", () => {
    // reason: task-report-why-each-plan-close-predicate-passed-so-a-vacuous —
    // this test asserts EXACTLY one notApplicable entry (attestationFloor's
    // own zero-evidence case); assessmentFreshnessExempt keeps the
    // newly-visible assessment-freshness "no-evidence" entry from adding a
    // second one.
    const ctx: GateContext = {
      targetIdOrSlug: "plan-y",
      attestationMinRatio: 0.5,
      planTasksAttestation: [],
      assessmentFreshnessExempt: true,
    };
    const results = planClose.check(ctx);

    const notApplicableEntries = results.filter((r) => "notApplicable" in r);
    expect(notApplicableEntries).toHaveLength(1);
    expect(notApplicableEntries[0]).toMatchObject({ reason: "no-evidence", referent: "plan-y" });
  });

  // ERROR (exemption-shaped) — a validly exempted plan never reaches the
  // attestation branch at all; an omitted planClaimedAcCoverage on an exempt
  // plan produces no companion entry (nothing was evaluated, nothing to flag).
  it("ERROR: a validly exempted plan never pushes a companion entry regardless of planClaimedAcCoverage", () => {
    const ctx = realEvidenceCtx({
      attestationExempt: true,
      attestationExemptKind: "pipeline-unreachable",
    });
    const results = planClose.check(ctx);

    expect(results.some((r) => "notApplicable" in r)).toBe(false);
    expect(results.some((r) => "ok" in r && r.ok === false && r.field === ATTESTATION_FLOOR_FIELD)).toBe(false);
  });
});
