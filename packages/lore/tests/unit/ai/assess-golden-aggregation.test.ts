/**
 * Unit tests for the golden-fixture-harness aggregation arithmetic (SPEC-040 §T3 D7).
 * Scope: pure arithmetic only, driven entirely by scripted `GoldenDirectionLabel`
 * arrays — never invokes a live AI provider (AC-ADF-12).
 *
 * Coverage:
 *   HAPPY:      clear 2-1 majority; a run where the candidate strictly out-agrees the
 *               incumbent is promotable
 *   NEGATIVE:   a candidate-loses regression case (candidate agreement < incumbent
 *               agreement) is NOT promotable
 *   BOUNDARY:   deriveGoldenDirectionLabel's 80/40 score thresholds; a genuine 3-way
 *               majority tie resolves to the most conservative label; equal
 *               candidate/incumbent agreement (tie) IS promotable ("ties pass");
 *               a zero-fixture run yields 0/0 agreement (never NaN) and is promotable
 *   ERROR:      computeMajorityLabel throws on an empty labels array
 *   STATE:      aggregateGoldenRun never mutates its input; repeated calls with the
 *               same input are referentially consistent (no hidden internal state)
 *   REGRESSION: non-inferiority (>=), not strict improvement — an EXACT tie between
 *               candidate and incumbent agreement must still promote
 *
 * @spec_ref AC-ADF-12
 */

import { describe, it, expect } from "vitest";
import {
  GOLDEN_DIRECTION_LABELS,
  aggregateGoldenRun,
  computeMajorityLabel,
  deriveGoldenDirectionLabel,
  type GoldenDirectionLabel,
  type GoldenFixtureRun,
} from "../../../src/ai/assess-golden-aggregation.js";

// ─── deriveGoldenDirectionLabel — BOUNDARY ─────────────────────────────────────

describe("deriveGoldenDirectionLabel — BOUNDARY (score thresholds)", () => {
  it("100 and 80 both map to 'met' (>=80 inclusive)", () => {
    expect(deriveGoldenDirectionLabel(100)).toBe("met");
    expect(deriveGoldenDirectionLabel(80)).toBe("met");
  });

  it("79 maps to 'partial' (just below the met threshold)", () => {
    expect(deriveGoldenDirectionLabel(79)).toBe("partial");
  });

  it("40 maps to 'partial' (not_met's upper bound is exclusive)", () => {
    expect(deriveGoldenDirectionLabel(40)).toBe("partial");
  });

  it("39 and 0 both map to 'not_met' (<40)", () => {
    expect(deriveGoldenDirectionLabel(39)).toBe("not_met");
    expect(deriveGoldenDirectionLabel(0)).toBe("not_met");
  });
});

// ─── computeMajorityLabel — HAPPY / BOUNDARY / ERROR ───────────────────────────

describe("computeMajorityLabel — HAPPY", () => {
  it("a clear 2-1 majority wins regardless of position in the array", () => {
    expect(computeMajorityLabel(["met", "met", "partial"])).toBe("met");
    expect(computeMajorityLabel(["not_met", "partial", "not_met"])).toBe("not_met");
  });

  it("a single-label array of length 1 returns that label", () => {
    expect(computeMajorityLabel(["partial"])).toBe("partial");
  });

  it("unanimous labels return that label", () => {
    expect(computeMajorityLabel(["met", "met", "met"])).toBe("met");
  });
});

describe("computeMajorityLabel — BOUNDARY (ties resolve conservatively)", () => {
  it("a genuine 3-way tie (one of each label) resolves to 'not_met' (most conservative)", () => {
    expect(computeMajorityLabel(["met", "partial", "not_met"])).toBe("not_met");
  });

  it("a 2-2 tie between 'met' and 'not_met' resolves to 'not_met', never 'met'", () => {
    expect(computeMajorityLabel(["met", "met", "not_met", "not_met"])).toBe("not_met");
  });

  it("a 2-2 tie between 'met' and 'partial' resolves to 'partial' (more conservative than met)", () => {
    expect(computeMajorityLabel(["met", "met", "partial", "partial"])).toBe("partial");
  });

  it("tie resolution is independent of array order", () => {
    const forward = computeMajorityLabel(["met", "partial", "not_met"]);
    const reversed = computeMajorityLabel(["not_met", "partial", "met"]);
    expect(forward).toBe(reversed);
  });
});

describe("computeMajorityLabel — ERROR", () => {
  it("throws on an empty labels array — a caller bug, not a data-quality condition", () => {
    expect(() => computeMajorityLabel([])).toThrow(/non-empty/);
  });
});

// ─── aggregateGoldenRun — HAPPY / NEGATIVE / BOUNDARY / STATE / REGRESSION ─────

function run(
  fixtureName: string,
  expectedLabel: GoldenDirectionLabel,
  candidateLabels: GoldenDirectionLabel[],
  incumbentLabels: GoldenDirectionLabel[],
): GoldenFixtureRun {
  return { fixtureName, expectedLabel, candidateLabels, incumbentLabels };
}

describe("aggregateGoldenRun — HAPPY (candidate strictly out-agrees incumbent)", () => {
  it("candidate matches every fixture's expected label, incumbent matches none → promotable", () => {
    const runs = [
      run("f1", "met", ["met", "met", "met"], ["not_met", "not_met", "not_met"]),
      run("f2", "not_met", ["not_met", "not_met", "not_met"], ["met", "met", "met"]),
    ];
    const result = aggregateGoldenRun(runs);
    expect(result.candidateAgreement).toBe(1);
    expect(result.incumbentAgreement).toBe(0);
    expect(result.promotable).toBe(true);
    expect(result.fixtures.map((f) => f.candidateMatchesExpected)).toEqual([true, true]);
    expect(result.fixtures.map((f) => f.incumbentMatchesExpected)).toEqual([false, false]);
  });
});

describe("aggregateGoldenRun — NEGATIVE (candidate-loses regression case)", () => {
  it("candidate agreement below incumbent agreement → NOT promotable", () => {
    const runs = [
      run("f1", "met", ["met", "met", "met"], ["met", "met", "met"]),
      run("f2", "not_met", ["met", "met", "met"], ["not_met", "not_met", "not_met"]),
    ];
    const result = aggregateGoldenRun(runs);
    // Candidate: matches f1 (met==met), misses f2 (met!=not_met) → 0.5
    // Incumbent: matches f1 and f2 → 1.0
    expect(result.candidateAgreement).toBe(0.5);
    expect(result.incumbentAgreement).toBe(1);
    expect(result.promotable).toBe(false);
  });
});

describe("aggregateGoldenRun — BOUNDARY (ties, empty input)", () => {
  it("equal candidate/incumbent agreement (tie) IS promotable — non-inferiority, not strict improvement", () => {
    const runs = [
      run("f1", "met", ["met", "met", "met"], ["met", "met", "met"]),
      run("f2", "not_met", ["met", "met", "met"], ["met", "met", "met"]),
    ];
    const result = aggregateGoldenRun(runs);
    expect(result.candidateAgreement).toBe(result.incumbentAgreement);
    expect(result.promotable).toBe(true);
  });

  it("a zero-fixture run yields 0/0 agreement (never NaN) and is promotable", () => {
    const result = aggregateGoldenRun([]);
    expect(result.candidateAgreement).toBe(0);
    expect(result.incumbentAgreement).toBe(0);
    expect(Number.isNaN(result.candidateAgreement)).toBe(false);
    expect(Number.isNaN(result.incumbentAgreement)).toBe(false);
    expect(result.promotable).toBe(true);
    expect(result.fixtures).toEqual([]);
  });
});

describe("aggregateGoldenRun — STATE (referential transparency)", () => {
  it("does not mutate its input array or any GoldenFixtureRun entry", () => {
    const runs = [run("f1", "met", ["met", "met", "met"], ["partial", "partial", "partial"])];
    const snapshot = JSON.parse(JSON.stringify(runs));
    aggregateGoldenRun(runs);
    expect(runs).toEqual(snapshot);
  });

  it("repeated calls with the same input produce equal (deep) results", () => {
    const runs = [
      run("f1", "met", ["met", "met", "not_met"], ["not_met", "not_met", "met"]),
      run("f2", "partial", ["partial", "partial", "met"], ["not_met", "partial", "partial"]),
    ];
    const first = aggregateGoldenRun(runs);
    const second = aggregateGoldenRun(runs);
    expect(first).toEqual(second);
  });
});

describe("aggregateGoldenRun — REGRESSION (GOLDEN_DIRECTION_LABELS taxonomy shape)", () => {
  it("GOLDEN_DIRECTION_LABELS is exactly the three-label taxonomy, most-to-least trusted order", () => {
    expect(GOLDEN_DIRECTION_LABELS).toEqual(["met", "partial", "not_met"]);
  });
});
