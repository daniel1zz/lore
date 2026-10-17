// @spawns packages/lore/tests/fixtures/regex-case-filter/vitest.fixture.config.ts
/**
 * The literal-vs-regex `-t` filter defect
 * (task-a-t-filter-is-a-regex-so-this-repo-s-own-ac-titles), covered on BOTH
 * halves:
 *
 *   1. A REAL vitest subprocess run against
 *      `tests/fixtures/regex-case-filter/literal-ac-titles.fixture.ts`, whose
 *      case titles are verbatim copies of the two filter strings measured
 *      silently matching zero cases. Every assertion here is on the MATCHED
 *      COUNT the runner itself reports (read via `@lore/core`'s
 *      `parseExecutedUnits`, the same parser the guard uses), never on the exit
 *      code — the exit code is 0 for BOTH a 0-match and a 1-match run, which is
 *      precisely the false oracle this task removes.
 *   2. The pure guard (`findLiteralFilterMismatches` +
 *      `findFilteredPassRefusal`), fed both hand-built tails and the REAL
 *      captured child output.
 *
 * Six dimensions:
 *   HAPPY:      both measured titles are reported as mismatches with their
 *               metacharacters and escaped repair; the escaped filter makes the
 *               intended case actually run (matched count 0 → 1).
 *   NEGATIVE:   a metacharacter-free filter yields no mismatch and a refusal
 *               message byte-identical to before this task.
 *   BOUNDARY:   metacharacters that still match their own literal text (`.`,
 *               `{a}`) are NOT reported — the check is exact, not
 *               "contains a metacharacter", so `AC-1.H1` is never refused.
 *   ERROR:      a filter that is not a valid regular expression at all is
 *               reported with `compiles: false`.
 *   STATE:      a PROVEN non-zero matched count returns null even for a
 *               deliberate regex, so deliberate regex use needs no opt-out.
 *   REGRESSION: a title that legitimately matches zero cases is still reported
 *               as a zero-match refusal (never a pass) and keeps the pre-task
 *               message and `field`.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  CASE_FILTER_FLAGS_DESCRIPTION,
  escapeCaseFilterPattern,
  parseExecutedUnits,
  type LoreError,
} from "@lore/core";
import {
  findLiteralFilterMismatches,
  findFilteredPassRefusal,
} from "../../../src/adapters/cli/evidence-precheck.js";
import { exitCode } from "../../../src/adapters/cli/utils.js";

/** The two filter strings measured silently matching zero cases, verbatim. */
const MEASURED_PARENS_TITLE = "AC-2.H1 (GREEN)";
const MEASURED_PLUS_TITLE = "real repo tree + real corpus";
/** A fixture case title with no regex metacharacter at all — the control. */
const PLAIN_TITLE = "AC-2 metacharacter free control title";
/** A well-formed title that no fixture case carries — the honest-zero control. */
const ABSENT_TITLE = "AC-9 this case does not exist anywhere";

const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const FIXTURE_CONFIG = fileURLToPath(
  new URL("../../fixtures/regex-case-filter/vitest.fixture.config.ts", import.meta.url),
);

/** One real fixture run's observable facts. */
interface FixtureRun {
  /** The runner's OWN matched-case count; `undefined` when unparseable. */
  matched: number | undefined;
  exitCode: number | null;
  output: string;
}

/**
 * Spawns a REAL vitest process over the fixture file with `pattern` as its
 * case-name filter, and returns what the runner reported.
 *
 * // reason: a spawn failure (bunx missing, config unreadable) is asserted
 * // LOUD rather than degraded into `matched: 0` — a 0 that came from "the
 * // runner never started" would be indistinguishable from the very zero-match
 * // this test measures, which is the defect class under test.
 */
function runFixtureFilter(pattern: string): FixtureRun {
  const result = spawnSync("bunx", ["vitest", "run", "--config", FIXTURE_CONFIG, "-t", pattern], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 120_000,
  });
  expect(result.error).toBeUndefined();
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  expect(output).toContain("Test Files");
  return { matched: parseExecutedUnits(output)?.tests, exitCode: result.status, output };
}

/** The pass-shaped evidence write both halves of this suite exercise. */
function refuseFilteredPass(command: string, outputTail?: string): LoreError | null {
  return findFilteredPassRefusal({
    oracle: "test",
    result: "pass",
    command,
    ...(outputTail === undefined ? {} : { outputTail }),
  });
}

/** The one `LoreError` variant this guard is allowed to produce. */
type ValidationError = Extract<LoreError, { code: "VALIDATION_ERROR" }>;

/**
 * Narrows a refusal to the variant carrying `field`/`message`, asserting the
 * exit-code mapping on the way through (mirrors
 * `evidence-completeness-guard.test.ts`'s `expectRefusedWithExitFour`).
 */
function expectRefusal(error: LoreError | null): ValidationError {
  expect(error).not.toBeNull();
  const refusal = error as LoreError;
  expect(refusal.code).toBe("VALIDATION_ERROR");
  expect(exitCode(refusal)).toBe(4);
  if (refusal.code !== "VALIDATION_ERROR") {
    throw new Error(`expected VALIDATION_ERROR, got ${refusal.code}`);
  }
  return refusal;
}

function fixtureCommand(pattern: string): string {
  return `bunx vitest run packages/lore/tests/fixtures/regex-case-filter/literal-ac-titles.fixture.ts -t '${pattern}'`;
}

describe("literal-vs-regex -t filter — real runner, HAPPY", () => {
  it(
    "a pasted title containing ( ) selects ZERO cases at exit 0, and its ESCAPED form selects its one case",
    () => {
      const raw = runFixtureFilter(MEASURED_PARENS_TITLE);
      // The defect, measured: the filter matched nothing…
      expect(raw.matched).toBe(0);
      // …and the runner still exited 0, so exit code proves nothing here.
      expect(raw.exitCode).toBe(0);

      const escaped = runFixtureFilter(escapeCaseFilterPattern(MEASURED_PARENS_TITLE));
      // The repair: the SAME title, escaped, actually runs its case.
      expect(escaped.matched).toBe(1);
      expect(escaped.exitCode).toBe(0);
    },
    120_000,
  );

  it(
    "a pasted title containing + selects ZERO cases at exit 0, and its ESCAPED form selects its one case",
    () => {
      const raw = runFixtureFilter(MEASURED_PLUS_TITLE);
      expect(raw.matched).toBe(0);
      expect(raw.exitCode).toBe(0);

      const escaped = runFixtureFilter(escapeCaseFilterPattern(MEASURED_PLUS_TITLE));
      expect(escaped.matched).toBe(1);
      expect(escaped.exitCode).toBe(0);
    },
    120_000,
  );

  it(
    "the guard refuses the REAL zero-match output of the parenthesised run, naming the escaped repair",
    () => {
      const raw = runFixtureFilter(MEASURED_PARENS_TITLE);
      expect(raw.matched).toBe(0);

      const refusal = expectRefusal(refuseFilteredPass(fixtureCommand(MEASURED_PARENS_TITLE), raw.output));
      // The input the caller must CHANGE is the command, not the tail — a tail
      // showing matches cannot exist while this filter stands.
      expect(refusal.field).toBe("command");
      expect(refusal.message).toContain(escapeCaseFilterPattern(MEASURED_PARENS_TITLE));
      expect(refusal.message).toContain("REGULAR EXPRESSION");
    },
    120_000,
  );
});

describe("literal-vs-regex -t filter — real runner, NEGATIVE / REGRESSION controls", () => {
  it(
    "CONTROL: a metacharacter-free title behaves exactly as before — one case matched, no mismatch reported",
    () => {
      const run = runFixtureFilter(PLAIN_TITLE);
      expect(run.matched).toBe(1);
      expect(run.exitCode).toBe(0);
      expect(escapeCaseFilterPattern(PLAIN_TITLE)).toBe(PLAIN_TITLE);
      expect(findLiteralFilterMismatches(fixtureCommand(PLAIN_TITLE))).toEqual([]);
    },
    120_000,
  );

  it(
    "CONTROL: a title whose case genuinely does not exist is reported as a zero-match, NOT as a pass",
    () => {
      const run = runFixtureFilter(ABSENT_TITLE);
      // Legitimately zero — and the runner still exits 0, so the count is the
      // only honest signal.
      expect(run.matched).toBe(0);
      expect(run.exitCode).toBe(0);

      const refusal = expectRefusal(refuseFilteredPass(fixtureCommand(ABSENT_TITLE), run.output));
      // Unchanged by this task: the tail is what must change (by re-running a
      // filter that matches), so the field still names it…
      expect(refusal.field).toBe("output_tail");
      // …and no metacharacter diagnosis is attached, so "your filter is broken"
      // stays distinguishable from "this test does not exist".
      expect(refusal.message).not.toContain("REGULAR EXPRESSION");
      expect(refusal.message).toContain("zero_match");
    },
    120_000,
  );
});

describe("findLiteralFilterMismatches — HAPPY", () => {
  it("reports the parenthesised title with its metacharacters and escaped repair", () => {
    expect(findLiteralFilterMismatches(fixtureCommand(MEASURED_PARENS_TITLE))).toEqual([
      {
        pattern: MEASURED_PARENS_TITLE,
        metacharacters: [".", "(", ")"],
        escaped: "AC-2\\.H1 \\(GREEN\\)",
        compiles: true,
      },
    ]);
  });

  it("reports the `+` title with its metacharacter and escaped repair", () => {
    expect(findLiteralFilterMismatches(fixtureCommand(MEASURED_PLUS_TITLE))).toEqual([
      {
        pattern: MEASURED_PLUS_TITLE,
        metacharacters: ["+"],
        escaped: "real repo tree \\+ real corpus",
        compiles: true,
      },
    ]);
  });
});

describe("findLiteralFilterMismatches — NEGATIVE", () => {
  it("reports nothing for a metacharacter-free filter or an unfiltered command", () => {
    expect(findLiteralFilterMismatches(fixtureCommand("AC-1 happy path"))).toEqual([]);
    expect(findLiteralFilterMismatches("bunx vitest run a.test.ts")).toEqual([]);
    expect(findLiteralFilterMismatches("bun run typecheck")).toEqual([]);
  });
});

describe("findLiteralFilterMismatches — BOUNDARY", () => {
  it("does NOT report a metacharacter that still matches its own literal text", () => {
    // `.` matches the literal `.`, so `AC-2.H1` genuinely selects `AC-2.H1`.
    // A "contains a metacharacter" check would refuse essentially every AC id
    // this repo writes — the exact false-refusal this design avoids.
    expect(findLiteralFilterMismatches(fixtureCommand("AC-2.H1"))).toEqual([]);
    // `{a}` is not a valid quantifier, so JS treats it as literal text.
    expect(findLiteralFilterMismatches(fixtureCommand("AC-1 {a} shape"))).toEqual([]);
  });

  it("reports an anchor-only corruption (^ / $) that no title can ever match", () => {
    expect(findLiteralFilterMismatches(fixtureCommand("^AC-1 anchored"))).toHaveLength(1);
    expect(findLiteralFilterMismatches(fixtureCommand("AC-1 anchored$"))).toHaveLength(1);
  });
});

describe("findLiteralFilterMismatches — ERROR", () => {
  it("reports a filter that is not a valid regular expression with compiles: false", () => {
    const [mismatch] = findLiteralFilterMismatches(fixtureCommand("AC-1 (unbalanced"));
    expect(mismatch?.compiles).toBe(false);
    expect(mismatch?.escaped).toBe("AC-1 \\(unbalanced");

    const refusal = expectRefusal(
      refuseFilteredPass(
        fixtureCommand("AC-1 (unbalanced"),
        "Test Files  1 skipped (1)\nTests  3 skipped (3)\n",
      ),
    );
    expect(refusal.field).toBe("command");
    expect(refusal.message).toContain("not even form a valid regular expression");
  });
});

describe("findFilteredPassRefusal — STATE (deliberate regex stays usable)", () => {
  it("returns null for a DELIBERATE regex whose tail proves a non-zero matched count", () => {
    // `AC-(1|2)` cannot match its own literal text either, but a proven match
    // count short-circuits before the diagnosis is ever computed — so there is
    // no opt-out flag to add and nothing extra to record in the evidence row.
    expect(
      refuseFilteredPass(
        fixtureCommand("AC-(1|2)"),
        "Test Files  1 passed (1)\nTests  2 passed | 1 skipped (3)\n",
      ),
    ).toBeNull();
  });

  it("still attaches the diagnosis when a deliberate-looking regex proves NOTHING", () => {
    const refusal = expectRefusal(refuseFilteredPass(fixtureCommand("AC-(1|2)")));
    expect(refusal.field).toBe("command");
    // The `missing_tail` gap's own diagnosis wording (NOT the token
    // "missing_tail", which that gap's message deliberately does not carry —
    // only `zero_match`'s does).
    expect(refusal.message).toContain("no output tail was supplied at all");
    expect(refusal.message).toContain("AC-\\(1\\|2\\)");
  });
});

describe("findFilteredPassRefusal — REGRESSION (byte-identical control)", () => {
  it("a metacharacter-free zero-match refusal message is byte-identical to before this task", () => {
    const refusal = expectRefusal(
      refuseFilteredPass(
        fixtureCommand("AC-1 happy path"),
        "Test Files  1 skipped (1)\nTests  3 skipped (3)\n",
      ),
    );
    expect(refusal.field).toBe("output_tail");
    expect(refusal.message).toBe(
      "Filtered --result pass without matched-count proof: --command carries a case-name filter " +
        `(${CASE_FILTER_FLAGS_DESCRIPTION}) and zero_match — the supplied output tail's runner ` +
        "summary reports 0 matched test cases, so the exit-0 this pass rests on proves nothing " +
        "(fix the filter or the test title, then re-run). A filter that matches nothing still exits " +
        "0 with every test reported skipped, so this pass is unproven. Re-run the command, capture " +
        "the runner's summary lines, and pass them via --output-tail (or --output-tail-file; MCP: " +
        "output_tail); or record the run honestly with --result fail / expected-fail.",
    );
  });

  it("an out-of-scope oracle/result is still never gated, metacharacters or not", () => {
    for (const oracle of ["tsc", "lint", "build", "manual"]) {
      expect(
        findFilteredPassRefusal({
          oracle,
          result: "pass",
          command: fixtureCommand(MEASURED_PARENS_TITLE),
        }),
      ).toBeNull();
    }
    for (const result of ["fail", "expected-fail"]) {
      expect(
        findFilteredPassRefusal({
          oracle: "test",
          result,
          command: fixtureCommand(MEASURED_PARENS_TITLE),
        }),
      ).toBeNull();
    }
  });
});
