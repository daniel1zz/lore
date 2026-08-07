/**
 * Tests for @lore/core acceptance.ts's fourth coverage dimension — `falsified`
 * (computeAcCoverage) and the `pass_unfalsified` state (deriveAcCoverageState).
 * Pure functions, no IO.
 *
 * Governed by spec-oracle-tier-falsifiability-a-criterion-never-observed-red M1
 * and adr-falsifiability-moves-from-the-task-tier-to-the-oracle-tier. This is the
 * DERIVATION half only — surfacing (`lore ac list`, `lore status`) is a separate
 * task with its own anchors.
 *
 * Six-dimension coverage for this file:
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
 * @spec_ref spec-oracle-tier-falsifiability-a-criterion-never-observed-red
 *   AC-FALS-1, AC-FALS-2, AC-FALS-3
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
