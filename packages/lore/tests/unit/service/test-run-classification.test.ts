// @spawns-external bunx imports scripts/test-file.ts only for its pure planGroups; nothing is spawned here
/**
 * @spec_ref spec-review-test-runs-are-capped-per-machine-and-a-run-that (BR-1533)
 *
 * Pure classification of a test file run from the outcome report, and the way the batched outcomes use it.
 * Dimensions: HAPPY (pass, assertion), NEGATIVE (a mixed failure is red), BOUNDARY (a failed file naming no error is red, a skipped file
 * is unclassified), STATE (a timed-out invocation), REGRESSION (a timeout of the report never falls back to the console reading).
 */

import { describe, expect, it } from "vitest";
import { outcomesOfTogetherRun } from "../../../src/adapters/cli/assess-suite-runner.js";
import { classifyReportedFile, findReportedFile, isTimeoutError, parseOutcomeReports, type ReportedFile } from "../../../src/service/test-run-classification.js";
import { planGroups } from "../../../../../scripts/test-file.js";

const TIMEOUT = { name: "Error", message: "Test timed out in 5000ms.\nIf this is a long-running test, pass a timeout value" };
const HOOK = { name: "Error", message: "Hook timed out in 10000ms." };
const ASSERT = { name: "AssertionError", message: "expected 1 to be 2" };
const entry = (state: ReportedFile["state"], errors: ReportedFile["errors"], path = "/repo/a.test.ts"): ReportedFile => ({ path, state, errors });

describe("classifyReportedFile", () => {
  it("a pass is green and an assertion is red", () => {
    expect(classifyReportedFile(entry("pass", []))).toEqual({ classification: "green" });
    expect(classifyReportedFile(entry("fail", [ASSERT]))).toEqual({ classification: "red" });
  });

  it("only timeouts make a failed file inconclusive; one other error makes it red; no named error is red", () => {
    expect(classifyReportedFile(entry("fail", [TIMEOUT, HOOK]))).toEqual({ classification: "inconclusive", inconclusive_cause: "timeout" });
    expect(classifyReportedFile(entry("fail", [TIMEOUT, ASSERT]))).toEqual({ classification: "red" });
    expect(classifyReportedFile(entry("fail", []))).toEqual({ classification: "red" });
  });

  it("a file that neither passed nor failed is not classified", () => {
    expect(classifyReportedFile(entry("other", []))).toBeUndefined();
  });

  it("detects vitest's own timeout messages and nothing that merely mentions one", () => {
    expect(isTimeoutError(TIMEOUT)).toBe(true);
    expect(isTimeoutError(HOOK)).toBe(true);
    expect(isTimeoutError({ name: "Error", message: "the helper said: Test timed out in 5ms" })).toBe(false);
  });
});

describe("outcomesOfTogetherRun with an outcome report", () => {
  const reported = parseOutcomeReports([
    JSON.stringify({ files: [entry("fail", [HOOK], "/repo/p/slow.test.ts"), entry("fail", [ASSERT], "/repo/p/bad.test.ts"), entry("pass", [], "/repo/p/ok.test.ts")] }),
  ]).files;

  it("classifies each file from the report, with exit codes that agree", () => {
    const outcomes = outcomesOfTogetherRun(["p/slow.test.ts", "p/bad.test.ts", "p/ok.test.ts"], { status: 1, output: "", durationMs: 1, reported });
    expect(outcomes.map((o) => [o.file, o.exit_code, o.classification, o.inconclusive_cause, o.incomplete])).toEqual([
      ["p/slow.test.ts", 1, "inconclusive", "timeout", undefined],
      ["p/bad.test.ts", 1, "red", undefined, undefined],
      ["p/ok.test.ts", 0, "green", undefined, undefined],
    ]);
  });

  it("a file missing from a readable report, or shown only as skipped, is inconclusive no-report; a FAIL line in the console changes nothing", () => {
    const onlyOk = parseOutcomeReports([JSON.stringify({ files: [entry("pass", [], "/repo/p/ok.test.ts"), entry("other", [], "/repo/p/skipped.test.ts")] })]).files;
    const outcomes = outcomesOfTogetherRun(["p/ok.test.ts", "p/skipped.test.ts", "p/absent.test.ts"], { status: 1, output: " FAIL  p/absent.test.ts > x\n", durationMs: 1, reported: onlyOk });
    expect(outcomes.map((o) => [o.classification, o.inconclusive_cause])).toEqual([["green", undefined], ["inconclusive", "no-report"], ["inconclusive", "no-report"]]);
  });

  it("an invocation its own limit ended makes every unfinished file inconclusive; any other incompleteness stays incomplete", () => {
    const timedOut = outcomesOfTogetherRun(["a.test.ts"], { status: 1, output: "", durationMs: 1, incomplete: "timed out after 5 ms", timedOut: true });
    expect(timedOut[0]).toMatchObject({ classification: "inconclusive", inconclusive_cause: "timeout" });
    const killed = outcomesOfTogetherRun(["a.test.ts"], { status: 1, output: "", durationMs: 1, incomplete: "SIGKILL to process group 1 failed" });
    expect(killed[0]?.classification).toBeUndefined();
    expect(killed[0]?.incomplete).toBeDefined();
  });

  it("finds a report entry by the repo-relative path and skips unreadable report texts", () => {
    expect(findReportedFile(reported, "p/ok.test.ts")?.state).toBe("pass");
    expect(findReportedFile(reported, "ok.test.ts")?.state).toBe("pass");
    expect(findReportedFile(reported, "nope.test.ts")).toBeUndefined();
    expect(parseOutcomeReports(["not json", JSON.stringify({ files: "x" })]).unreadable).toBe(2);
  });
});

describe("test:file plans the outcome reporter only when asked", () => {
  it("adds the reporter to each group when given and leaves the default invocation otherwise", () => {
    const plain = planGroups(["a.test.ts"], [], new Set(), () => "r.json");
    const withReporter = planGroups(["a.test.ts"], [], new Set(), () => "r.json", "/x/reporter.ts");
    expect(plain[0]?.argv.some((a) => a.includes("reporter.ts"))).toBe(false);
    expect(withReporter[0]?.argv).toContain("--reporter=/x/reporter.ts");
  });
});
