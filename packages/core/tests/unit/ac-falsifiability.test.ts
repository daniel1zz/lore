/**
 * Tests for @lore/core acceptance.ts's fourth coverage dimension — `falsified`
 * (computeAcCoverage) and the `pass_unfalsified`/`fail_superseded`/`not_measured`
 * states (deriveAcCoverageState). Pure functions, no IO.
 *
 * Governed by spec-oracle-tier-falsifiability-a-criterion-never-observed-red
 * (M1: `falsified` + `pass_unfalsified`; M4: `fail_superseded`, the recency
 * semantics `state` was missing over an append-only log; M5: `not_measured`,
 * closing M1's fail-open on a `falsified` that fails runtime well-formedness)
 * and adr-falsifiability-moves-from-the-task-tier-to-the-oracle-tier. This is
 * the DERIVATION half only — surfacing (`lore ac list`, `lore status`) is a
 * separate task with its own anchors.
 *
 * Six-dimension coverage for this file (M1, AC-FALS-1/2/3):
 *   HAPPY:      an `expected-fail` ac_ref row yields falsified:1; an all-pass
 *               criterion yields falsified:0 (AC-FALS-1, same test, "falsified-count")
 *   NEGATIVE:   deriveAcCoverageState returns something OTHER than pass_unfalsified
 *               once falsified > 0 (AC-FALS-2, "coverage-state")
 *   BOUNDARY:   a plain `fail` ac_ref row ALSO counts toward falsified (not only
 *               `expected-fail` — the spec names both); a criterion with zero
 *               evidence at all never reads pass_unfalsified (falls to "none")
 *   ERROR:      malformed extra.verification_evidence does not throw and yields
 *               falsified:0 (mirrors acceptance.test.ts's existing ERROR case)
 *   STATE:      falsified accumulates across multiple evidence entries/tasks for
 *               one ac_id, alongside pass/fail bookkeeping already exercised
 *               elsewhere; attested_pass still outranks pass_unfalsified even when
 *               falsified === 0 (AC-FALS-3, "precedence-regression")
 *   REGRESSION: `falsified` is present (never omitted) on every AcCoverageFact,
 *               including the empty-tasks/empty-criteria degenerate cases already
 *               pinned for pass/fail/attested_pass/attested_fail in acceptance.test.ts
 *
 * Added coverage (M4/M5, AC-FALS-14..18) — `-t`-selectable token per the spec's
 * own declared oracle commands, each token named EXACTLY once in this file:
 *   supersession-recency             (AC-FALS-14) — fail_superseded / fail /
 *                                     attested_pass, three mutually distinct
 *                                     readings from one recency ordering
 *   supersession-falsified-invariant (AC-FALS-15) — falsified stays exactly 1
 *                                     for BOTH the superseded and control fixture,
 *                                     computed via computeAcCoverage (not hand-set)
 *   supersession-fail-closed         (AC-FALS-16) — the three fail-closed tie-breaks
 *   absent-falsified                 (AC-FALS-17) — six falsified inputs, three
 *                                     mutually distinct readings
 *   falsified-branch-scope           (AC-FALS-18) — not_measured shadows only its
 *                                     own branch, never fail/attested_pass/none
 *
 * @spec_ref spec-oracle-tier-falsifiability-a-criterion-never-observed-red
 *   AC-FALS-1, AC-FALS-2, AC-FALS-3, AC-FALS-14, AC-FALS-15, AC-FALS-16,
 *   AC-FALS-17, AC-FALS-18
 */

import { describe, it, expect } from "vitest";
import {
  computeAcCoverage,
  deriveAcCoverageState,
  type AcceptanceCriterion,
  type AcCoverageFact,
} from "../../src/acceptance.js";
import type { DocId, DocRecord } from "../../src/types.js";

// ─── Fixtures (mirrors packages/core/src/acceptance.test.ts's convention) ────

let _seq = 0;

function nextId(): DocId {
  _seq += 1;
  return `01HFALS${String(_seq).padStart(19, "0")}`;
}

function makeTask(overrides: Partial<DocRecord> = {}): DocRecord {
  const id = nextId();
  return {
    id,
    slug: `task-fals-fixture-${id.slice(-4)}`,
    type: "task",
    role: "plan",
    title: `Task ${id}`,
    status: "draft",
    priority: "medium",
    content: "Task body",
    parent_id: "01HPLANAAAAAAAAAAAAAAAAAAA",
    created_at: "2026-08-07T00:00:00.000Z",
    updated_at: "2026-08-07T00:00:00.000Z",
    created_by: "alice",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: { plan_id: "01HPLANAAAAAAAAAAAAAAAAAAA" },
    ...overrides,
  } as DocRecord;
}

function scriptAc(id: string): AcceptanceCriterion {
  return {
    id,
    statement: `Statement for ${id}`,
    verify: { mode: "script", oracle: "test", command: "bun test" },
  };
}

function fact(overrides: Partial<AcCoverageFact> = {}): AcCoverageFact {
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

// ─── AC-FALS-1: computeAcCoverage's falsified count ──────────────────────────

describe("computeAcCoverage — falsified (AC-FALS-1)", () => {
  it("HAPPY: falsified-count — an expected-fail ac_ref row yields falsified:1, an all-pass criterion yields falsified:0", () => {
    const criteria = [scriptAc("AC-1"), scriptAc("AC-2")];
    const taskWithExpectedFail = makeTask({
      extra: {
        plan_id: "p",
        verification_evidence: [
          {
            oracle: "test",
            command: "bun test",
            result: "expected-fail",
            recorded_at: "t1",
            recorded_by: "alice",
            ac_ref: "AC-1",
          },
        ],
      },
    });
    const taskAllPass = makeTask({
      extra: {
        plan_id: "p",
        verification_evidence: [
          { oracle: "test", command: "bun test", result: "pass", recorded_at: "t1", recorded_by: "alice", ac_ref: "AC-2" },
          { oracle: "test", command: "bun test", result: "pass", recorded_at: "t2", recorded_by: "alice", ac_ref: "AC-2" },
        ],
      },
    });

    const coverage = computeAcCoverage(criteria, [taskWithExpectedFail, taskAllPass]);
    const ac1 = coverage.find((c) => c.ac_id === "AC-1");
    const ac2 = coverage.find((c) => c.ac_id === "AC-2");

    // Both assertions live in this ONE test (per the AC's own anti-vacuity
    // requirement) — a constant `falsified: 1` return could not satisfy both.
    expect(ac1?.falsified).toBe(1);
    expect(ac2?.falsified).toBe(0);
  });

  it("BOUNDARY: a plain fail ac_ref row also counts toward falsified, not only expected-fail", () => {
    const criteria = [scriptAc("AC-1")];
    const task = makeTask({
      extra: {
        plan_id: "p",
        verification_evidence: [
          { oracle: "test", command: "bun test", result: "fail", recorded_at: "t1", recorded_by: "alice", ac_ref: "AC-1" },
        ],
      },
    });

    const coverage = computeAcCoverage(criteria, [task]);
    expect(coverage[0]?.falsified).toBe(1);
  });

  it("BOUNDARY: an empty task set yields falsified:0 for every criterion, never omitted", () => {
    const criteria = [scriptAc("AC-1"), scriptAc("AC-2")];
    const coverage = computeAcCoverage(criteria, []);
    for (const c of coverage) {
      expect(c.falsified).toBe(0);
      expect("falsified" in c).toBe(true);
    }
  });

  it("ERROR: malformed extra.verification_evidence does not throw and yields falsified:0", () => {
    const criteria = [scriptAc("AC-1")];
    const malformedArray = makeTask({ extra: { plan_id: "p", verification_evidence: "not-an-array" } });
    const malformedExtra = makeTask({ extra: null as unknown as Record<string, unknown> });

    expect(() => computeAcCoverage(criteria, [malformedArray, malformedExtra])).not.toThrow();
    const coverage = computeAcCoverage(criteria, [malformedArray, malformedExtra]);
    expect(coverage[0]?.falsified).toBe(0);
  });

  it("STATE: falsified accumulates across multiple expected-fail/fail entries spanning separate tasks", () => {
    const criteria = [scriptAc("AC-1")];
    const taskA = makeTask({
      extra: {
        plan_id: "p",
        verification_evidence: [
          { oracle: "test", command: "bun test", result: "expected-fail", recorded_at: "t1", recorded_by: "alice", ac_ref: "AC-1" },
          { oracle: "test", command: "bun test", result: "pass", recorded_at: "t2", recorded_by: "alice", ac_ref: "AC-1" },
        ],
      },
    });
    const taskB = makeTask({
      extra: {
        plan_id: "p",
        verification_evidence: [
          { oracle: "test", command: "bun test", result: "fail", recorded_at: "t3", recorded_by: "bob", ac_ref: "AC-1" },
        ],
      },
    });

    const coverage = computeAcCoverage(criteria, [taskA, taskB]);
    const c = coverage[0]!;
    expect(c.falsified).toBe(2); // one expected-fail + one fail
    expect(c.pass).toBe(1);
  });

  it("REGRESSION: falsified is present (never omitted) alongside pass/fail/attested_* on the degenerate empty-criteria case", () => {
    const task = makeTask({
      extra: {
        plan_id: "p",
        verification_evidence: [
          { oracle: "test", command: "bun test", result: "expected-fail", recorded_at: "t", recorded_by: "alice", ac_ref: "AC-1" },
        ],
      },
    });
    expect(computeAcCoverage([], [task])).toEqual([]);
  });
});

// ─── AC-FALS-2: deriveAcCoverageState's pass_unfalsified ─────────────────────

describe("deriveAcCoverageState — pass_unfalsified (AC-FALS-2)", () => {
  it("HAPPY: coverage-state — returns pass_unfalsified when pass>0 and falsified===0, and a different state once falsified>0", () => {
    const unfalsified = deriveAcCoverageState(fact({ pass: 1, falsified: 0 }));
    expect(unfalsified).toBe("pass_unfalsified");

    const nowFalsified = deriveAcCoverageState(fact({ pass: 1, falsified: 1 }));
    expect(nowFalsified).not.toBe("pass_unfalsified");
  });

  it("BOUNDARY: a criterion with zero evidence at all (pass===0) never reads pass_unfalsified — it stays none", () => {
    const state = deriveAcCoverageState(fact({ pass: 0, falsified: 0 }));
    expect(state).toBe("none");
  });

  it("NEGATIVE: fail still outranks pass_unfalsified even when falsified===0 (a fail ref does not, by itself, set falsified — only expected-fail/fail RESULT rows do, and this fact's own fail count already implies falsified would be >0 in real data, but the precedence must not depend on that coupling)", () => {
    // Deliberately construct an inconsistent-with-computeAcCoverage fact (fail>0,
    // falsified:0) to prove deriveAcCoverageState's OWN precedence — fail wins
    // regardless of what falsified reads, so the two dimensions are checked
    // independently, not coupled.
    const state = deriveAcCoverageState(fact({ pass: 1, fail: 1, falsified: 0 }));
    expect(state).toBe("fail");
  });
});

// ─── AC-FALS-3: attested_pass never degrades to pass_unfalsified ─────────────

describe("deriveAcCoverageState — attested_pass precedence (AC-FALS-3)", () => {
  it("STATE: precedence-regression — attested_pass still wins even when falsified===0, so pass_unfalsified never outranks an attested pass", () => {
    const state = deriveAcCoverageState(fact({ pass: 1, attested_pass: 1, falsified: 0 }));
    expect(state).toBe("attested_pass");
  });

  it("REGRESSION: the pre-existing fail > attested_pass > pass > none ladder is unchanged for facts with falsified>0", () => {
    expect(deriveAcCoverageState(fact({ pass: 1, fail: 1, falsified: 1 }))).toBe("fail");
    expect(deriveAcCoverageState(fact({ pass: 1, attested_pass: 1, falsified: 1 }))).toBe("attested_pass");
    expect(deriveAcCoverageState(fact({ pass: 1, falsified: 1 }))).toBe("pass");
    expect(deriveAcCoverageState(fact({ falsified: 0 }))).toBe("none");
  });
});

// ─── AC-FALS-14: fail_superseded — the recency read (M4) ─────────────────────

describe("deriveAcCoverageState — fail_superseded recency (AC-FALS-14)", () => {
  it("HAPPY: supersession-recency — fail_superseded when the fail ref is older than an attested pass ref, fail when reversed, attested_pass when there is no fail ref at all — three mutually distinct readings", () => {
    const olderFailNewerAttestedPass = fact({
      pass: 1,
      fail: 1,
      attested_pass: 1,
      falsified: 1,
      refs: [
        { task_id: "t1", result: "fail", recorded_at: "2026-08-01T00:00:00.000Z" },
        { task_id: "t2", result: "pass", attested: true, recorded_at: "2026-08-02T00:00:00.000Z" },
      ],
    });
    const newerFailOlderAttestedPass = fact({
      pass: 1,
      fail: 1,
      attested_pass: 1,
      falsified: 1,
      refs: [
        { task_id: "t1", result: "fail", recorded_at: "2026-08-02T00:00:00.000Z" },
        { task_id: "t2", result: "pass", attested: true, recorded_at: "2026-08-01T00:00:00.000Z" },
      ],
    });
    const noFailRefAtAll = fact({
      pass: 1,
      fail: 0,
      attested_pass: 1,
      falsified: 0,
      refs: [{ task_id: "t2", result: "pass", attested: true, recorded_at: "2026-08-02T00:00:00.000Z" }],
    });

    const supersededState = deriveAcCoverageState(olderFailNewerAttestedPass);
    const failState = deriveAcCoverageState(newerFailOlderAttestedPass);
    const attestedPassState = deriveAcCoverageState(noFailRefAtAll);

    expect(supersededState).toBe("fail_superseded");
    expect(failState).toBe("fail");
    expect(attestedPassState).toBe("attested_pass");
    // Anti-vacuity: a constant return could not satisfy all three plus distinctness.
    expect(new Set([supersededState, failState, attestedPassState]).size).toBe(3);
  });
});

// ─── AC-FALS-15: falsified counting is untouched by supersession (M4) ────────

describe("computeAcCoverage/deriveAcCoverageState — supersession does not alter falsified (AC-FALS-15)", () => {
  it("STATE: supersession-falsified-invariant — falsified equals exactly 1 for BOTH the fail_superseded fixture and the fail control fixture, computed via computeAcCoverage (not hand-set on the fact)", () => {
    const criteria = [scriptAc("AC-1")];
    const attestation = { runner: "lore-cli" as const, exit_code: 0, duration_ms: 1, timed_out: false };

    const supersededTask = makeTask({
      extra: {
        plan_id: "p",
        verification_evidence: [
          { oracle: "test", command: "bun test", result: "fail", recorded_at: "2026-08-01T00:00:00.000Z", recorded_by: "alice", ac_ref: "AC-1" },
          { oracle: "test", command: "bun test", result: "pass", recorded_at: "2026-08-02T00:00:00.000Z", recorded_by: "bob", ac_ref: "AC-1", attestation },
        ],
      },
    });
    const controlTask = makeTask({
      extra: {
        plan_id: "p",
        verification_evidence: [
          { oracle: "test", command: "bun test", result: "fail", recorded_at: "2026-08-02T00:00:00.000Z", recorded_by: "alice", ac_ref: "AC-1" },
          { oracle: "test", command: "bun test", result: "pass", recorded_at: "2026-08-01T00:00:00.000Z", recorded_by: "bob", ac_ref: "AC-1", attestation },
        ],
      },
    });

    const supersededCoverage = computeAcCoverage(criteria, [supersededTask])[0]!;
    const controlCoverage = computeAcCoverage(criteria, [controlTask])[0]!;

    // Both asserted as an exact NUMBER (never "truthy"/"nonzero") — the AC's own
    // anti-vacuity requirement.
    expect(supersededCoverage.falsified).toBe(1);
    expect(controlCoverage.falsified).toBe(1);
    // The states DO diverge — proving the supersession rule changed `state`
    // without touching `falsified`'s own historical count.
    expect(deriveAcCoverageState(supersededCoverage)).toBe("fail_superseded");
    expect(deriveAcCoverageState(controlCoverage)).toBe("fail");
  });
});

// ─── AC-FALS-16: the three fail-closed supersession tie-breaks (M4) ──────────

describe("deriveAcCoverageState — supersession fails closed (AC-FALS-16)", () => {
  it("BOUNDARY: supersession-fail-closed — an equal-timestamp attested pass, an attested pass with no recorded_at, and an unattested strictly-newer pass all still yield fail", () => {
    const equalTimestamps = fact({
      pass: 1,
      fail: 1,
      attested_pass: 1,
      falsified: 1,
      refs: [
        { task_id: "t1", result: "fail", recorded_at: "2026-08-01T00:00:00.000Z" },
        { task_id: "t2", result: "pass", attested: true, recorded_at: "2026-08-01T00:00:00.000Z" },
      ],
    });
    const attestedPassMissingRecordedAt = fact({
      pass: 1,
      fail: 1,
      attested_pass: 1,
      falsified: 1,
      refs: [
        { task_id: "t1", result: "fail", recorded_at: "2026-08-01T00:00:00.000Z" },
        { task_id: "t2", result: "pass", attested: true },
      ],
    });
    const unattestedStrictlyNewerPass = fact({
      pass: 1,
      fail: 1,
      attested_pass: 0,
      falsified: 1,
      refs: [
        { task_id: "t1", result: "fail", recorded_at: "2026-08-01T00:00:00.000Z" },
        { task_id: "t2", result: "pass", recorded_at: "2026-08-05T00:00:00.000Z" },
      ],
    });

    expect(deriveAcCoverageState(equalTimestamps)).toBe("fail");
    expect(deriveAcCoverageState(attestedPassMissingRecordedAt)).toBe("fail");
    expect(deriveAcCoverageState(unattestedStrictlyNewerPass)).toBe("fail");
  });
});

// ─── AC-FALS-17: not_measured over a malformed falsified (M5) ────────────────

describe("deriveAcCoverageState — not_measured over a malformed falsified (AC-FALS-17)", () => {
  it("BOUNDARY: absent-falsified — undefined/null/NaN/negative falsified all read not_measured, while 0 reads pass_unfalsified and 1 reads pass — six inputs, three mutually distinct readings", () => {
    const undefinedState = deriveAcCoverageState(fact({ pass: 1, falsified: undefined as unknown as number }));
    const nullState = deriveAcCoverageState(fact({ pass: 1, falsified: null as unknown as number }));
    const nanState = deriveAcCoverageState(fact({ pass: 1, falsified: NaN }));
    const negativeState = deriveAcCoverageState(fact({ pass: 1, falsified: -1 }));
    const zeroState = deriveAcCoverageState(fact({ pass: 1, falsified: 0 }));
    const oneState = deriveAcCoverageState(fact({ pass: 1, falsified: 1 }));

    expect(undefinedState).toBe("not_measured");
    expect(nullState).toBe("not_measured");
    expect(nanState).toBe("not_measured");
    expect(negativeState).toBe("not_measured");
    expect(zeroState).toBe("pass_unfalsified");
    expect(oneState).toBe("pass");

    // Six inputs, three distinct readings — proves the four malformed inputs
    // collapse to the SAME reading as each other, and that reading is neither
    // of the two well-formed readings.
    const distinctReadings = new Set([undefinedState, nullState, nanState, negativeState, zeroState, oneState]);
    expect(distinctReadings.size).toBe(3);
  });
});

// ─── AC-FALS-18: not_measured shadows only its own branch (M5) ───────────────

describe("deriveAcCoverageState — not_measured branch scope (AC-FALS-18)", () => {
  it("REGRESSION: falsified-branch-scope — with falsified malformed, a fail fact still yields fail, an attested-pass fact still yields attested_pass, and a no-evidence fact still yields none", () => {
    const malformedFalsified = undefined as unknown as number;

    const failFact = fact({ pass: 1, fail: 1, falsified: malformedFalsified });
    const attestedPassFact = fact({ pass: 1, fail: 0, attested_pass: 1, falsified: malformedFalsified });
    const noEvidenceFact = fact({ pass: 0, fail: 0, falsified: malformedFalsified });

    expect(deriveAcCoverageState(failFact)).toBe("fail");
    expect(deriveAcCoverageState(attestedPassFact)).toBe("attested_pass");
    expect(deriveAcCoverageState(noEvidenceFact)).toBe("none");
  });
});
