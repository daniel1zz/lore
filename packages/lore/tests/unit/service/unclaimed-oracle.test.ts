/**
 * Six-dimension tests for `scripts/check-unclaimed-oracle.ts`'s pure
 * cross-reference logic (M3, `spec-oracle-tier-falsifiability-a-criterion-never-observed-red`,
 * AC-FALS-8). Exercises `findUnclaimedOracleValues` directly with in-memory
 * fixtures — no file I/O, no `lore` subprocess, no live corpus (⛔ per this
 * task's own discipline: tests never read/write the repo's own `.lore/`
 * corpus). Fixtures are INSPIRED by this session's live instance
 * (`-t false-positive-bound` on `packages/core/tests/unit/ac-quality.test.ts`
 * going unbound after AC-ACQ-7 was restated) but are independent, throwaway
 * data — never asserted against the live corpus itself, which can drift out
 * from under a fixed assertion.
 *
 * Dimension mapping:
 *   HAPPY:      "unclaimed-oracle" (the AC-FALS-8-mandated case, both
 *               assertions in one test): a value present in a test file with
 *               NO declared AC binding it is reported; a value a declared AC
 *               DOES bind produces zero findings for it. Also proves the
 *               contiguous-substring guard: a decoy declared command binding
 *               a LONGER value that CONTAINS the unclaimed value as a raw
 *               substring must not launder it into looking claimed.
 *   NEGATIVE:   a declared command with no -t/testNamePattern flag at all
 *               contributes zero bindings — a candidate value in that same
 *               file is still reported unclaimed.
 *   BOUNDARY:   a describe title with TWO em-dash separators — only the
 *               segment after the LAST one is the candidate.
 *   ERROR:      ordinary prose test names (no hyphen, no em dash) are never
 *               treated as candidates at all — a file of plain-English test
 *               names with zero declared bindings produces zero findings.
 *   STATE:      the same candidate value repeated across multiple
 *               describe/it blocks in ONE file is counted and reported once.
 *   REGRESSION: all three flag spellings AC-FALS-8's own statement names
 *               (`-t`, `--testNamePattern`, `--test-name-pattern`) bind
 *               identically.
 */

import { describe, expect, it, beforeAll } from "vitest";

/**
 * `scripts/` sits outside `packages/lore/tsconfig.tests.json`'s declared `rootDir`
 * ("."), so a STATIC import of `scripts/check-unclaimed-oracle.ts` fails `tsc --noEmit
 * -p packages/lore/tsconfig.tests.json` with TS6059 ("File is not under 'rootDir'").
 * This is a program-construction-time diagnostic, not a per-line semantic one —
 * empirically confirmed a `@ts-expect-error` directly above the import does NOT
 * suppress it (TS instead reports the directive itself as unused, proving TS6059 is
 * never attached to that line's per-node diagnostic pass). This task's file anchors
 * are fixed to exactly two files (this one and the script) — no third
 * `tsconfig.tests.json` edit is in scope to widen `rootDir`/`include`.
 *
 * A NON-literal dynamic-import specifier (a `let`/`const string`, not a string
 * literal) sidesteps this: `tsc` cannot statically resolve a computed specifier for
 * type-checking, so the target file is never added to this Program's root-file set —
 * confirmed `bun run typecheck:lore-tests` is clean with this form. `bunx vitest run`
 * still resolves the SAME path correctly at RUNTIME (Vite's own resolver evaluates the
 * string once `beforeAll` runs, independent of tsc). The module's surface is typed by
 * hand below rather than inferred, since `tsc` never sees the real declaration.
 */
type UnclaimedOracleModule = {
  findUnclaimedOracleValues: (
    testFiles: readonly { path: string; content: string }[],
    declaredCommands: readonly string[],
  ) => {
    readonly findings: readonly { readonly file: string; readonly value: string }[];
    readonly scannedCandidateValues: number;
    readonly scannedClaimedBindings: number;
  };
};

const CHECK_UNCLAIMED_ORACLE_MODULE_PATH = "../../../../../scripts/check-unclaimed-oracle.js";

let findUnclaimedOracleValues: UnclaimedOracleModule["findUnclaimedOracleValues"];

beforeAll(async () => {
  const mod = (await import(CHECK_UNCLAIMED_ORACLE_MODULE_PATH)) as UnclaimedOracleModule;
  findUnclaimedOracleValues = mod.findUnclaimedOracleValues;
});

const WIDGET_TEST_FILE = "packages/example/tests/unit/widget.test.ts";

describe("findUnclaimedOracleValues", () => {
  it("unclaimed-oracle", () => {
    const testFiles = [
      {
        path: WIDGET_TEST_FILE,
        content: [
          'describe("Widget rendering — orphan-token", () => {',
          '  it("renders without crashing", () => {});',
          "});",
          "",
          'describe("Widget rendering — claimed-token", () => {',
          '  it("renders the claimed variant", () => {});',
          "});",
        ].join("\n"),
      },
    ];

    // One declared AC binds "claimed-token" in the SAME file — it must not be
    // reported. A second, DECOY declared AC binds a LONGER value
    // ("orphan-token-extended") that CONTAINS "orphan-token" as a raw
    // substring — a naive `command.includes(value)` matcher would treat this
    // as claiming "orphan-token" too (`"orphan-token-extended".includes("orphan-token")`
    // is `true`). It must not: only an EXACT token match binds a value.
    const declaredCommands = [
      `bunx vitest run ${WIDGET_TEST_FILE} -t claimed-token`,
      `bunx vitest run ${WIDGET_TEST_FILE} -t orphan-token-extended`,
    ];

    const report = findUnclaimedOracleValues(testFiles, declaredCommands);

    // Assertion 1: the withdrawn/never-declared value is reported.
    expect(report.findings).toContainEqual({ file: WIDGET_TEST_FILE, value: "orphan-token" });

    // Assertion 2: the value a declared AC DOES bind produces ZERO findings
    // for it, and the contiguous-substring decoy does not suppress the
    // genuinely-unclaimed value either — exactly one finding total.
    expect(report.findings).toHaveLength(1);
    expect(report.findings.some((f) => f.value === "claimed-token")).toBe(false);
  });

  it("ignores a declared command with no -t/testNamePattern flag", () => {
    const testFiles = [
      {
        path: WIDGET_TEST_FILE,
        content: 'describe("Widget rendering — unfiltered-token", () => {});',
      },
    ];
    // This command DOES reference the same file, but carries no test-name
    // filter at all — it must not be read as claiming every value in the
    // file it happens to run.
    const declaredCommands = [`bunx vitest run ${WIDGET_TEST_FILE}`];

    const report = findUnclaimedOracleValues(testFiles, declaredCommands);

    expect(report.findings).toEqual([{ file: WIDGET_TEST_FILE, value: "unfiltered-token" }]);
    expect(report.scannedClaimedBindings).toBe(0);
  });

  it("only the segment after the LAST em dash is treated as a candidate", () => {
    const testFiles = [
      {
        path: WIDGET_TEST_FILE,
        content: 'describe("Widget rendering — legacy-group — final-token", () => {});',
      },
    ];

    const report = findUnclaimedOracleValues(testFiles, []);

    expect(report.findings).toEqual([{ file: WIDGET_TEST_FILE, value: "final-token" }]);
    // Neither the whole title nor the middle segment is ALSO reported as a
    // second, spurious candidate.
    expect(report.findings.some((f) => f.value.includes("legacy-group"))).toBe(false);
  });

  it("ignores prose describe/it names when deriving candidates", () => {
    const testFiles = [
      {
        path: WIDGET_TEST_FILE,
        content: [
          'describe("Widget rendering", () => {',
          '  it("renders without crashing when props are empty", () => {});',
          '  it("shows a fallback for a missing image", () => {});',
          "});",
        ].join("\n"),
      },
    ];

    const report = findUnclaimedOracleValues(testFiles, []);

    expect(report.findings).toEqual([]);
    expect(report.scannedCandidateValues).toBe(0);
  });

  it("deduplicates a repeated candidate value within one file", () => {
    const testFiles = [
      {
        path: WIDGET_TEST_FILE,
        content: [
          'describe("Widget rendering — repeated-token", () => {',
          '  it("case A", () => {});',
          "});",
          'describe("Widget theming — repeated-token", () => {',
          '  it("case B", () => {});',
          "});",
        ].join("\n"),
      },
    ];

    const report = findUnclaimedOracleValues(testFiles, []);

    expect(report.scannedCandidateValues).toBe(1);
    expect(report.findings).toEqual([{ file: WIDGET_TEST_FILE, value: "repeated-token" }]);
  });

  it("recognizes --testNamePattern and --test-name-pattern as well as -t", () => {
    const testFiles = [
      {
        path: WIDGET_TEST_FILE,
        content: [
          'describe("Widget rendering — vitest-bound", () => {});',
          'describe("Widget rendering — bun-bound", () => {});',
        ].join("\n"),
      },
    ];
    const declaredCommands = [
      `bunx vitest run ${WIDGET_TEST_FILE} --testNamePattern vitest-bound`,
      `cd packages/example && bun test ${WIDGET_TEST_FILE} --test-name-pattern bun-bound`,
    ];

    const report = findUnclaimedOracleValues(testFiles, declaredCommands);

    expect(report.findings).toEqual([]);
    expect(report.scannedClaimedBindings).toBe(2);
  });
});
