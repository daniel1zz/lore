/**
 * Tests for `captureOracleCommand`'s stream ORDER: stdout and stderr travel through
 * ONE pipe, so the persisted tail matches what a terminal shows.
 *
 * Defect (task-gh-1343388703-181, lore issue #181): capture stored the command's
 * full stdout followed by its full stderr, then kept a 4000-char tail. A runner that
 * prints its summary on stdout and noise on stderr lost the summary from the tail
 * unless the command carried its own `2>&1`.
 *
 * Six-dimension coverage:
 *   HAPPY      — SUMMARY on stdout followed by >4000 chars of stderr noise stays in the tail
 *   NEGATIVE   — a non-zero exit still reports the command's OWN exit code (3), not a wrapper's
 *   BOUNDARY   — the tail is still bounded by CAPTURE_TAIL_CHARS
 *   ERROR      — stderr-only output is still captured
 *   STATE      — interleaved order is chronological (stdout, stderr, stdout)
 *   REGRESSION — a command that already carries `2>&1` behaves the same; `exit N` as the
 *                whole command keeps its code
 *
 * @spec_ref task-gh-1343388703-181
 */

import { describe, it, expect } from "vitest";
import { captureOracleCommand, CAPTURE_TAIL_CHARS } from "../../../src/adapters/evidence-capture.js";

// reason: noise FIRST, summary LAST — the order a real runner prints in (warnings while it works, the
// summary line at the end). Under stdout-then-stderr concatenation the summary is pushed out of the
// 4000-char tail by the trailing stderr; in terminal order it is the last line. A summary printed
// BEFORE >4000 chars of noise cannot survive ANY terminal-ordered tail, and is not what this pins.
const NOISE_AFTER_SUMMARY = "head -c 6000 /dev/zero | tr '\\0' 'x' >&2; echo >&2; echo 'SUMMARY 3 passed'";

describe("captureOracleCommand single stream — HAPPY", () => {
  it("CAPSTREAM-H1: a stdout summary followed by >4000 chars of stderr noise stays in the stored tail without 2>&1", () => {
    const outcome = captureOracleCommand({
      command: NOISE_AFTER_SUMMARY,
      cwd: process.cwd(),
      declaredResult: "pass",
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.outputTail).toContain("SUMMARY 3 passed");
    expect(outcome.value.outputTail.length).toBeLessThanOrEqual(CAPTURE_TAIL_CHARS);
  });
});

describe("captureOracleCommand single stream — NEGATIVE", () => {
  it("CAPSTREAM-N1: a non-zero exit keeps the command's own exit code and still keeps the summary", () => {
    const outcome = captureOracleCommand({
      command: `${NOISE_AFTER_SUMMARY}; exit 3`,
      cwd: process.cwd(),
      declaredResult: "fail",
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.observedExitCode).toBe(3);
    expect(outcome.value.provenance.capture_attestation.exit_code).toBe(3);
    expect(outcome.value.outputTail).toContain("SUMMARY 3 passed");
  });
});

describe("captureOracleCommand single stream — ERROR", () => {
  it("CAPSTREAM-E1: stderr-only output is still captured", () => {
    const outcome = captureOracleCommand({
      command: "echo only-on-stderr >&2",
      cwd: process.cwd(),
      declaredResult: "pass",
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.outputTail).toContain("only-on-stderr");
  });
});

describe("captureOracleCommand single stream — STATE", () => {
  it("CAPSTREAM-S1: the tail keeps terminal order (stdout, stderr, stdout), not stdout-then-stderr", () => {
    const outcome = captureOracleCommand({
      command: "echo first-out; sleep 0.1; echo second-err >&2; sleep 0.1; echo third-out",
      cwd: process.cwd(),
      declaredResult: "pass",
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const tail = outcome.value.outputTail;
    expect(tail.indexOf("first-out")).toBeGreaterThanOrEqual(0);
    expect(tail.indexOf("first-out")).toBeLessThan(tail.indexOf("second-err"));
    expect(tail.indexOf("second-err")).toBeLessThan(tail.indexOf("third-out"));
  });
});

describe("captureOracleCommand single stream — REGRESSION", () => {
  it("CAPSTREAM-R1: a command that already ends in 2>&1 behaves the same", () => {
    const outcome = captureOracleCommand({
      command: `(${NOISE_AFTER_SUMMARY}) 2>&1`,
      cwd: process.cwd(),
      declaredResult: "pass",
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.outputTail).toContain("SUMMARY 3 passed");
  });

  it("CAPSTREAM-R2: a bare `exit 5` command reports exit code 5", () => {
    const outcome = captureOracleCommand({ command: "exit 5", cwd: process.cwd(), declaredResult: "fail" });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.observedExitCode).toBe(5);
  });
});
