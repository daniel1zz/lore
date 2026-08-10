/**
 * `plan-close`'s predicate PROVENANCE (task-report-why-each-plan-close-predicate-
 * passed-so-a-vacuous, spec-governance-visibility-an-armed-gate-that-vacuously-
 * passes §B1.1): every `plan-close` predicate must report WHY it passed — a
 * VACUOUS pass (no applicable data to measure) and a SATISFIED pass (data was
 * present and the invariant genuinely held) must carry a DISTINCT machine-readable
 * discriminator on `checkPlanClose`'s emitted results, never merely different
 * prose. `attestationFloor`/`prdOutlineSynced` already carry this discriminator
 * (`PredicateNotApplicable` vs. a bare `{ok: true}`) — `assessmentFreshness` was
 * the one flagged holdout: `describeCheckpointVacuity`'s own "Known limit" JSDoc
 * (checkpoint-registry.ts) named it BY NAME as returning a bare `{ok: true}` for
 * BOTH its genuinely-measured pass AND its own internal "no assessment / no task
 * activity to compare" vacuous carve-out, so a caller reading `checkPlanClose`'s
 * output — or the `--json` surface built on top of it — could never tell the two
 * apart. This suite is the RED-FIRST pin for that specific gap, and the GREEN
 * check that the fix closes it without inventing a fourth verdict shape.
 *
 * Every fixture below declares a VALID `attestation_exempt` (mirrors
 * `assessment-freshness.test.ts`'s `ATTESTATION_EXEMPT_EXTRA` precedent) and
 * opts out of `requires_uat`/`prd_sync` by omission, so `checkPlanClose`'s
 * results array contains EXACTLY the assessment-freshness conjunct's own
 * verdict — no ambiguity about which predicate produced which entry.
 *
 * Six-dimension coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 *
 * @spec_ref spec-governance-visibility-an-armed-gate-that-vacuously-passes §B1.1
 */

import { describe, it, expect } from "vitest";
import { isNotApplicable } from "../../../src/service/gate-predicates.js";
import { checkpointRegistry, type GateContext } from "../../../src/service/checkpoint-registry.js";

const planClose = checkpointRegistry["plan-close"];
if (planClose === undefined) {
  throw new Error("plan-close checkpoint not registered — test fixture assumption broken");
}

/**
 * Isolates the assessment-freshness conjunct: a valid attestation exemption
 * keeps `attestationFloor` (and its Amendment-A companion push) out of the
 * results array entirely; no `requires_uat`/`prd_sync` opt-in leaves those
 * predicates unpushed too. Whatever `checkPlanClose` returns for a ctx built
 * from this helper is therefore EXCLUSIVELY the assessment-freshness verdict.
 */
function isolatedCtx(overrides: Partial<GateContext> = {}): GateContext {
  return {
    targetIdOrSlug: "plan-provenance",
    attestationExempt: true,
    attestationExemptKind: "no-oracle",
    ...overrides,
  };
}

describe("plan-close predicate provenance — vacuous-vs-satisfied discriminator (AC-GV-1)", () => {
  // HAPPY — a genuinely MEASURED pass (both timestamps present, the assessment
  // postdates the newest task activity) is a bare `{ok: true}` — a real
  // invariant check that ran against real data and held.
  it("vacuous-vs-satisfied: a genuinely measured pass reports {ok: true}, never notApplicable", () => {
    const results = planClose.check(
      isolatedCtx({
        newestAssessmentAt: "2026-08-01T12:00:00.000Z",
        newestTaskActivityAt: "2026-08-01T10:00:00.000Z",
      }),
    );

    expect(results).toHaveLength(1);
    const [entry] = results;
    expect(isNotApplicable(entry!)).toBe(false);
    expect(entry).toEqual({ ok: true });
  });

  // NEGATIVE (the RED case this task closes) — NO data at all (no linked
  // assessment, no task audit activity anywhere) is a VACUOUS pass: it must NOT
  // render as the SAME `{ok: true}` shape the genuinely-measured pass above
  // produces — that collapse is exactly the defect (a vacuous pass "lends its
  // authority" to a satisfied one).
  it("vacuous-vs-satisfied: a vacuous pass (no assessment, no task activity) reports a DISTINCT notApplicable discriminator, never bare {ok: true}", () => {
    const results = planClose.check(isolatedCtx());

    expect(results).toHaveLength(1);
    const [entry] = results;
    expect(isNotApplicable(entry!)).toBe(true);
    expect(entry).not.toEqual({ ok: true });
    if (isNotApplicable(entry!)) {
      expect(entry.reason).toBe("no-evidence");
      expect(entry.referent).toBe("plan-provenance");
    }
    // Structural (machine-readable), not prose-based: a bare {ok:true} never
    // carries a `notApplicable` key, and a notApplicable verdict never carries `ok`.
    expect("notApplicable" in entry!).toBe(true);
    expect("ok" in entry!).toBe(false);
  });

  // BOUNDARY — only ONE side missing (an assessment exists but no task ever ran
  // an oracle) is ALSO vacuous: the predicate has no second fact to compare
  // against, so it must not silently invent a measured pass from half a fact.
  it("vacuous-vs-satisfied: one-sided data (assessment present, no task activity) is still vacuous, not measured", () => {
    const results = planClose.check(isolatedCtx({ newestAssessmentAt: "2026-08-01T12:00:00.000Z" }));

    expect(results).toHaveLength(1);
    expect(isNotApplicable(results[0]!)).toBe(true);
  });

  // BOUNDARY — the mirror case: task activity exists, but no assessment was
  // ever recorded for this plan.
  it("vacuous-vs-satisfied: one-sided data (task activity present, no assessment) is still vacuous, not measured", () => {
    const results = planClose.check(isolatedCtx({ newestTaskActivityAt: "2026-08-01T10:00:00.000Z" }));

    expect(results).toHaveLength(1);
    expect(isNotApplicable(results[0]!)).toBe(true);
  });

  // STATE — the two outcomes never collapse to the same JSON text, which is the
  // exact surface a `--json` consumer reads: "satisfied" and "vacuous" must
  // diverge in the serialized bytes, not just in a human-prose message.
  it("vacuous-vs-satisfied: the vacuous and satisfied verdicts serialize to DIFFERENT JSON, never identical text", () => {
    const satisfied = planClose.check(
      isolatedCtx({
        newestAssessmentAt: "2026-08-01T12:00:00.000Z",
        newestTaskActivityAt: "2026-08-01T10:00:00.000Z",
      }),
    )[0];
    const vacuous = planClose.check(isolatedCtx())[0];

    expect(JSON.stringify(satisfied)).not.toBe(JSON.stringify(vacuous));
  });

  // ERROR (a genuine denial) — a MEASURED failure (the assessment IS stale) is
  // its own third, distinct shape: never confused with either pass outcome, and
  // never itself rendered as notApplicable — a real denial is not "nothing to
  // measure", it is a measured violation.
  it("vacuous-vs-satisfied: a measured FAILURE (stale assessment) is a third distinct shape, not notApplicable", () => {
    const results = planClose.check(
      isolatedCtx({
        newestAssessmentAt: "2026-08-01T10:00:00.000Z",
        newestTaskActivityAt: "2026-08-01T12:00:00.000Z",
      }),
    );

    expect(results).toHaveLength(1);
    const [entry] = results;
    expect(isNotApplicable(entry!)).toBe(false);
    expect(entry).toMatchObject({ ok: false });
  });

  // REGRESSION — a plan declaring a VALID `assessment_freshness_exempt` still
  // short-circuits the conjunct out of the results array ENTIRELY, unchanged by
  // this fix: the discriminator only applies to a conjunct that actually runs.
  it("vacuous-vs-satisfied REGRESSION: an exempted plan pushes NEITHER discriminator — the conjunct never runs", () => {
    const results = planClose.check(
      isolatedCtx({
        assessmentFreshnessExempt: true,
        newestAssessmentAt: "2026-08-01T10:00:00.000Z",
        newestTaskActivityAt: "2026-08-01T12:00:00.000Z",
      }),
    );

    expect(results).toHaveLength(0);
  });
});
