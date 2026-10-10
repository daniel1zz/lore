/**
 * `plan-close`'s VACUITY guard — the two mechanisms of
 * task-plan-close-must-block-when-the-coverage-conjunct-is-scope
 * (spec-plan-close-predicates-measure-invariants-an-applicability):
 *
 *   M1 (AC-PCI-17, controls AC-PCI-18/19) — the declared-scope coverage
 *      conjunct returning `notApplicable("scope-undeclared")` while the plan
 *      carries verification evidence is a BLOCKING failure, not an advisory.
 *      Measured 2026-07-31: four plans archived at exit 0 through exactly this
 *      shape (one `gate_not_applicable` row each, 53 evidence rows across 10
 *      tasks, `attested_evidence_ratio 0.00`) because every blocking conjunct
 *      was inapplicable and an all-inapplicable run is indistinguishable from a
 *      measured pass.
 *
 *   M2 (AC-PCI-20) — a checkpoint run in which EVERY conjunct returned
 *      `notApplicable` SAYS SO, as a literal string, on the gate's own output
 *      surface. Asserted by string EQUALITY against the exported builder, never
 *      inferred from an empty failure list (an empty failure list is exactly
 *      what a genuine pass also produces — the ambiguity being removed).
 *
 * Pure predicates + hand-built `GateContext` fixtures + an injected
 * `RecordGateSkip` fake and a captured `process.stderr.write` — no store, no
 * `bun:sqlite`, hence vitest.
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 *
 * ⛔ Every `it()` title carries its AC's BARE tag token (`PCI-17` …) so the
 * pinned `-t 'PCI-NN'` filter is a lone-token match — a filter keyed on a
 * remembered phrase degrades silently to no-match, and "no match" exits 0
 * indistinguishably from "passed" (repo CLAUDE.md, contiguous-substring lesson).
 *
 * @spec_ref spec-plan-close-predicates-measure-invariants-an-applicability
 *   §Acceptance Criteria AC-PCI-17/18/19/20;
 *   spec-declared-scope-attestation-contract-task-owned-ac-scope §Facts D4.
 */

import { describe, it, expect, vi } from "vitest";
import { UNRESOLVED_DECLARED_SCOPE } from "@lore/core";
import type { AcCoverageFact, DeclaredScopeCoverage, TaskAttestationInfo } from "@lore/core";
import {
  isNotApplicable,
  ATTESTATION_FLOOR_FIELD,
  ATTESTATION_SCOPE_UNDECLARED_FIELD,
  ATTESTATION_SCOPE_UNDECLARED_REASON,
  type ApplicablePredicateResult,
} from "../../../src/service/gate-predicates.js";
import {
  checkpointRegistry,
  describeCheckpointVacuity,
  isCheckpointBlocked,
  selectFailures,
  VACUOUS_CHECKPOINT_NOTICE_PREFIX,
  type GateContext,
} from "../../../src/service/checkpoint-registry.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";

const planClose = checkpointRegistry["plan-close"];
if (planClose === undefined) {
  throw new Error("plan-close checkpoint not registered — test fixture assumption broken");
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

const PLAN = "plan-legacy-undeclared";

/** One task carrying evidence that a runner DID attest — so the per-task and
 *  ratio conjuncts are both satisfied and the ONLY remaining verdict is the
 *  declared-scope conjunct's. Isolating the cause is the point of these tests. */
const ATTESTED_TASK: TaskAttestationInfo = {
  slug: "task-legacy-1",
  title: "Legacy task with attested evidence",
  evidenceCount: 3,
  attestedCount: 3,
};

/** The same task with NO evidence at all — the pure-planning shape AC-PCI-19 pins. */
const EVIDENCE_FREE_TASK: TaskAttestationInfo = {
  slug: "task-planning-only",
  title: "Pure-planning task, never ran an oracle",
  evidenceCount: 0,
  attestedCount: 0,
};

/** `computeAcCoverage`-shaped diagnostics: one script-mode AC, runner-attested. */
const AC1_ATTESTED: readonly AcCoverageFact[] = [
  {
    ac_id: "AC-1",
    mode: "script",
    pass: 1,
    fail: 0,
    refs: [{ task_id: "task-legacy-1", result: "pass", attested: true }],
    attested_pass: 1,
    attested_fail: 0,
    falsified: 0,
  },
];

/** A RESOLVED declaration naming AC-1, fully attested — the compliant shape. */
const SCOPE_DECLARED_AND_ATTESTED: DeclaredScopeCoverage = {
  declared_acs: ["AC-1"],
  unattested_acs: [],
  scope_undeclared: false,
  meets_coverage: true,
};

/** A RESOLVED declaration naming AC-1 whose evidence carries ZERO attestation —
 *  a MEASURED coverage violation, distinct from an undeclared scope. */
const SCOPE_DECLARED_UNATTESTED: DeclaredScopeCoverage = {
  declared_acs: ["AC-1"],
  unattested_acs: ["AC-1"],
  scope_undeclared: false,
  meets_coverage: false,
};

/**
 * An evidence-bearing task that declared NO `ac_scope` — the exact fact
 * `deriveDeclaredScopeCoverage` reports for every one of the 10 tasks in the
 * 2026-07-31 incident. Structurally identical to `UNRESOLVED_DECLARED_SCOPE`,
 * spelled out separately because the two mean DIFFERENT things: this one is a
 * RESOLVED fact ("we looked, nobody declared"), the sentinel is "nobody looked".
 * The guard must deny on both, and conflating the fixtures would hide it if a
 * future change made the predicate discriminate them.
 */
const SCOPE_UNDECLARED_RESOLVED: DeclaredScopeCoverage = {
  declared_acs: [],
  unattested_acs: [],
  scope_undeclared: true,
  meets_coverage: true,
};

/**
 * The 2026-07-31 shape: real evidence, a fully-attested trail, and not one task
 * declaring what it owns. `assessmentFreshnessExempt` keeps SPEC-106's unrelated
 * predicate out of these assertions; `attestationMinRatio: null` keeps the
 * opt-in ratio conjunct off (this repo's own config declares none), so the
 * declared-scope conjunct is provably the only thing left to decide the close.
 */
function undeclaredScopeCtx(overrides: Partial<GateContext> = {}): GateContext {
  return {
    targetIdOrSlug: PLAN,
    planTasksAttestation: [ATTESTED_TASK],
    attestationMinRatio: null,
    planClaimedAcCoverage: AC1_ATTESTED,
    planDeclaredScopeCoverage: SCOPE_UNDECLARED_RESOLVED,
    assessmentFreshnessExempt: true,
    ...overrides,
  };
}

// ─── AC-PCI-17: the deny ────────────────────────────────────────────────────

describe("plan-close blocks an undeclared scope that carries evidence (PCI-17)", () => {
  // HAPPY — the pinned contract: BLOCKING, never an advisory.
  it("PCI-17 HAPPY: an evidence-bearing plan whose scope is undeclared is BLOCKED, not advised", () => {
    const results = planClose.check(undeclaredScopeCtx());

    expect(isCheckpointBlocked(results)).toBe(true);
    // The denial is attributable to the scope conjunct SPECIFICALLY — a test
    // asserting only "blocked" would pass if some unrelated predicate started
    // failing for its own reason.
    expect(selectFailures(results).map((f) => f.field)).toContain(
      ATTESTATION_SCOPE_UNDECLARED_FIELD,
    );
    expect(selectFailures(results).map((f) => f.reason)).toContain(
      ATTESTATION_SCOPE_UNDECLARED_REASON,
    );
    // The whole defect was this verdict arriving on the ADVISORY channel: an
    // advisory never denies, so the close proceeded at exit 0.
    expect(results.filter(isNotApplicable)).toEqual([]);
  });

  // BOUNDARY — ONE evidence entry on ONE task is already "carries evidence".
  // The predicate must not require a plural trail before it engages.
  it("PCI-17 BOUNDARY: a single evidence entry on a single task is enough to deny", () => {
    const results = planClose.check(
      undeclaredScopeCtx({
        planTasksAttestation: [{ slug: "task-1", title: "T1", evidenceCount: 1, attestedCount: 1 }],
      }),
    );

    expect(isCheckpointBlocked(results)).toBe(true);
  });

  // NEGATIVE — the UNRESOLVED sentinel (a caller that never resolved the fact)
  // reports UNDECLARED too, and must deny identically. A guard that keyed only
  // on the resolved fixture would leave the sentinel path silently vacuous.
  it("PCI-17 NEGATIVE: the UNRESOLVED_DECLARED_SCOPE sentinel denies on the same terms", () => {
    const results = planClose.check(
      undeclaredScopeCtx({ planDeclaredScopeCoverage: UNRESOLVED_DECLARED_SCOPE }),
    );

    expect(isCheckpointBlocked(results)).toBe(true);
  });

  // NEGATIVE — the deny is withheld when the governing spec declares NO
  // script-mode criterion: there is then no id `lore scope add` could name, so
  // demanding a declaration would be a permanent false block with no recovery
  // (a gate demanding a field no surface can author). That case stays the
  // audited advisory it already was, flagged upstream at plan-promote.
  it("PCI-17 NEGATIVE: nothing declarable means nothing to declare — the verdict stays advisory", () => {
    const results = planClose.check(
      undeclaredScopeCtx({
        // A spec declaring only a human-mode criterion: `lore verify` cannot
        // attest it and `ac_scope` cannot meaningfully claim it.
        planClaimedAcCoverage: [
          {
            ac_id: "AC-H1",
            mode: "human",
            pass: 0,
            fail: 0,
            refs: [],
            attested_pass: 0,
            attested_fail: 0,
            falsified: 0,
          },
        ],
      }),
    );

    expect(isCheckpointBlocked(results)).toBe(false);
    expect(results.filter(isNotApplicable).map((r) => r.reason)).toContain("scope-undeclared");
  });

  // STATE — a valid PLAN-level attestation exemption still short-circuits the
  // whole floor (`checkPlanClose` never even calls the predicate). The new deny
  // must not become an un-exemptable gate: the recovery path has to stay open.
  it("PCI-17 STATE: a valid attestation exemption still closes an undeclared-scope plan", () => {
    const results = planClose.check(
      undeclaredScopeCtx({
        attestationExempt: true,
        attestationExemptKind: "pipeline-unreachable",
      }),
    );

    expect(isCheckpointBlocked(results)).toBe(false);
  });

  // REGRESSION — precedence: a MEASURED coverage violation must keep reporting
  // the attestation-floor field, never be relabelled by the new branch. The two
  // causes need different recovery text ("attest what you declared" vs "declare
  // what you own"), so collapsing them would misdirect the operator.
  it("PCI-17 REGRESSION: a measured coverage failure still reports the attestation-floor field", () => {
    const results = planClose.check(
      undeclaredScopeCtx({ planDeclaredScopeCoverage: SCOPE_DECLARED_UNATTESTED }),
    );

    expect(isCheckpointBlocked(results)).toBe(true);
    expect(selectFailures(results).map((f) => f.field)).toContain(ATTESTATION_FLOOR_FIELD);
  });
});

// ─── AC-PCI-18: CONTROL — evidence alone never denies ───────────────────────

describe("plan-close still passes a declared, attested scope (PCI-18)", () => {
  // HAPPY — the control that makes AC-PCI-17 meaningful: the deny is
  // conditional on the UNDECLARED scope, not on evidence being present. A fix
  // that denied every evidence-bearing plan would be worse than the hole.
  it("PCI-18 HAPPY: the same evidence-bearing plan closes once its scope is declared and attested", () => {
    const results = planClose.check(
      undeclaredScopeCtx({ planDeclaredScopeCoverage: SCOPE_DECLARED_AND_ATTESTED }),
    );

    expect(isCheckpointBlocked(results)).toBe(false);
    expect(selectFailures(results)).toEqual([]);
  });

  // BOUNDARY — an EMPTY declaration (`ac_scope: []`) is a DECLARATION ("this
  // task claims nothing"), not silence. `deriveDeclaredScopeCoverage` keeps
  // `scope_undeclared: false` for it, and the close must proceed.
  it("PCI-18 BOUNDARY: an explicitly empty declaration is a declaration, and closes", () => {
    const results = planClose.check(
      undeclaredScopeCtx({
        planClaimedAcCoverage: [],
        planDeclaredScopeCoverage: {
          declared_acs: [],
          unattested_acs: [],
          scope_undeclared: false,
          meets_coverage: true,
        },
      }),
    );

    expect(isCheckpointBlocked(results)).toBe(false);
  });

  // NEGATIVE — proves this describe's pass is not blanket: declaring a scope
  // and leaving it unattested still blocks.
  it("PCI-18 NEGATIVE: declaring a scope does not by itself buy a close", () => {
    const results = planClose.check(
      undeclaredScopeCtx({ planDeclaredScopeCoverage: SCOPE_DECLARED_UNATTESTED }),
    );

    expect(isCheckpointBlocked(results)).toBe(true);
  });
});

// ─── AC-PCI-19: CONTROL — the pure-planning path survives ───────────────────

describe("plan-close leaves a zero-evidence plan advisory (PCI-19)", () => {
  // HAPPY — a plan that never ran an oracle closes, and its verdict stays on
  // the advisory channel as `notApplicable("no-evidence")`. This is the carve-
  // out AC-PCI-17 must not have broken: an undeclared scope with NOTHING to
  // audit is a genuine not-applicable.
  it("PCI-19 HAPPY: zero evidence anywhere still closes, with no-evidence advisory intact", () => {
    const results = planClose.check(
      undeclaredScopeCtx({
        planTasksAttestation: [EVIDENCE_FREE_TASK],
        planClaimedAcCoverage: [],
        // Undeclared AND evidence-free — the combination that must stay advisory.
        planDeclaredScopeCoverage: SCOPE_UNDECLARED_RESOLVED,
      }),
    );

    expect(isCheckpointBlocked(results)).toBe(false);
    expect(results.filter(isNotApplicable).map((r) => r.reason)).toContain("no-evidence");
  });

  // BOUNDARY — an EMPTY task list is the same "nothing to audit" fact.
  it("PCI-19 BOUNDARY: a plan with no tasks at all closes on the same advisory", () => {
    const results = planClose.check(
      undeclaredScopeCtx({ planTasksAttestation: [], planClaimedAcCoverage: [] }),
    );

    expect(isCheckpointBlocked(results)).toBe(false);
    expect(results.filter(isNotApplicable).map((r) => r.reason)).toContain("no-evidence");
  });

  // STATE — the carve-out is "no evidence ANYWHERE in the plan", never "some
  // task has no evidence". A plan mixing a pure-planning task with an
  // evidence-bearing undeclared one DENIES: the evidence-bearing half is
  // exactly the audited work AC-PCI-17 exists to catch.
  it("PCI-19 STATE: one evidence-bearing task among evidence-free ones still denies", () => {
    const results = planClose.check(
      undeclaredScopeCtx({ planTasksAttestation: [EVIDENCE_FREE_TASK, ATTESTED_TASK] }),
    );

    expect(isCheckpointBlocked(results)).toBe(true);
  });
});

// ─── AC-PCI-20: the vacuity signal ──────────────────────────────────────────

/**
 * A plan-close ctx whose EVERY conjunct is inapplicable — the "completely dark
 * gate" shape:
 *   - zero evidence anywhere         -> attestationFloor: notApplicable(no-evidence)
 *   - assessment freshness exempted  -> that predicate is not pushed at all
 *   - not UAT-gated, no exemption claimed -> neither predicate is pushed
 *   - cited-rule-state is two-valued (BR-984): with no violation list it is not pushed at all
 * `planClaimedAcCoverage` stays OMITTED and its companion push is suppressed by
 * the no-evidence reason, so the array holds exactly the one verdict above.
 * (Slice 3a retired the domain-doc predicate that used to contribute a second
 * notApplicable(referent-absent) verdict here; the notice now names one predicate.)
 */
function fullyInapplicableCtx(): GateContext {
  return {
    targetIdOrSlug: "plan-dark",
    planTasksAttestation: [],
    attestationMinRatio: null,
    assessmentFreshnessExempt: true,
  };
}

/** The notice `fullyInapplicableCtx()` must produce, spelled out in full rather
 *  than rebuilt from the same template the implementation uses — a test that
 *  re-derives the string cannot detect the string changing. */
const EXPECTED_DARK_NOTICE =
  'VACUOUS-GATE: checkpoint "plan-close" returned no verdict — all 1 predicate(s) ' +
  "reported notApplicable (no-evidence:plan-dark). " +
  "Nothing was measured, so this pass is not evidence of the checkpoint's invariant.";

describe("an all-inapplicable checkpoint run reports its own vacuity (PCI-20)", () => {
  // HAPPY — string EQUALITY, the AC's own wording. Never `toContain`, never
  // "the failure list is empty": an empty failure list is precisely what a
  // genuine pass also produces, which is the ambiguity being removed.
  it("PCI-20 HAPPY: a run whose every conjunct is notApplicable renders the exact vacuity notice", () => {
    const results = planClose.check(fullyInapplicableCtx());

    // Fixture integrity — if this ever stops holding, the equality below would
    // be measuring a different shape than the one the AC names.
    expect(results).toHaveLength(1);
    expect(results.filter(isNotApplicable)).toHaveLength(1);

    expect(describeCheckpointVacuity("plan-close", results)).toBe(EXPECTED_DARK_NOTICE);
  });

  // NEGATIVE — the control the AC demands: at least one APPLICABLE conjunct and
  // the string is absent entirely (null, not an empty string — an empty string
  // would still concatenate invisibly into a log line).
  it("PCI-20 NEGATIVE: a run with at least one applicable conjunct carries no vacuity notice", () => {
    const results = planClose.check(undeclaredScopeCtx());

    expect(results.some((r) => !isNotApplicable(r))).toBe(true);
    expect(describeCheckpointVacuity("plan-close", results)).toBeNull();
  });

  // BOUNDARY — one notApplicable next to one ordinary PASS is NOT vacuous. This
  // is the off-by-one that separates "nothing applied" from "something applied".
  it("PCI-20 BOUNDARY: a single applicable pass alongside a notApplicable suppresses the notice", () => {
    const inapplicable: ApplicablePredicateResult = {
      notApplicable: true,
      reason: "no-evidence",
      referent: "plan-x",
    };
    const mixed: ApplicablePredicateResult[] = [inapplicable, { ok: true }];

    expect(describeCheckpointVacuity("plan-close", mixed)).toBeNull();
    // …and the same entry WITHOUT the pass is vacuous — the pair proves the
    // condition keys on the pass, not on the array's length.
    expect(describeCheckpointVacuity("plan-close", [inapplicable])).toContain(
      VACUOUS_CHECKPOINT_NOTICE_PREFIX,
    );
  });

  // ERROR (empty-input shaped) — a checkpoint that ran NO predicates is a
  // different fact and must not be reported as vacuity; every opt-out
  // checkpoint would otherwise cry wolf on every call.
  it("PCI-20 ERROR: an empty results array is not vacuity and never throws", () => {
    expect(() => describeCheckpointVacuity("plan-close", [])).not.toThrow();
    expect(describeCheckpointVacuity("plan-close", [])).toBeNull();
  });

  // STATE — the notice reaches a SHIPPING surface. An exported builder with no
  // caller is a writer whose reader was retired (repo CLAUDE.md); this asserts
  // GateEnforcer.enforce actually emits it on the real close path, on stderr,
  // without disturbing the ok verdict.
  it("PCI-20 STATE: GateEnforcer.enforce writes the notice to stderr while still returning ok", () => {
    const written: string[] = [];
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: unknown): boolean => {
        written.push(String(chunk));
        return true;
      });
    try {
      const enforcer = new GateEnforcer(undefined);
      const result = enforcer.enforce("plan-close", fullyInapplicableCtx());

      // A not-applicable verdict NEVER denies — the notice is an observation.
      expect(result).toEqual({ ok: true, value: undefined });
      expect(written).toContain(`${EXPECTED_DARK_NOTICE}\n`);
    } finally {
      spy.mockRestore();
    }
  });

  // REGRESSION — the CONTROL for the STATE case above: the identical capture
  // rig, a ctx with an applicable conjunct, and nothing written. Without this,
  // a spy that silently captured everything (or nothing) would make the STATE
  // assertion unfalsifiable.
  it("PCI-20 REGRESSION: the same enforcer writes NO vacuity notice for an applicable run", () => {
    const written: string[] = [];
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: unknown): boolean => {
        written.push(String(chunk));
        return true;
      });
    try {
      const enforcer = new GateEnforcer(undefined);
      enforcer.enforce("plan-close", undeclaredScopeCtx());

      expect(written.some((line) => line.includes(VACUOUS_CHECKPOINT_NOTICE_PREFIX))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});
