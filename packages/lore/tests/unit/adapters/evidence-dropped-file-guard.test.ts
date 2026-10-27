// @reads packages/lore/tests/unit/adapters/cli-anchor-resolution.bun.test.ts
// @reads packages/lore/tests/unit/adapters/assess-commit-derivation.test.ts
/**
 * `lore evidence` dropped-file guard — the protection that
 * task-vitest-run-silently-drops-a-bun-test-ts-named-alongside-a introduced,
 * re-derived from the runner's OWN output by
 * task-skill-implement-tg-32-evidence-precheck-follows-the-one.
 *
 * History. 2026-08-01: `bunx vitest run a.test.ts b.bun.test.ts` ran ONLY
 * `a.test.ts`, exited 0 and warned about nothing — vitest's "no test files
 * found" refusal is evaluated over the WHOLE invocation, so one matching file
 * silences it for every other named file the runner drops. The first fix was a
 * FILENAME-SUFFIX rule ("`.bun.test.ts` belongs to `bun test`, everything else
 * to vitest"). Since 90c2b081 (adr-tg-1-test-runner-decision-measured-
 * comparison-of-bun-only) this repo runs every test, `.bun.test.ts` included,
 * through ONE runner (`bunx --bun vitest run`), so that rule refused a command
 * that genuinely runs the file. It was also a repo convention shipped to
 * consumers (task-gh-1343388703-46: a consumer's `bun test a.test.ts` refused).
 *
 * The protection that remains is the property, not the suffix: a captured pass
 * whose runner summary shows FEWER test files executed than the command named
 * (or none) is refused. That reads the runner's own output
 * (`@lore/core` `countExplicitPathArgs` + `parseExecutedUnits` +
 * `judgeCompleteness`, the same trio `lore verify` already applies), so it
 * holds for any runner and any file-naming scheme, and never refuses a command
 * that did run everything it named.
 *
 * Six-dimension coverage:
 *   HAPPY:      the one-runner command naming a `.bun.test.ts` file whose
 *               summary shows it ran is accepted (the regression that motivated
 *               this task); a chained multi-runner command whose two summaries
 *               sum to the named count is accepted
 *   NEGATIVE:   a command naming 2 files whose summary shows 1 executed is
 *               refused, naming both counts and the dropped-file repair; a
 *               command naming a file whose summary shows 0 executed is refused
 *   BOUNDARY:   no tail / an unrecognised-runner tail / no extractable path are
 *               left alone (fail-open, documented); a case-filtered command is
 *               left to the filtered-pass guard
 *   ERROR:      every refusal is VALIDATION_ERROR on field output_tail, exit 4
 *   REGRESSION: --result fail / expected-fail and out-of-scope oracle kinds
 *               are untouched; the refusal never asserts a repo-specific
 *               two-runner convention
 *
 * @spec_ref task-skill-implement-tg-32-evidence-precheck-follows-the-one
 */

import { describe, it, expect } from "vitest";
import type { LoreError } from "@lore/core";
import { exitCode } from "../../../src/adapters/cli/utils.js";
import { findUnderMatchedPassRefusal } from "../../../src/adapters/cli/evidence-precheck.js";

// ─── Fixtures ───────────────────────────────────────────────────────────────

// reason: both named files must EXIST: the CLI refuses a missing oracle file (field `command`) before the
// under-match guard speaks (field `output_tail`), so a deleted file would turn the cases red for the wrong reason.
const BUN_NAMED_FILE = "packages/lore/tests/unit/adapters/cli-anchor-resolution.bun.test.ts";
const VITEST_NAMED_FILE = "packages/lore/tests/unit/adapters/assess-commit-derivation.test.ts";

/** The one-runner command this repo's own evidence now records for a `.bun.test.ts` file. */
const ONE_RUNNER_BUN_FILE_COMMAND = `bunx --bun vitest run ${BUN_NAMED_FILE}`;
/** Two files named; the shape measured 2026-08-01. */
const TWO_FILE_COMMAND = `bunx vitest run ${VITEST_NAMED_FILE} ${BUN_NAMED_FILE}`;

const TAIL_ONE_FILE = "Test Files  1 passed (1)\n     Tests  12 passed (12)\n";
const TAIL_TWO_FILES = "Test Files  2 passed (2)\n     Tests  15 passed (15)\n";
const TAIL_ZERO_FILES = "Test Files  0 passed (0)\n     Tests  0 passed (0)\n";
const TAIL_BUN_ONE_FILE = "Ran 3 tests across 1 file. [12.00ms]\n";

function refuseUnderMatched(overrides: {
  oracle?: string;
  result?: string;
  command?: string;
  outputTail?: string;
}): LoreError | null {
  return findUnderMatchedPassRefusal({
    oracle: overrides.oracle ?? "test",
    result: overrides.result ?? "pass",
    command: overrides.command ?? TWO_FILE_COMMAND,
    ...(overrides.outputTail !== undefined ? { outputTail: overrides.outputTail } : { outputTail: TAIL_ONE_FILE }),
  });
}

type ValidationError = Extract<LoreError, { code: "VALIDATION_ERROR" }>;

function expectRefusedWithExitFour(error: LoreError | null): ValidationError {
  expect(error).not.toBeNull();
  const refusal = error as LoreError;
  expect(refusal.code).toBe("VALIDATION_ERROR");
  expect(exitCode(refusal)).toBe(4);
  if (refusal.code !== "VALIDATION_ERROR") {
    throw new Error(`expected VALIDATION_ERROR, got ${refusal.code}`);
  }
  return refusal;
}

// ─── HAPPY ──────────────────────────────────────────────────────────────────

describe("findUnderMatchedPassRefusal — HAPPY", () => {
  it("accepts `bunx --bun vitest run <x>.bun.test.ts` whose summary shows the file ran (the one-runner regression)", () => {
    expect(
      refuseUnderMatched({ command: ONE_RUNNER_BUN_FILE_COMMAND, outputTail: TAIL_ONE_FILE }),
    ).toBeNull();
  });

  it("accepts a .bun.test.ts file under the nested-config form (vitest.node.config.ts) when it ran", () => {
    expect(
      refuseUnderMatched({
        command: `bunx vitest run --config vitest.node.config.ts ${BUN_NAMED_FILE}`,
        outputTail: TAIL_ONE_FILE,
      }),
    ).toBeNull();
  });

  it("accepts a plain `bun test` run of an ordinary .test.ts file (a consumer project's single runner)", () => {
    expect(
      refuseUnderMatched({ command: `bun test ${VITEST_NAMED_FILE}`, outputTail: TAIL_BUN_ONE_FILE }),
    ).toBeNull();
  });

  it("accepts two named files whose summary shows two executed", () => {
    expect(refuseUnderMatched({ outputTail: TAIL_TWO_FILES })).toBeNull();
  });

  it("accepts a chained two-invocation command whose two summaries sum to the named count", () => {
    const chained = `bunx vitest run ${VITEST_NAMED_FILE} && cd packages/lore && bun test ${BUN_NAMED_FILE}`;
    const bothSummaries = `${TAIL_ONE_FILE}\n${TAIL_BUN_ONE_FILE}`;
    expect(refuseUnderMatched({ command: chained, outputTail: bothSummaries })).toBeNull();
  });
});

// ─── NEGATIVE ───────────────────────────────────────────────────────────────

describe("findUnderMatchedPassRefusal — NEGATIVE", () => {
  it("refuses two named files when the summary shows only one executed, exit code 4", () => {
    const refusal = expectRefusedWithExitFour(refuseUnderMatched({ outputTail: TAIL_ONE_FILE }));
    expect(refusal.field).toBe("output_tail");
  });

  it("names the declared and executed counts and the repair, never a repo runner convention", () => {
    const refusal = expectRefusedWithExitFour(refuseUnderMatched({ outputTail: TAIL_ONE_FILE }));
    expect(refusal.message).toContain("2");
    expect(refusal.message).toContain("1");
    expect(refusal.message).toMatch(/under_match|fewer test files/i);
    expect(refusal.message).toMatch(/re-run|split|runner/i);
    expect(refusal.message).not.toContain("This repo splits");
    expect(refusal.message).not.toContain("CLAUDE.md");
    expect(refusal.value).toBe(TWO_FILE_COMMAND);
  });

  it("refuses a named file whose summary shows zero files executed", () => {
    const refusal = expectRefusedWithExitFour(
      refuseUnderMatched({ command: ONE_RUNNER_BUN_FILE_COMMAND, outputTail: TAIL_ZERO_FILES }),
    );
    expect(refusal.message).toMatch(/zero_match|no test file/i);
  });

  it("refuses the symmetric dropped file under bun test too (no runner is assumed)", () => {
    const refusal = expectRefusedWithExitFour(
      refuseUnderMatched({
        command: `bun test ${BUN_NAMED_FILE} ${VITEST_NAMED_FILE}`,
        outputTail: TAIL_BUN_ONE_FILE,
      }),
    );
    expect(refusal.message).toMatch(/under_match|fewer test files/i);
  });
});

// ─── BOUNDARY (fail-open cases, documented) ─────────────────────────────────

describe("findUnderMatchedPassRefusal — BOUNDARY: nothing to compare, nothing refused", () => {
  it("leaves a call with no output tail alone (the pass-tail requirement owns that gap)", () => {
    expect(
      findUnderMatchedPassRefusal({ oracle: "test", result: "pass", command: TWO_FILE_COMMAND }),
    ).toBeNull();
  });

  it("leaves a tail no known runner summary is recognised in alone (fail-open, as lore verify)", () => {
    expect(refuseUnderMatched({ outputTail: "ok\n" })).toBeNull();
  });

  it("leaves a command naming no test-file path alone", () => {
    expect(refuseUnderMatched({ command: "bunx vitest run --reporter json", outputTail: TAIL_ONE_FILE })).toBeNull();
  });

  it("leaves a case-filtered command to the filtered-pass guard", () => {
    expect(
      refuseUnderMatched({
        command: `bunx vitest run ${VITEST_NAMED_FILE} ${BUN_NAMED_FILE} -t 'AC-1'`,
        outputTail: TAIL_ONE_FILE,
      }),
    ).toBeNull();
  });
});

// ─── REGRESSION (scope gate) ────────────────────────────────────────────────

describe("findUnderMatchedPassRefusal — REGRESSION: out-of-scope oracle/result untouched", () => {
  it("does not gate --result fail or expected-fail", () => {
    expect(refuseUnderMatched({ result: "fail" })).toBeNull();
    expect(refuseUnderMatched({ result: "expected-fail" })).toBeNull();
  });

  it("does not gate out-of-scope oracle kinds", () => {
    for (const oracle of ["tsc", "lint", "build", "manual", "other"]) {
      expect(refuseUnderMatched({ oracle })).toBeNull();
    }
  });

  it("the old filename-suffix export no longer exists", async () => {
    const mod = (await import("../../../src/adapters/cli/evidence-precheck.js")) as Record<string, unknown>;
    expect(mod["findMixedRunnerRefusal"]).toBeUndefined();
    expect(mod["findCrossRunnerTokens"]).toBeUndefined();
  });
});
