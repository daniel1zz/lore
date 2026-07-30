/**
 * RED suite (paired-impl task-t1-applicability-verdict-in-the-predicate-s-own-
 * type-both) for spec-plan-close-predicates-measure-invariants-an-applicability
 * §Design Decisions D1/D2 — "my referent is absent, so I do not apply" as a
 * VALUE a predicate returns (`PredicateNotApplicable`/`ApplicablePredicateResult`,
 * `gate-predicates.ts`), wired into BOTH `plan-close` predicates that need it
 * (`prdOutlineSynced`, `attestationFloor`) and into `GateEnforcer.enforce`'s
 * partition (`checkpoint-registry.ts` / `gate-enforcer.ts`).
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
import { ok } from "@lore/core";
import type { LoreConfig, AcCoverageFact } from "@lore/core";
import {
  prdOutlineSynced,
  attestationFloor,
  isNotApplicable,
  noAnchorOverlap,
  PRD_SYNC_FIELD,
  PRD_SYNC_NOT_SYNCED_REASON,
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
  // HAPPY — the pinned contract: notApplicable===true, reason==="referent-absent",
  // a non-empty referent, and NO "ok" property (asserted via "ok" in result === false).
  it("HAPPY: prdOutlineSynced(null, referent) returns a notApplicable value with no ok property", () => {
    const result = prdOutlineSynced(null, "spec-x");
    expect(result).toEqual({ notApplicable: true, reason: "referent-absent", referent: "spec-x" });
    expect("ok" in result).toBe(false);
    expect((result as { referent: string }).referent.length).toBeGreaterThan(0);
  });

  // NEGATIVE — a real pass is a plain PredicateResult, never notApplicable.
  it("NEGATIVE: prdOutlineSynced(true, referent) is a plain pass, never notApplicable", () => {
    const result = prdOutlineSynced(true, "spec-x");
    expect(result).toEqual({ ok: true });
    expect("notApplicable" in result).toBe(false);
  });

  // NEGATIVE — a real fail keeps its existing reason/field, never notApplicable.
  it("NEGATIVE: prdOutlineSynced(false, referent) is a plain fail carrying the existing reason/field", () => {
    const result = prdOutlineSynced(false, "spec-x");
    expect(result).toEqual({ ok: false, reason: PRD_SYNC_NOT_SYNCED_REASON, field: PRD_SYNC_FIELD });
    expect("notApplicable" in result).toBe(false);
  });

  // BOUNDARY — attestationFloor's OWN not-applicable case (zero evidence anywhere)
  // shares the identical shape, with a DIFFERENT reason and the PLAN's referent.
  it("BOUNDARY: attestationFloor with zero evidence anywhere returns notApplicable naming the plan referent", () => {
    const result = attestationFloor([], 0.5, "plan-x", NO_DECLARED_ACS);
    expect(result).toEqual({ notApplicable: true, reason: "no-evidence", referent: "plan-x" });
    expect("ok" in result).toBe(false);
  });

  // STATE — attestationFloor transitions notApplicable -> fail -> pass purely as a
  // function of its `tasks` input (no evidence -> some evidence under floor -> evidence meeting floor).
  it("STATE: attestationFloor moves from notApplicable to fail to pass as evidence accumulates", () => {
    const noEvidence = attestationFloor(undefined, 0.5, "plan-x", NO_DECLARED_ACS);
    expect(isNotApplicable(noEvidence)).toBe(true);

    const underFloor = attestationFloor(
      [{ slug: "task-1", title: "T1", evidenceCount: 4, attestedCount: 0 }],
      0.5,
      "plan-x",
      NO_DECLARED_ACS,
    );
    expect(isNotApplicable(underFloor)).toBe(false);
    expect(underFloor).toEqual({ ok: false, reason: ATTESTATION_FLOOR_REASON, field: ATTESTATION_FLOOR_FIELD });

    const meetsFloor = attestationFloor(
      [{ slug: "task-1", title: "T1", evidenceCount: 2, attestedCount: 2 }],
      0.5,
      "plan-x",
      NO_DECLARED_ACS,
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

describe("checkPlanClose — never a fail on an absent domain doc (AC-PCI-2)", () => {
  function baseCtx(overrides: Partial<GateContext>): GateContext {
    return {
      targetIdOrSlug: "plan-x",
      attestationMinRatio: 0.5,
      // reason: real, attested, floor-meeting evidence — isolates THIS group's
      // assertions to the prd-sync predicate's own contribution, mirroring
      // attestation-exempt-kind.test.ts's isolation-via-fixture precedent.
      planTasksAttestation: [{ slug: "task-1", title: "T1", evidenceCount: 1, attestedCount: 1 }],
      // reason: Amendment A (task-t3, §D3) — this group's fixtures pre-date the
      // per-claimed-AC coverage conjunct and never meant to say anything about
      // it; an explicit `NO_DECLARED_ACS` makes that intent visible instead of
      // silently omitting the field, which — post-Amendment-A — pushes its OWN
      // companion `notApplicable` verdict (referent "planClaimedAcCoverage")
      // that these prd-sync-focused assertions never anticipated.
      planClaimedAcCoverage: NO_DECLARED_ACS,
      prdSyncEnabled: true,
      parentSpecPointer: { slug: "spec-x", title: "Spec X", status: "approved" },
      ...overrides,
    };
  }

  // HAPPY — the pinned contract: an absent domain doc (prdSyncSynced: null)
  // produces NO entry with field "prd-outline-synced" and no ok:false entry
  // attributable to prd_sync; the not-applicable verdict rides its own channel;
  // the checkpoint overall is NOT blocked by it.
  it("HAPPY: an absent domain doc renders no prd-outline-synced failure and does not block the checkpoint", () => {
    const ctx = baseCtx({ prdSyncSynced: null });
    const results = planClose.check(ctx);

    const failures = selectFailures(results);
    expect(failures.some((f) => f.field === PRD_SYNC_FIELD)).toBe(false);
    expect(
      results.some((r) => "notApplicable" in r && r.reason === "referent-absent" && r.referent === "spec-x"),
    ).toBe(true);
    expect(isCheckpointBlocked(results)).toBe(false);
  });

  // NEGATIVE — contrast case: a domain doc that DOES resolve but isn't
  // in-window-synced (prdSyncSynced: false) DOES produce a real ok:false entry —
  // proving the mechanism differentiates "absent" from "present but violating".
  it("NEGATIVE: a resolved-but-unsynced domain doc still produces a real prd-outline-synced failure", () => {
    const ctx = baseCtx({ prdSyncSynced: false });
    const results = planClose.check(ctx);

    const failures = selectFailures(results);
    expect(failures.some((f) => f.field === PRD_SYNC_FIELD)).toBe(true);
    expect(results.some((r) => "notApplicable" in r)).toBe(false);
    expect(isCheckpointBlocked(results)).toBe(true);
  });

  // BOUNDARY — a domain doc that resolves AND is in-window-synced produces a
  // plain pass, no notApplicable member anywhere.
  it("BOUNDARY: a resolved and synced domain doc produces a plain pass, never notApplicable", () => {
    const ctx = baseCtx({ prdSyncSynced: true });
    const results = planClose.check(ctx);

    expect(results.some((r) => "notApplicable" in r)).toBe(false);
    expect(isCheckpointBlocked(results)).toBe(false);
  });

  // STATE — when the plan has NO spec-tier ancestor at all, `prdSyncSynced` is
  // never populated (`undefined`, not `null`) — a DIFFERENT state from
  // referent-absent: the predicate does not even PUSH an entry (checkpoint-level
  // vacuous pass), vs. pushing a notApplicable entry.
  it("STATE: no spec-tier ancestor at all (prdSyncSynced undefined) pushes no prd-sync entry whatsoever", () => {
    // reason: built directly (not via `baseCtx`'s override spread) — under
    // `exactOptionalPropertyTypes`, explicitly assigning `undefined` to an
    // optional `GateContext` field to "clear" a default is a type error; the
    // point of THIS scenario is that `prdSyncSynced`/`parentSpecPointer` are
    // simply ABSENT, never populated at all.
    const ctx: GateContext = {
      targetIdOrSlug: "plan-x",
      attestationMinRatio: 0.5,
      planTasksAttestation: [{ slug: "task-1", title: "T1", evidenceCount: 1, attestedCount: 1 }],
      // reason: Amendment A — see `baseCtx`'s identical comment above; this
      // fixture is built directly (not via `baseCtx`) but carries the same
      // "no declared ACs" intent explicitly.
      planClaimedAcCoverage: NO_DECLARED_ACS,
      prdSyncEnabled: true,
    };
    const results = planClose.check(ctx);

    expect(results.some((r) => "notApplicable" in r)).toBe(false);
    expect(selectFailures(results).some((f) => f.field === PRD_SYNC_FIELD)).toBe(false);
    expect(isCheckpointBlocked(results)).toBe(false);
  });

  // ERROR (config-shaped) — the prd_sync knob disabled entirely means the
  // predicate never runs regardless of `prdSyncSynced`, even when it's `null`.
  it("ERROR: prd_sync disabled by config means the predicate never runs even with a null referent", () => {
    const ctx = baseCtx({ prdSyncEnabled: false, prdSyncSynced: null });
    const results = planClose.check(ctx);

    expect(results.some((r) => "notApplicable" in r)).toBe(false);
    expect(selectFailures(results).some((f) => f.field === PRD_SYNC_FIELD)).toBe(false);
  });

  // REGRESSION — an absent domain doc leaves every OTHER plan-close predicate's
  // verdict untouched (attestationFloor here still passes on its own merits).
  it("REGRESSION: an absent domain doc does not perturb attestationFloor's own passing verdict", () => {
    const ctx = baseCtx({ prdSyncSynced: null });
    const results = planClose.check(ctx);

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
      planClaimedAcCoverage: NO_DECLARED_ACS,
      prdSyncEnabled: true,
      prdSyncSynced: null,
      parentSpecPointer: { slug: "spec-x", title: "Spec X", status: "approved" },
    };
  }

  // HAPPY — the pinned contract: enforce() returns ok (never a deny) AND
  // records exactly one best-effort audit row naming the absent referent.
  it("HAPPY: enforce returns ok and records one audit row naming the absent referent", () => {
    const recordGateSkip = vi.fn<RecordGateSkip>().mockResolvedValue(ok(undefined));
    const enforcer = new GateEnforcer(undefined, recordGateSkip);

    const result = enforcer.enforce("plan-close", notApplicableCtx());

    expect(result).toEqual({ ok: true, value: undefined });
    expect(recordGateSkip).toHaveBeenCalledTimes(1);
    const entry = recordGateSkip.mock.calls[0]![0];
    expect(entry.action).toBe("gate_not_applicable");
    expect(entry.details).toMatchObject({
      checkpoint: "plan-close",
      kind: "prd-sync-domain-doc",
      referent: "spec-x",
    });
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
  // proving the reason -> kind mapping covers both producers, not just prd-sync.
  it("BOUNDARY: a zero-evidence plan is audited with the attestation-not-applicable kind", () => {
    const recordGateSkip = vi.fn<RecordGateSkip>().mockResolvedValue(ok(undefined));
    const enforcer = new GateEnforcer(undefined, recordGateSkip);
    const ctx: GateContext = { targetIdOrSlug: "plan-y", attestationMinRatio: 0.5, planTasksAttestation: [] };

    const result = enforcer.enforce("plan-close", ctx);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(recordGateSkip).toHaveBeenCalledTimes(1);
    const entry = recordGateSkip.mock.calls[0]![0];
    expect(entry.details).toMatchObject({
      checkpoint: "plan-close",
      kind: "attestation-not-applicable",
      referent: "plan-y",
    });
  });

  // STATE — a NORMAL (no not-applicable verdicts) enforce() call never touches
  // the not-applicable audit path at all.
  it("STATE: a plan-close call with no not-applicable verdicts never fires the not-applicable audit", () => {
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
    };

    const result = enforcer.enforce("plan-close", ctx);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(recordGateSkip).not.toHaveBeenCalled();
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

// ─── T8 Part 2: notApplicableAdvisoryKind is keyed per-referent ───────────
//
// Task-level oracle (task-t8-repair-the-t3-t4-integration-regression-6-under,
// not a new spec AC) — spec-plan-close-predicates-measure-invariants-an-
// applicability §D2 says an inapplicable verdict's advisory kind must never
// mislabel its subject. `gate-enforcer.ts`'s `notApplicableAdvisoryKind` used
// to map EVERY `reason: "referent-absent"` to `"prd-sync-domain-doc"` — true
// only while `prdOutlineSynced` was the sole producer of that reason. T4's
// Amendment A companion push (`checkPlanClose`, checkpoint-registry.ts) now
// ALSO produces `reason: "referent-absent"`, with `referent:
// "planClaimedAcCoverage"` — a fixed sentinel, never a real spec slug — so
// keying on `reason` alone conflates two unrelated audit subjects.
describe("GateEnforcer.enforce — notApplicableAdvisoryKind is keyed per-referent (T8 Part 2)", () => {
  // HAPPY — a SINGLE ctx that trips BOTH producers of `reason: "referent-
  // absent"` simultaneously (an absent domain doc AND an unresolved
  // planClaimedAcCoverage caller-contract violation) must record two audit
  // rows carrying their OWN distinct kind — proving the mapping is per-
  // referent, not per-reason, and that neither producer's kind leaks onto
  // the other's row.
  it("HAPPY: a domain-doc referent and a planClaimedAcCoverage referent map to distinct kinds on the SAME enforce() call", () => {
    const recordGateSkip = vi.fn<RecordGateSkip>().mockResolvedValue(ok(undefined));
    const enforcer = new GateEnforcer(undefined, recordGateSkip);
    // reason: `planClaimedAcCoverage` is deliberately OMITTED (not `NO_DECLARED_ACS`)
    // — that omission IS the Amendment A companion-push trigger under test,
    // paired with a real absent domain doc (`prdSyncSynced: null`) so both
    // "referent-absent" producers fire on the SAME `checkPlanClose` call.
    const ctx: GateContext = {
      targetIdOrSlug: "plan-x",
      attestationMinRatio: 0.5,
      planTasksAttestation: [{ slug: "task-1", title: "T1", evidenceCount: 1, attestedCount: 1 }],
      prdSyncEnabled: true,
      prdSyncSynced: null,
      parentSpecPointer: { slug: "spec-y", title: "Spec Y", status: "approved" },
    };

    const result = enforcer.enforce("plan-close", ctx);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(recordGateSkip).toHaveBeenCalledTimes(2);
    const details = recordGateSkip.mock.calls.map(
      (call) => call[0]!.details as { kind: string; referent: string },
    );
    const coverageEntry = details.find((d) => d.referent === "planClaimedAcCoverage");
    const domainDocEntry = details.find((d) => d.referent === "spec-y");
    expect(coverageEntry?.kind).toBe("attestation-not-applicable");
    expect(domainDocEntry?.kind).toBe("prd-sync-domain-doc");
  });

  // NEGATIVE — attestationFloor's OWN zero-evidence not-applicable case
  // (reason "no-evidence") must still map to "attestation-not-applicable",
  // proving the per-referent fix did not disturb the pre-existing reason-
  // keyed branch for the producer that has no competing referent.
  it("NEGATIVE: attestationFloor's zero-evidence not-applicable still maps to attestation-not-applicable", () => {
    const recordGateSkip = vi.fn<RecordGateSkip>().mockResolvedValue(ok(undefined));
    const enforcer = new GateEnforcer(undefined, recordGateSkip);
    const ctx: GateContext = { targetIdOrSlug: "plan-y", attestationMinRatio: 0.5, planTasksAttestation: [] };

    enforcer.enforce("plan-close", ctx);

    expect(recordGateSkip).toHaveBeenCalledTimes(1);
    const entry = recordGateSkip.mock.calls[0]![0];
    expect(entry.details).toMatchObject({ kind: "attestation-not-applicable", referent: "plan-y" });
  });
});
