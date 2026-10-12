/**
 * RED tests for the captured-red proof (AC-EH-8 a-g, j; issue #53; BR-1077, BR-152).
 *
 * Defect: `lore evidence --capture --result expected-fail|fail` accepts ANY non-zero
 * exit, so a red caused by a broken command (failed `cd`, exit 127 "command not
 * found") clears the red-first floor. D8/D9/D10 of
 * spec-evidence-labels-and-reds-are-honest: a captured red for oracle test/e2e must
 * carry, in the STORED 4000-char tail, a recognised runner summary reporting >= 1
 * failed test; exit 126/127 is never a red for any oracle.
 *
 * Not-yet-existing exports the paired implement task adds (reached through
 * namespace imports and cast, so this file typechecks today; each case's first
 * assertion names the missing export instead of dying on a bare TypeError):
 *   - `parseFailedCaseCount` in packages/core/src/attestation-completeness.ts
 *   - `findCapturedRedProofGap` in src/adapters/cli/evidence-precheck.ts
 *
 * Dimensions: HAPPY (vitest and bun summaries with a failure), NEGATIVE (no
 * summary, 0 failed), BOUNDARY (126 vs 127, oracle other, 4000-char tail window),
 * ERROR (refusal content), REGRESSION (capture false and non-red results untouched).
 *
 * @spec_ref spec-evidence-labels-and-reds-are-honest
 */

import { describe, it, expect } from "vitest";
import * as core from "@lore/core";
import * as precheck from "../../../src/adapters/cli/evidence-precheck.js";
import { captureOracleCommand, CAPTURE_TAIL_CHARS } from "../../../src/adapters/evidence-capture.js";

type ErrLike = { code: string; message: string; field?: string } | null;
type GapInput = {
  oracle: string;
  result: string;
  capture: boolean;
  exitCode: number | null;
  outputTail?: string;
};

function parseFailed(stdout: string): number | null {
  const fn = (core as unknown as { parseFailedCaseCount?: (s: string) => number | null }).parseFailedCaseCount;
  expect(typeof fn, "parseFailedCaseCount is not exported from @lore/core yet (paired implement task adds it)").toBe(
    "function",
  );
  return (fn as (s: string) => number | null)(stdout);
}

function gap(input: GapInput): ErrLike {
  const fn = (precheck as unknown as { findCapturedRedProofGap?: (i: GapInput) => ErrLike }).findCapturedRedProofGap;
  expect(
    typeof fn,
    "findCapturedRedProofGap is not exported from evidence-precheck.ts yet (paired implement task adds it)",
  ).toBe("function");
  return (fn as (i: GapInput) => ErrLike)(input);
}

const VITEST_FAIL = "Test Files  1 failed (1)\n     Tests  1 failed | 2 passed (3)\n";
const VITEST_PASS = "Test Files  1 passed (1)\n     Tests  3 passed (3)\n";
const VITEST_ZERO_FAILED_PAIR = "Test Files  1 passed (1)\n     Tests  3 passed (3)\n";
const BUN_FAIL = " 1 pass\n 1 fail\nRan 2 tests across 1 file. [12.00ms]\n";

describe("parseFailedCaseCount (AC-EH-8 a)", () => {
  it("HAPPY: vitest 'Tests  1 failed | 2 passed (3)' reports 1 failed", () => {
    expect(parseFailed(VITEST_FAIL)).toBe(1);
  });

  it("HAPPY: bun ' 1 pass' / ' 1 fail' / 'Ran 2 tests across 1 file.' reports 1 failed", () => {
    expect(parseFailed(BUN_FAIL)).toBe(1);
  });

  it("NEGATIVE: an all-green vitest summary reports 0 failed, not null", () => {
    expect(parseFailed(VITEST_PASS)).toBe(0);
  });

  it("NEGATIVE: output with no runner summary reports null (distinct from 0)", () => {
    expect(parseFailed("cd: no such file or directory: /nonexistent-dir-for-red\n")).toBeNull();
  });
});

describe("findCapturedRedProofGap (AC-EH-8 b-g)", () => {
  it("HAPPY (b): oracle test, expected-fail, exit 1, vitest failure summary -> null", () => {
    expect(gap({ oracle: "test", result: "expected-fail", capture: true, exitCode: 1, outputTail: VITEST_FAIL })).toBeNull();
  });

  it("HAPPY (b): oracle test, expected-fail, exit 1, bun failure summary -> null", () => {
    expect(gap({ oracle: "test", result: "expected-fail", capture: true, exitCode: 1, outputTail: BUN_FAIL })).toBeNull();
  });

  it.each([
    ["test", "fail"],
    ["test", "expected-fail"],
    ["e2e", "fail"],
    ["e2e", "expected-fail"],
  ])("NEGATIVE (c): oracle %s, result %s, exit 1, no summary -> VALIDATION_ERROR naming the recognised formats", (oracle, result) => {
    const refusal = gap({
      oracle,
      result,
      capture: true,
      exitCode: 1,
      outputTail: "cd: no such file or directory: /nonexistent-dir-for-red\n",
    });
    expect(refusal, `${oracle}/${result} with no runner summary must be refused`).not.toBeNull();
    expect(refusal?.code).toBe("VALIDATION_ERROR");
    expect(refusal?.message).toContain("Tests");
    expect(refusal?.message).toContain("Ran N tests");
  });

  it("NEGATIVE (d): a recognised summary reporting 0 failed is refused", () => {
    const refusal = gap({
      oracle: "test",
      result: "expected-fail",
      capture: true,
      exitCode: 1,
      outputTail: VITEST_ZERO_FAILED_PAIR,
    });
    expect(refusal).not.toBeNull();
    expect(refusal?.code).toBe("VALIDATION_ERROR");
  });

  it.each([
    [127, "test"],
    [127, "other"],
    [126, "test"],
    [126, "other"],
  ])("BOUNDARY (e): exit %i with oracle %s is refused and names the code", (exitCode, oracle) => {
    const refusal = gap({
      oracle,
      result: "expected-fail",
      capture: true,
      exitCode,
      // Even a runner-shaped failure summary cannot rescue 126/127.
      outputTail: VITEST_FAIL,
    });
    expect(refusal, `exit ${exitCode} must never be a red (oracle ${oracle})`).not.toBeNull();
    expect(refusal?.code).toBe("VALIDATION_ERROR");
    expect(refusal?.message).toContain(String(exitCode));
  });

  it("BOUNDARY (f): oracle other, expected-fail, exit 1, no summary -> null (D8 is test/e2e only)", () => {
    expect(gap({ oracle: "other", result: "expected-fail", capture: true, exitCode: 1, outputTail: "boom\n" })).toBeNull();
  });

  it("REGRESSION (g): capture false -> null even with no summary and exit 127", () => {
    expect(gap({ oracle: "test", result: "expected-fail", capture: false, exitCode: 127, outputTail: "" })).toBeNull();
  });

  it("REGRESSION: a pass is never judged by the red-proof check", () => {
    expect(gap({ oracle: "test", result: "pass", capture: true, exitCode: 0, outputTail: "ok\n" })).toBeNull();
  });
});

describe("findCapturedRedProofGap reads the STORED tail (AC-EH-8 j)", () => {
  it("BOUNDARY (j): a failure summary pushed out of the 4000-char tail by later stderr (no 2>&1) is refused, naming '2>&1'", () => {
    const outcome = captureOracleCommand({
      // stdout carries the summary; > CAPTURE_TAIL_CHARS of stderr follows it. Without
      // `2>&1` the adapter stores all stdout then all stderr, so the tail loses the summary.
      command: `printf 'Tests  1 failed (1)\\n'; printf 'e%.0s' $(seq 1 ${CAPTURE_TAIL_CHARS + 500}) >&2; exit 1`,
      cwd: process.cwd(),
      declaredResult: "expected-fail",
      timeoutMs: 30_000,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.observedExitCode).toBe(1);
    // Control on the fixture itself: the summary really is outside the stored tail.
    expect(outcome.value.outputTail).not.toContain("Tests  1 failed");

    const refusal = gap({
      oracle: "test",
      result: "expected-fail",
      capture: true,
      exitCode: outcome.value.observedExitCode,
      outputTail: outcome.value.outputTail,
    });
    expect(refusal, "a summary outside the stored tail must be refused").not.toBeNull();
    expect(refusal?.code).toBe("VALIDATION_ERROR");
    expect(refusal?.message).toContain("2>&1");
  });

  it("BOUNDARY (j) control: a summary that stays inside the stored tail is accepted", () => {
    const outcome = captureOracleCommand({
      command: `printf 'e%.0s' $(seq 1 ${CAPTURE_TAIL_CHARS + 500}) >&2; printf '\\nTests  1 failed (1)\\n'; exit 1`,
      cwd: process.cwd(),
      declaredResult: "expected-fail",
      timeoutMs: 30_000,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.outputTail).toContain("Tests  1 failed");
    expect(
      gap({
        oracle: "test",
        result: "expected-fail",
        capture: true,
        exitCode: outcome.value.observedExitCode,
        outputTail: outcome.value.outputTail,
      }),
    ).toBeNull();
  });
});
