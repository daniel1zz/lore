/**
 * RED suite (paired-impl task-t1-applicability-verdict-in-the-predicate-s-own-
 * type-both) for spec-plan-close-predicates-measure-invariants-an-applicability
 * §Design Decisions D1/D2 — "my referent is absent, so I do not apply" as a
 * VALUE a predicate returns (`PredicateNotApplicable`/`ApplicablePredicateResult`,
 * `gate-predicates.ts`), wired into `attestationFloor` (and the `planClaimedAcCoverage`
 * companion verdict) and into `GateEnforcer.enforce`'s partition (`checkpoint-registry.ts` /
 * `gate-enforcer.ts`).
 *
 * UPDATED for slice 3a (BR-984): the second original producer, `prdOutlineSynced` (an absent
 * domain doc => `notApplicable`), is retired; the cited-rule-state predicate that replaces it
 * (`citedRuleStateClean`) is two-valued — it measured something or it is not pushed at all — so
 * the AC-PCI-1/-2 blocks now pin that it NEVER returns a not-applicable verdict, and the
 * AC-PCI-3/T8 blocks drive the audit path through the producers that remain.
 *
 * Pure functions + constructed `GateContext` fixtures + an injected
 * `RecordGateSkip` fake only — no store, no IO, no `bun:sqlite` — hence vitest.
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION,
 * across three describe blocks (one per pinned AC).
 *
 * @spec_ref spec-plan-close-predicates-measure-invariants-an-applicability
 *   §Design Decisions D1/D2, §Acceptance Criteria AC-PCI-1/AC-PCI-2/AC-PCI-3
 */

import { describe, it, expect, vi } from "vitest";
import { ok, UNRESOLVED_DECLARED_SCOPE } from "@lore/core";
import type { LoreConfig, AcCoverageFact, DeclaredScopeCoverage } from "@lore/core";
import {
  citedRuleStateClean,
  attestationFloor,
  isNotApplicable,
  noAnchorOverlap,
  CITED_RULE_STATE_FIELD,
  CITED_RULE_STATE_REASON,
  ATTESTATION_FLOOR_FIELD,
  ATTESTATION_FLOOR_REASON,
  type PredicateResult,
} from "../../../src/service/gate-predicates.js";

// Amendment A (task-t3-domain-doc-sync-requires-attribution-to-the-closing-
// plan, spec-plan-close-predicates-measure-invariants-an-applicability §D3) —
// `attestationFloor`'s `acCoverage` 4th parameter lost its `= []` default (a
// silent opt-out of the per-claimed-AC coverage conjunct). Every fixture below
// that declares no acceptance criteria at all passes this NAMED constant
// instead of a bare `[]`, so the intent ("this fixture never declared any
// ACs") is visible at each call site rather than implicit.
const NO_DECLARED_ACS: readonly AcCoverageFact[] = [];

// spec-declared-scope-attestation-contract-task-owned-ac-scope §Facts D4 — the
// coverage conjunct now reads the DECLARED scope (`attestationFloor`'s REQUIRED
// 5th parameter). This suite's fixtures are about the APPLICABILITY plumbing, not
// about scope declarations, so they pass a RESOLVED declaration that claims
// nothing: `scope_undeclared: false` keeps the floor's verdict attributable to the
// condition each test is actually exercising, instead of adding a second
// notApplicable(scope-undeclared) verdict these assertions never anticipated.
// `UNRESOLVED_DECLARED_SCOPE` (which reports UNDECLARED) is used explicitly where
// a test means "nobody resolved the fact".
const SCOPE_RESOLVED_CLAIMING_NOTHING: DeclaredScopeCoverage = {
  declared_acs: [],
  unattested_acs: [],
  scope_undeclared: false,
  meets_coverage: true,
};
import {
  checkpointRegistry,
  isCheckpointBlocked,
  selectFailures,
  type GateContext,
} from "../../../src/service/checkpoint-registry.js";
import { GateEnforcer, type RecordGateSkip } from "../../../src/service/gate-enforcer.js";

/** Flushes pending microtasks (promise `.then`/`.catch` chains) without advancing macrotasks. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const planClose = checkpointRegistry["plan-close"];
if (planClose === undefined) {
  throw new Error("plan-close checkpoint not registered — test fixture assumption broken");
}

// ─── AC-PCI-1: notApplicable shape ─────────────────────────────────────────

describe("PredicateNotApplicable — notApplicable shape (AC-PCI-1)", () => {
  // HAPPY — the cited-rule-state predicate with nothing to refuse is a plain pass.
  it("HAPPY: citedRuleStateClean([]) is a plain pass, never notApplicable", () => {
    const result = citedRuleStateClean([]);
    expect(result).toEqual({ ok: true });
    expect("notApplicable" in result).toBe(false);
  });

  // NEGATIVE — a refusing rule is a plain fail carrying the predicate's reason/field.
  it("NEGATIVE: citedRuleStateClean with a refusing rule is a plain fail carrying its reason/field", () => {
    const result = citedRuleStateClean([{ rule_id: "BR-5", state: "contradicted" }]);
    expect(result).toEqual({ ok: false, reason: CITED_RULE_STATE_REASON, field: CITED_RULE_STATE_FIELD });
    expect("notApplicable" in result).toBe(false);
  });

  // BOUNDARY — attestationFloor's OWN not-applicable case (zero evidence anywhere)
  // shares the identical shape, with a DIFFERENT reason and the PLAN's referent.
  it("BOUNDARY: attestationFloor with zero evidence anywhere returns notApplicable naming the plan referent", () => {
    const result = attestationFloor([], 0.5, "plan-x", NO_DECLARED_ACS, SCOPE_RESOLVED_CLAIMING_NOTHING);
    expect(result).toEqual({ notApplicable: true, reason: "no-evidence", referent: "plan-x" });
    expect("ok" in result).toBe(false);
  });

  // STATE — attestationFloor transitions notApplicable -> fail -> pass purely as a
  // function of its `tasks` input (no evidence -> some evidence under floor -> evidence meeting floor).
  it("STATE: attestationFloor moves from notApplicable to fail to pass as evidence accumulates", () => {
    const noEvidence = attestationFloor(undefined, 0.5, "plan-x", NO_DECLARED_ACS, SCOPE_RESOLVED_CLAIMING_NOTHING);
    expect(isNotApplicable(noEvidence)).toBe(true);

    const underFloor = attestationFloor(
      [{ slug: "task-1", title: "T1", evidenceCount: 4, attestedCount: 0 }],
      0.5,
      "plan-x",
      NO_DECLARED_ACS,
      SCOPE_RESOLVED_CLAIMING_NOTHING,
    );
    expect(isNotApplicable(underFloor)).toBe(false);
    expect(underFloor).toEqual({ ok: false, reason: ATTESTATION_FLOOR_REASON, field: ATTESTATION_FLOOR_FIELD });

    const meetsFloor = attestationFloor(
      [{ slug: "task-1", title: "T1", evidenceCount: 2, attestedCount: 2 }],
      0.5,
      "plan-x",
      NO_DECLARED_ACS,
      SCOPE_RESOLVED_CLAIMING_NOTHING,
    );
    expect(isNotApplicable(meetsFloor)).toBe(false);
    expect(meetsFloor).toEqual({ ok: true });
  });

  // ERROR (misuse-shaped) — `isNotApplicable`'s own discriminator correctly
  // rejects a look-alike object whose `notApplicable` flag is explicitly `false`,
  // never treating ANY object with a `notApplicable` key as the not-applicable member.
  it("ERROR: isNotApplicable never mistakes an explicit notApplicable:false for the not-applicable member", () => {
    const lookalike = { notApplicable: false, ok: true } as unknown as PredicateResult;
    expect(isNotApplicable(lookalike)).toBe(false);
  });

  // REGRESSION — the 26-other-predicates contract: an ordinary two-value
  // PredicateResult (e.g. noAnchorOverlap's own pass) is completely unaffected —
  // `isNotApplicable` returns false and never throws on it.
  it("REGRESSION: an unrelated predicate's PredicateResult (noAnchorOverlap) is never notApplicable", () => {
    const pass = noAnchorOverlap("agent:t1", ["src/a"], []);
    expect(pass).toEqual({ ok: true });
    expect(isNotApplicable(pass)).toBe(false);
  });
});

// ─── AC-PCI-2: never a fail ────────────────────────────────────────────────

describe("checkPlanClose — cited-rule-state pushes a verdict only when it measured something (AC-PCI-2, BR-984)", () => {
  function baseCtx(overrides: Partial<GateContext>): GateContext {
    return {
      targetIdOrSlug: "plan-x",
      attestationMinRatio: 0.5,
      // reason: real, attested, floor-meeting evidence — isolates THIS group's
      // assertions to the cited-rule-state predicate's own contribution.
      planTasksAttestation: [{ slug: "task-1", title: "T1", evidenceCount: 1, attestedCount: 1 }],
      // reason: Amendment A — an explicit `NO_DECLARED_ACS` keeps the per-claimed-AC coverage
      // companion `notApplicable` verdict out of these assertions.
      planClaimedAcCoverage: NO_DECLARED_ACS,
      planDeclaredScopeCoverage: SCOPE_RESOLVED_CLAIMING_NOTHING,
      prdSyncEnabled: true,
      parentSpecPointer: { slug: "spec-x", title: "Spec X", status: "approved" },
      // reason: keeps assessment-freshness's own vacuous `notApplicable` entry out of these assertions.
      assessmentFreshnessExempt: true,
      ...overrides,
    };
  }

  // HAPPY — every cited rule fine: a measured plain pass, no notApplicable member anywhere.
  it("HAPPY: an empty violation list is a plain pass — no cited-rule-state failure, no notApplicable, not blocked", () => {
    const results = planClose.check(baseCtx({ citedRuleViolations: [] }));

    expect(selectFailures(results).some((f) => f.field === CITED_RULE_STATE_FIELD)).toBe(false);
    expect(results.some((r) => "notApplicable" in r)).toBe(false);
    expect(isCheckpointBlocked(results)).toBe(false);
  });

  // NEGATIVE — a contradicted/stale cited rule is a real failure that blocks the checkpoint.
  it("NEGATIVE: a refusing cited rule produces a real cited-rule-state failure and blocks the checkpoint", () => {
    const results = planClose.check(baseCtx({ citedRuleViolations: [{ rule_id: "BR-5", state: "stale" }] }));

    expect(selectFailures(results).some((f) => f.field === CITED_RULE_STATE_FIELD)).toBe(true);
    expect(results.some((r) => "notApplicable" in r)).toBe(false);
    expect(isCheckpointBlocked(results)).toBe(true);
  });

  // STATE — `citedRuleViolations` never populated (no rule state consulted / no spec ancestor):
  // the predicate pushes NOTHING (checkpoint-level vacuous), it does not invent a verdict.
  it("STATE: no rule state consulted (citedRuleViolations undefined) pushes no cited-rule-state entry whatsoever", () => {
    // reason: built directly — under `exactOptionalPropertyTypes`, assigning `undefined` to clear
    // an optional field is a type error; the point is that the field is simply ABSENT.
    const ctx: GateContext = {
      targetIdOrSlug: "plan-x",
      attestationMinRatio: 0.5,
      planTasksAttestation: [{ slug: "task-1", title: "T1", evidenceCount: 1, attestedCount: 1 }],
      planClaimedAcCoverage: NO_DECLARED_ACS,
      planDeclaredScopeCoverage: SCOPE_RESOLVED_CLAIMING_NOTHING,
      prdSyncEnabled: true,
      assessmentFreshnessExempt: true,
    };
    const results = planClose.check(ctx);

    expect(results.some((r) => "notApplicable" in r)).toBe(false);
    expect(selectFailures(results).some((f) => f.field === CITED_RULE_STATE_FIELD)).toBe(false);
    expect(isCheckpointBlocked(results)).toBe(false);
  });

  // ERROR (config-shaped) — the prd_sync knob disabled means the predicate never runs, violations or not.
  it("ERROR: prd_sync disabled by config means the predicate never runs even with violations supplied", () => {
    const results = planClose.check(
      baseCtx({ prdSyncEnabled: false, citedRuleViolations: [{ rule_id: "BR-5", state: "contradicted" }] }),
    );

    expect(selectFailures(results).some((f) => f.field === CITED_RULE_STATE_FIELD)).toBe(false);
    expect(isCheckpointBlocked(results)).toBe(false);
  });

  // REGRESSION — a cited-rule failure leaves every OTHER plan-close predicate's verdict untouched.
  it("REGRESSION: a cited-rule-state failure does not perturb attestationFloor's own passing verdict", () => {
    const results = planClose.check(baseCtx({ citedRuleViolations: [{ rule_id: "BR-5", state: "stale" }] }));

    expect(selectFailures(results).some((f) => f.field === ATTESTATION_FLOOR_FIELD)).toBe(false);
    expect(results.some((r) => "notApplicable" in r && r.reason === "no-evidence")).toBe(false);
  });
});

// ─── AC-PCI-3: enforce advisory ────────────────────────────────────────────

describe("GateEnforcer.enforce — enforce advisory on plan-close not-applicable (AC-PCI-3)", () => {
  function notApplicableCtx(): GateContext {
    return {
      targetIdOrSlug: "plan-x",
      attestationMinRatio: 0.5,
      planTasksAttestation: [{ slug: "task-1", title: "T1", evidenceCount: 1, attestedCount: 1 }],
      // reason: Amendment A — this describe block's fixtures isolate the
      // prd-sync not-applicable path and never meant to say anything about
      // per-claimed-AC coverage; an explicit `NO_DECLARED_ACS` makes that
      // intent visible (see `baseCtx`'s identical comment in the AC-PCI-2
      // describe block above) instead of also tripping the coverage
      // companion `notApplicable` verdict this describe block isn't testing.
      // reason: `planClaimedAcCoverage` is deliberately OMITTED — that omission IS the Amendment A
      // companion-push trigger (`referent: "planClaimedAcCoverage"`), the not-applicable producer
      // this describe block drives now that the domain-doc predicate is retired (BR-984).
      planDeclaredScopeCoverage: SCOPE_RESOLVED_CLAIMING_NOTHING,
      // reason: counts audit rows for the one not-applicable path above; an unexempted fixture would
      // also trip assessment-freshness's own notApplicable("no-evidence") entry.
      assessmentFreshnessExempt: true,
    };
  }

  // HAPPY — the pinned contract: enforce() returns ok (never a deny) AND
  // records exactly one best-effort audit row naming the absent referent
  // (PLUS, AC-FR-8/D7, one gate_passed row — the checkpoint was NOT blocked).
  it("HAPPY: enforce returns ok and records one gate_not_applicable row naming the absent referent, plus one gate_passed row", () => {
    const recordGateSkip = vi.fn<RecordGateSkip>().mockResolvedValue(ok(undefined));
    const enforcer = new GateEnforcer(undefined, recordGateSkip);

    const result = enforcer.enforce("plan-close", notApplicableCtx());

    expect(result).toEqual({ ok: true, value: undefined });
    expect(recordGateSkip).toHaveBeenCalledTimes(2);
    const entry = recordGateSkip.mock.calls[0]![0];
    expect(entry.action).toBe("gate_not_applicable");
    expect(entry.details).toMatchObject({
      checkpoint: "plan-close",
      kind: "attestation-not-applicable",
      referent: "planClaimedAcCoverage",
    });
    const passEntry = recordGateSkip.mock.calls[1]![0];
    expect(passEntry.action).toBe("gate_passed");
    expect(passEntry.details).toEqual({ checkpoint: "plan-close", verdict: "pass" });
  });

  // ERROR — the pinned contract: a throwing (synchronous) audit writer leaves
  // enforce()'s returned Result completely unchanged.
  it("ERROR: a synchronously-throwing audit writer leaves the enforce result unchanged", () => {
    const recordGateSkip: RecordGateSkip = vi.fn(() => {
      throw new Error("boom");
    }) as unknown as RecordGateSkip;
    const enforcer = new GateEnforcer(undefined, recordGateSkip);

    const result = enforcer.enforce("plan-close", notApplicableCtx());

    expect(result).toEqual({ ok: true, value: undefined });
  });

  // NEGATIVE — a REJECTING (asynchronous) audit writer likewise never surfaces
  // to the caller; enforce()'s Result is unaffected once microtasks settle.
  it("NEGATIVE: a rejecting audit writer never surfaces — enforce's Result is unaffected", async () => {
    const recordGateSkip = vi.fn<RecordGateSkip>().mockRejectedValue(new Error("network down"));
    const enforcer = new GateEnforcer(undefined, recordGateSkip);

    const result = enforcer.enforce("plan-close", notApplicableCtx());
    expect(result).toEqual({ ok: true, value: undefined });

    await flushMicrotasks();
    expect(result).toEqual({ ok: true, value: undefined });
  });

  // BOUNDARY — attestationFloor's OWN not-applicable case (zero evidence) is
  // ALSO audited, tagged with the DIFFERENT "attestation-not-applicable" kind —
  // proving the reason -> kind mapping covers both attestation producers.
  it("BOUNDARY: a zero-evidence plan is audited with the attestation-not-applicable kind", () => {
    const recordGateSkip = vi.fn<RecordGateSkip>().mockResolvedValue(ok(undefined));
    const enforcer = new GateEnforcer(undefined, recordGateSkip);
    // reason: task-report-why-each-plan-close-predicate-passed-so-a-vacuous —
    // this test counts audit rows for attestationFloor's own zero-evidence
    // not-applicable case specifically; assessmentFreshnessExempt keeps the
    // newly-visible assessment-freshness notApplicable("no-evidence") entry
    // from adding a second row this assertion never anticipated.
    const ctx: GateContext = {
      targetIdOrSlug: "plan-y",
      attestationMinRatio: 0.5,
      planTasksAttestation: [],
      assessmentFreshnessExempt: true,
    };

    const result = enforcer.enforce("plan-close", ctx);

    expect(result).toEqual({ ok: true, value: undefined });
    // reason: AC-FR-8/D7 — 1 gate_not_applicable row PLUS 1 gate_passed row
    // (the checkpoint was not blocked).
    expect(recordGateSkip).toHaveBeenCalledTimes(2);
    const entry = recordGateSkip.mock.calls[0]![0];
    expect(entry.details).toMatchObject({
      checkpoint: "plan-close",
      kind: "attestation-not-applicable",
      referent: "plan-y",
    });
    expect(recordGateSkip.mock.calls[1]![0].action).toBe("gate_passed");
  });

  // COVERAGE-RESTORE (task-assert-the-plan-close-vacuity-discriminator-on-the-
  // render finding 2) — every OTHER fixture in this describe block (and the two
  // T8-Part-2 blocks below) sets `assessmentFreshnessExempt: true` specifically so
  // the newly-visible assessment-freshness `notApplicable("no-evidence")` entry
  // stays OUT of their verdict counts. The comments explaining why are honest, but
  // the net effect is that the suites most focused on COUNTING gate verdicts never
  // exercised that entry at all — this is the ONE fixture in this file that does
  // NOT set the exempt flag, so the new path has positive coverage somewhere in a
  // verdict-counting suite. Real, floor-meeting evidence (attestationFloor passes
  // measured, never notApplicable) isolates the assertion to assessmentFreshness's
  // own vacuous case specifically.
  it("COVERAGE-RESTORE: an UNEXEMPTED plan with real evidence but no assessment/task-activity data audits the assessment-freshness no-evidence entry too", () => {
    const recordGateSkip = vi.fn<RecordGateSkip>().mockResolvedValue(ok(undefined));
    const enforcer = new GateEnforcer(undefined, recordGateSkip);
    const ctx: GateContext = {
      targetIdOrSlug: "plan-coverage-restore",
      attestationMinRatio: null,
      planTasksAttestation: [{ slug: "task-1", title: "T1", evidenceCount: 1, attestedCount: 1 }],
      planClaimedAcCoverage: NO_DECLARED_ACS,
      planDeclaredScopeCoverage: SCOPE_RESOLVED_CLAIMING_NOTHING,
      // reason: deliberately OMITTED — this is the ONE fixture in this file that
      // does NOT exempt assessmentFreshness, so its own notApplicable("no-evidence")
      // verdict actually runs and gets counted.
    };

    const results = planClose.check(ctx);
    // attestationFloor's real pass PLUS assessmentFreshness's vacuous entry —
    // both present, never collapsed into one another.
    expect(results).toHaveLength(2);
    expect(results.some((r) => JSON.stringify(r) === JSON.stringify({ ok: true }))).toBe(true);
    const notApplicableEntries = results.filter(isNotApplicable);
    expect(notApplicableEntries).toHaveLength(1);
    expect(notApplicableEntries[0]).toEqual({
      notApplicable: true,
      reason: "no-evidence",
      referent: "plan-coverage-restore",
    });

    const result = enforcer.enforce("plan-close", ctx);
    expect(result).toEqual({ ok: true, value: undefined });
    // reason: AC-FR-8/D7 — 1 gate_not_applicable row PLUS 1 gate_passed row.
    expect(recordGateSkip).toHaveBeenCalledTimes(2);
    const entry = recordGateSkip.mock.calls[0]![0];
    expect(entry.action).toBe("gate_not_applicable");
    expect(entry.details).toMatchObject({
      checkpoint: "plan-close",
      kind: "attestation-not-applicable",
      referent: "plan-coverage-restore",
    });
  });

  // STATE — a NORMAL (no not-applicable verdicts) enforce() call never touches
  // the not-applicable audit path, but DOES fire exactly one gate_passed row
  // (AC-FR-8/D7 — a genuine, non-vacuous pass is no longer silent).
  it("STATE: a plan-close call with no not-applicable verdicts fires gate_passed only, never gate_not_applicable", () => {
    const recordGateSkip = vi.fn<RecordGateSkip>().mockResolvedValue(ok(undefined));
    const enforcer = new GateEnforcer(undefined, recordGateSkip);
    const ctx: GateContext = {
      targetIdOrSlug: "plan-z",
      attestationMinRatio: 0.5,
      planTasksAttestation: [{ slug: "task-1", title: "T1", evidenceCount: 2, attestedCount: 2 }],
      // reason: Amendment A — real, floor-meeting evidence with NO claimed ACs
      // declared is the resolved fact this fixture means ("nothing to
      // attest, but no claims outstanding either"); an explicit
      // `NO_DECLARED_ACS` keeps this scenario a true "no not-applicable
      // verdicts at all" case instead of tripping the coverage companion
      // verdict, which is exactly what this test asserts never fires.
      planClaimedAcCoverage: NO_DECLARED_ACS,
      planDeclaredScopeCoverage: SCOPE_RESOLVED_CLAIMING_NOTHING,
      // reason: task-report-why-each-plan-close-predicate-passed-so-a-vacuous —
      // this fixture's whole point is "no not-applicable verdicts at all";
      // without this, the newly-visible assessment-freshness vacuous case
      // would fire one, which is exactly what this test asserts never happens.
      assessmentFreshnessExempt: true,
    };

    const result = enforcer.enforce("plan-close", ctx);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(recordGateSkip).toHaveBeenCalledTimes(1);
    const entry = recordGateSkip.mock.calls[0]![0];
    expect(entry.action).toBe("gate_passed");
    expect(entry.details).toEqual({ checkpoint: "plan-close", verdict: "pass" });
  });

  // REGRESSION — the PRE-EXISTING config-disabled `gate_skipped` mechanism is
  // completely untouched: a disabled checkpoint fires ONLY `gate_skipped`,
  // NEVER `gate_not_applicable` (its predicates never even ran).
  it("REGRESSION: a config-disabled checkpoint fires gate_skipped only, never gate_not_applicable", () => {
    const config = {
      project: { name: "t", author: "t" },
      workflow: { gates: { "plan-close": { enabled: false } } },
    } as unknown as LoreConfig;
    const recordGateSkip = vi.fn<RecordGateSkip>().mockResolvedValue(ok(undefined));
    const enforcer = new GateEnforcer(config, recordGateSkip);

    const result = enforcer.enforce("plan-close", notApplicableCtx());

    expect(result).toEqual({ ok: true, value: undefined });
    expect(recordGateSkip).toHaveBeenCalledTimes(1);
    const entry = recordGateSkip.mock.calls[0]![0];
    expect(entry.action).toBe("gate_skipped");
  });
});

// ─── T8 Part 2: notApplicableAdvisoryKind after the domain-doc predicate's retirement ──
//
// `reason: "referent-absent"` used to have TWO producers (the domain-doc predicate and the
// Amendment A `planClaimedAcCoverage` companion push), which is why the advisory kind was keyed
// per-referent. BR-984 retired the first; every remaining `referent-absent` verdict is an
// attestation concern, and the `"prd-sync-domain-doc"` kind no longer exists anywhere.
describe("GateEnforcer.enforce — notApplicableAdvisoryKind is keyed per-referent (T8 Part 2)", () => {
  // HAPPY — the surviving `referent-absent` producer maps to attestation-not-applicable, and no
  // row anywhere carries the retired "prd-sync-domain-doc" kind.
  it("HAPPY: the planClaimedAcCoverage referent maps to attestation-not-applicable and the retired prd-sync-domain-doc kind never appears", () => {
    const recordGateSkip = vi.fn<RecordGateSkip>().mockResolvedValue(ok(undefined));
    const enforcer = new GateEnforcer(undefined, recordGateSkip);
    // reason: `planClaimedAcCoverage` is deliberately OMITTED — the Amendment A companion-push
    // trigger. `planDeclaredScopeCoverage` IS supplied (an unresolved declared scope would add a
    // second row, reason `scope-undeclared`, belonging to a different concern).
    const ctx: GateContext = {
      targetIdOrSlug: "plan-x",
      attestationMinRatio: 0.5,
      planTasksAttestation: [{ slug: "task-1", title: "T1", evidenceCount: 1, attestedCount: 1 }],
      planDeclaredScopeCoverage: SCOPE_RESOLVED_CLAIMING_NOTHING,
      assessmentFreshnessExempt: true,
    };

    const result = enforcer.enforce("plan-close", ctx);

    expect(result).toEqual({ ok: true, value: undefined });
    // reason: AC-FR-8/D7 — 1 gate_not_applicable row PLUS 1 gate_passed row.
    expect(recordGateSkip).toHaveBeenCalledTimes(2);
    const details = recordGateSkip.mock.calls.map((call) => call[0]!.details as { kind?: string; referent?: string });
    expect(details.find((d) => d.referent === "planClaimedAcCoverage")?.kind).toBe("attestation-not-applicable");
    expect(details.some((d) => d.kind === "prd-sync-domain-doc")).toBe(false);
  });

  // BOUNDARY (spec-declared-scope-attestation-contract-task-owned-ac-scope
  // §Facts D4) — the THIRD NotApplicableReason, `scope-undeclared`, is audited
  // too: a plan with real, fully-attested evidence whose tasks declared no scope
  // must produce exactly one `gate_not_applicable` row tagged
  // "attestation-not-applicable" and naming the PLAN as referent (not the
  // planClaimedAcCoverage sentinel), and enforce() must still return ok — an
  // advisory that blocked would make this a gate, which D4 explicitly forbids.
  it("BOUNDARY: an undeclared declared-scope is audited as attestation-not-applicable naming the plan, and never blocks", () => {
    const recordGateSkip = vi.fn<RecordGateSkip>().mockResolvedValue(ok(undefined));
    const enforcer = new GateEnforcer(undefined, recordGateSkip);
    const ctx: GateContext = {
      targetIdOrSlug: "plan-undeclared",
      attestationMinRatio: 0.5,
      planTasksAttestation: [{ slug: "task-1", title: "T1", evidenceCount: 2, attestedCount: 2 }],
      planClaimedAcCoverage: NO_DECLARED_ACS,
      planDeclaredScopeCoverage: UNRESOLVED_DECLARED_SCOPE,
      // reason: task-report-why-each-plan-close-predicate-passed-so-a-vacuous —
      // this test counts exactly ONE audit row for the scope-undeclared
      // not-applicable case; assessmentFreshnessExempt keeps the newly-visible
      // assessment-freshness "no-evidence" entry from adding a second row.
      assessmentFreshnessExempt: true,
    };

    const result = enforcer.enforce("plan-close", ctx);

    expect(result).toEqual({ ok: true, value: undefined });
    // reason: AC-FR-8/D7 — 1 gate_not_applicable row PLUS 1 gate_passed row.
    expect(recordGateSkip).toHaveBeenCalledTimes(2);
    const entry = recordGateSkip.mock.calls[0]![0];
    expect(entry.action).toBe("gate_not_applicable");
    expect(entry.details).toMatchObject({
      checkpoint: "plan-close",
      kind: "attestation-not-applicable",
      referent: "plan-undeclared",
    });
    expect(recordGateSkip.mock.calls[1]![0].action).toBe("gate_passed");
  });

  // NEGATIVE — attestationFloor's OWN zero-evidence not-applicable case
  // (reason "no-evidence") must still map to "attestation-not-applicable",
  // proving the per-referent fix did not disturb the pre-existing reason-
  // keyed branch for the producer that has no competing referent.
  it("NEGATIVE: attestationFloor's zero-evidence not-applicable still maps to attestation-not-applicable", () => {
    const recordGateSkip = vi.fn<RecordGateSkip>().mockResolvedValue(ok(undefined));
    const enforcer = new GateEnforcer(undefined, recordGateSkip);
    // reason: task-report-why-each-plan-close-predicate-passed-so-a-vacuous —
    // this test counts exactly ONE audit row for attestationFloor's own
    // zero-evidence case; assessmentFreshnessExempt keeps the newly-visible
    // assessment-freshness "no-evidence" entry from adding a second row.
    const ctx: GateContext = {
      targetIdOrSlug: "plan-y",
      attestationMinRatio: 0.5,
      planTasksAttestation: [],
      assessmentFreshnessExempt: true,
    };

    enforcer.enforce("plan-close", ctx);

    // reason: AC-FR-8/D7 — 1 gate_not_applicable row PLUS 1 gate_passed row.
    expect(recordGateSkip).toHaveBeenCalledTimes(2);
    const entry = recordGateSkip.mock.calls[0]![0];
    expect(entry.details).toMatchObject({ kind: "attestation-not-applicable", referent: "plan-y" });
  });
});
