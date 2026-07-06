/**
 * Tests for @lore/core calibration — wilsonLowerBound + calibrationRecordSchema.
 * Pure functions/schema, no IO. Spec-first: assertions come from SPEC-034 §2/§3.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      calibrationRecordSchema.parse on a well-formed record;
 *               wilsonLowerBound on a typical mixed sample
 *   NEGATIVE:   calibrationRecordSchema rejects unknown doc_type / human_outcome
 *   BOUNDARY:   n=0; successes=0; successes=n (all confirmed); z default value;
 *               large-n tight interval vs small-n wide interval
 *   ERROR:      n/a — wilsonLowerBound has no Result channel (pure numeric fn)
 *   STATE:      n/a — no state machine in this module
 *   REGRESSION: wilsonLowerBound never returns outside [0, 1]; monotonic in n at fixed rate
 *
 * @spec_ref SPEC-034 §2, §3
 */

import { describe, expect, it } from "vitest";
import {
  CALIBRATION_OUTCOMES,
  calibrationRecordSchema,
  wilsonLowerBound,
} from "./calibration.js";

// ─── calibrationRecordSchema ────────────────────────────────────────────────

describe("calibrationRecordSchema", () => {
  function makeRecord(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: "01ARZ3CALIB0000000000001",
      judgment_id: "01ARZ3JUDGE0000000000001",
      doc_id: "01ARZ3DOC00000000000001",
      doc_type: "spec",
      human_outcome: "confirmed",
      delta_reasons: [],
      actor: "alice",
      created_at: "2026-07-06T00:00:00.000Z",
      ...overrides,
    };
  }

  it("HAPPY: parses a well-formed confirmed record", () => {
    const result = calibrationRecordSchema.safeParse(makeRecord());
    expect(result.success).toBe(true);
  });

  it("HAPPY: parses a well-formed overridden record with delta_reasons", () => {
    const result = calibrationRecordSchema.safeParse(
      makeRecord({ human_outcome: "overridden", delta_reasons: ["missed a broken link"] }),
    );
    expect(result.success).toBe(true);
  });

  it("HAPPY: accepts every declared doc_type", () => {
    for (const docType of ["prd", "spec", "adr", "plan", "knowledge", "task"]) {
      const result = calibrationRecordSchema.safeParse(makeRecord({ doc_type: docType }));
      expect(result.success).toBe(true);
    }
  });

  it("NEGATIVE: rejects an unknown doc_type", () => {
    const result = calibrationRecordSchema.safeParse(makeRecord({ doc_type: "not-a-type" }));
    expect(result.success).toBe(false);
  });

  it("NEGATIVE: rejects an unknown human_outcome", () => {
    const result = calibrationRecordSchema.safeParse(makeRecord({ human_outcome: "maybe" }));
    expect(result.success).toBe(false);
  });

  it("NEGATIVE: rejects a missing required field (actor)", () => {
    const record = makeRecord();
    delete (record as Record<string, unknown>).actor;
    const result = calibrationRecordSchema.safeParse(record);
    expect(result.success).toBe(false);
  });

  it("REGRESSION: CALIBRATION_OUTCOMES is exactly ['confirmed', 'overridden']", () => {
    expect(CALIBRATION_OUTCOMES).toEqual(["confirmed", "overridden"]);
  });
});

// ─── wilsonLowerBound ───────────────────────────────────────────────────────

describe("wilsonLowerBound", () => {
  it("BOUNDARY: n=0 returns 0 (no evidence yet)", () => {
    expect(wilsonLowerBound(0, 0)).toBe(0);
  });

  it("BOUNDARY: n=0 with a nonsensical successes count still returns 0, never NaN", () => {
    expect(wilsonLowerBound(5, 0)).toBe(0);
  });

  it("BOUNDARY: successes=0, n>0 returns exactly 0 (lower bound of a zero-rate sample floors at 0)", () => {
    const result = wilsonLowerBound(0, 10);
    expect(result).toBe(0);
  });

  it("BOUNDARY: successes=n (all confirmed) stays below 1 — small-sample penalty applies", () => {
    const result = wilsonLowerBound(10, 10);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(1);
  });

  it("BOUNDARY: result is always clamped to [0, 1] across a sweep of successes/n ratios", () => {
    for (let n = 1; n <= 50; n += 1) {
      for (let successes = 0; successes <= n; successes += 1) {
        const result = wilsonLowerBound(successes, n);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(1);
        expect(Number.isNaN(result)).toBe(false);
      }
    }
  });

  it("HAPPY: small n at a middling rate produces a noticeably wide (low) interval", () => {
    // 5/10 confirmed — naive rate is 0.5, but small-n Wilson lower bound is well below 0.5
    const result = wilsonLowerBound(5, 10);
    expect(result).toBeLessThan(0.5);
    expect(result).toBeGreaterThan(0);
  });

  it("HAPPY: large n at the same rate produces a tighter interval closer to the naive rate", () => {
    const smallSample = wilsonLowerBound(500, 1000);
    const largeSample = wilsonLowerBound(50000, 100000);
    // Both are ~50% naive rate, but the larger sample's lower bound sits closer to 0.5
    expect(largeSample).toBeGreaterThan(smallSample);
    expect(largeSample).toBeCloseTo(0.5, 1);
  });

  it("REGRESSION: increasing n at a fixed confirmed rate monotonically raises the lower bound", () => {
    const ratios = [10, 100, 1000, 10000].map((n) => wilsonLowerBound(Math.round(n * 0.9), n));
    for (let i = 1; i < ratios.length; i += 1) {
      expect(ratios[i]).toBeGreaterThan(ratios[i - 1]!);
    }
  });

  it("BOUNDARY: default z (1.96 ≈ 95%) differs from an explicit looser z (e.g. 1.0 ≈ 68%)", () => {
    const defaultZ = wilsonLowerBound(7, 10);
    const looseZ = wilsonLowerBound(7, 10, 1.0);
    // A looser (smaller) z-score produces a tighter/higher lower bound than the
    // wider 95%-confidence default.
    expect(looseZ).toBeGreaterThan(defaultZ);
  });

  it("NEGATIVE: successes greater than n is a caller-contract violation, not a thrown error — the pure fn never throws", () => {
    // wilsonLowerBound has no Result channel (plain number return); successes > n
    // violates its implicit contract (successes is a subset of n) and is the
    // caller's (future JudgmentService's) responsibility to prevent — this test
    // only pins down that the function degrades numerically rather than throwing.
    expect(() => wilsonLowerBound(15, 10)).not.toThrow();
  });
});
