/**
 * Six-dimension tests for the attestation-completeness pure layer (SPEC-061
 * §Scope D1) — `countExplicitPathArgs`, `parseExecutedUnits`, `judgeCompleteness`.
 *
 * Dimension mapping:
 *   HAPPY:      the literal AC-060-7 three-path shape counts 3; a well-formed
 *               vitest/bun summary tail parses to the right file count; a
 *               zero/under/complete/unknown_runner input yields the matching verdict
 *   NEGATIVE:   a command with no path arguments counts 0; unrecognised stdout
 *               parses to null; a non-test-extension path (e.g. a config file) is
 *               never counted
 *   BOUNDARY:   `bun run test` (zero declared paths) is NEVER judged zero_match —
 *               declaredPaths === 0 short-circuits to "complete"; executed === declared
 *               is exactly "complete", not "under_match"; a flag's own value token is
 *               never counted even when it looks path-shaped
 *   ERROR:      n/a — this module has no IO/throw surface; every function is a total,
 *               referentially-transparent pure computation over its string/number input
 *   STATE:      n/a — no mutable/temporal state; verdict is a pure function of its
 *               two inputs, not any external state
 *   REGRESSION: the exact reproduced AC-060-7 command (2 of 3 paths nonexistent,
 *               vitest silently ran only the matching file) is asserted to be judged
 *               under_match/zero_match depending on the executed-file count — never
 *               silently "complete"
 *
 * @spec_ref SPEC-061 §Scope D1; §Acceptance Criteria AC-061-1, AC-061-2,
 *   AC-061-3, AC-061-9, AC-061-10; task
 *   task-fix-spec-061-miss-vitest-t-zero-matched-case-run-recorded (vitest
 *   "-t matches 0 cases" false-oracle miss fix)
 */

import { describe, it, expect } from "vitest";
import {
  countExplicitPathArgs,
  parseExecutedUnits,
  judgeCompleteness,
  commandHasCaseFilter,
  commandReferencesCompiledBinary,
  judgeBinaryFreshness,
  isTestFileAnchor,
  commandRunsFileUnfiltered,
} from "../src/attestation-completeness.js";

describe("countExplicitPathArgs", () => {
  it("HAPPY: counts the literal AC-060-7 three-path command as 3", () => {
    const command =
      "bun run test:vitest packages/lore/tests/unit/setup-service.test.ts " +
      "packages/lore/tests/unit/assets-ssot.test.ts " +
      "packages/lore/tests/unit/real-setup-ports.test.ts";
    expect(countExplicitPathArgs(command)).toBe(3);
  });

  it("HAPPY: counts a single declared test-file path as 1", () => {
    expect(countExplicitPathArgs("bunx vitest run packages/core/tests/foo.test.ts")).toBe(1);
  });

  it("NEGATIVE: a command with no path arguments counts 0", () => {
    expect(countExplicitPathArgs("bun run test")).toBe(0);
    expect(countExplicitPathArgs("bun run typecheck")).toBe(0);
  });

  it("NEGATIVE: a non-test-extension path is never counted (e.g. a config file)", () => {
    expect(countExplicitPathArgs("bunx vitest run --config packages/foo/vitest.config.ts")).toBe(
      0,
    );
  });

  it("BOUNDARY: a flag's own value contributes 0, e.g. --reporter json", () => {
    expect(countExplicitPathArgs("bunx vitest run --reporter json")).toBe(0);
  });

  it("BOUNDARY: a flag's value is ignored even alongside real declared paths", () => {
    const command = "bunx vitest run --reporter json packages/core/tests/foo.test.ts";
    expect(countExplicitPathArgs(command)).toBe(1);
  });

  it("BOUNDARY: a real path argument immediately after a boolean (valueless) flag is still counted", () => {
    const command = "bunx vitest run --silent packages/core/tests/foo.test.ts";
    expect(countExplicitPathArgs(command)).toBe(1);
  });

  it("BOUNDARY: an empty command string counts 0", () => {
    expect(countExplicitPathArgs("")).toBe(0);
  });
});

describe("parseExecutedUnits", () => {
  it("HAPPY: parses a vitest single-file-passed tail to {files: 1}", () => {
    const stdout = "some preamble\n\n Test Files  1 passed (1)\n Tests  4 passed (4)\n";
    expect(parseExecutedUnits(stdout)?.files).toBe(1);
  });

  it("HAPPY: parses a bun tail (\"Ran 963 tests across 70 files.\") to files: 70", () => {
    const stdout = "...\nRan 963 tests across 70 files. [1.42s]\n";
    expect(parseExecutedUnits(stdout)?.files).toBe(70);
  });

  it("HAPPY: parses a vitest mixed pass/fail tail using the total in parens", () => {
    const stdout = "Test Files  3 failed | 4 passed (7)\n";
    expect(parseExecutedUnits(stdout)?.files).toBe(7);
  });

  it("NEGATIVE: unrecognised stdout returns null", () => {
    expect(parseExecutedUnits("some unrelated tool output with no summary line\n")).toBeNull();
  });

  it("NEGATIVE: empty stdout returns null", () => {
    expect(parseExecutedUnits("")).toBeNull();
  });
});

describe("judgeCompleteness", () => {
  it("HAPPY: complete when executed files equal declared paths", () => {
    expect(judgeCompleteness({ declaredPaths: 3, executedUnits: { files: 3 } })).toBe("complete");
  });

  it("HAPPY: under_match when executed files < declared paths (AC-060-7 partial-match shape)", () => {
    expect(judgeCompleteness({ declaredPaths: 3, executedUnits: { files: 1 } })).toBe(
      "under_match",
    );
  });

  it("HAPPY: zero_match when executed files === 0 with >= 1 declared path", () => {
    expect(judgeCompleteness({ declaredPaths: 3, executedUnits: { files: 0 } })).toBe(
      "zero_match",
    );
  });

  it("HAPPY: unknown_runner when parsing yielded null", () => {
    expect(judgeCompleteness({ declaredPaths: 3, executedUnits: null })).toBe("unknown_runner");
  });

  it("BOUNDARY: declaredPaths === 0 is NEVER zero_match, even with 0 executed files", () => {
    // reason: a command that declares no path filter at all (e.g. `bun run test`) has
    // nothing to under/zero-match against — this is the exact false-positive this guard
    // must never produce (SPEC-061 §Design "the guard must never punish an undeclared-path
    // command").
    expect(judgeCompleteness({ declaredPaths: 0, executedUnits: { files: 0 } })).toBe("complete");
  });

  it("BOUNDARY: declaredPaths === 0 with a real executed count is complete", () => {
    expect(judgeCompleteness({ declaredPaths: 0, executedUnits: { files: 217 } })).toBe(
      "complete",
    );
  });

  it("BOUNDARY: unknown_runner takes precedence over declaredPaths === 0 (null always wins)", () => {
    expect(judgeCompleteness({ declaredPaths: 0, executedUnits: null })).toBe("unknown_runner");
  });

  it("BOUNDARY: executed files greater than declared paths is still complete", () => {
    expect(judgeCompleteness({ declaredPaths: 2, executedUnits: { files: 5 } })).toBe("complete");
  });

  it("REGRESSION: the reproduced AC-060-7 shape (2 of 3 paths nonexistent) is under_match, never complete", () => {
    const command =
      "bun run test:vitest packages/lore/tests/unit/setup-service.test.ts " +
      "packages/lore/tests/unit/assets-ssot.test.ts " +
      "packages/lore/tests/unit/real-setup-ports.test.ts";
    const declaredPaths = countExplicitPathArgs(command);
    // vitest silently ran only the ONE matching file (assets-ssot.test.ts).
    const executedUnits = parseExecutedUnits("...\nTest Files  1 passed (1)\n");
    expect(judgeCompleteness({ declaredPaths, executedUnits })).toBe("under_match");
  });
});

// ─── Part B: -t / --testNamePattern matched-case count (task
// task-verify-trust-extensions-build-freshness-t-case-count-guard, Part B) ──────

describe("parseExecutedUnits — vitest 'Tests' line (Part B prerequisite)", () => {
  it("HAPPY: a vitest tail carrying both 'Test Files' and 'Tests' lines parses both counts", () => {
    const stdout = "some preamble\n\n Test Files  1 passed (1)\n Tests  4 passed (4)\n";
    expect(parseExecutedUnits(stdout)).toEqual({ files: 1, tests: 4 });
  });

  it("REGRESSION: a vitest tail with ONLY 'Test Files' (no 'Tests' line) leaves tests undefined", () => {
    const stdout = "...\nTest Files  1 passed (1)\n";
    const result = parseExecutedUnits(stdout);
    expect(result?.files).toBe(1);
    expect(result?.tests).toBeUndefined();
  });

  it("BOUNDARY: the 'Test Files' line itself never false-matches the 'Tests' pattern", () => {
    // reason: "Tests" (plural, standalone word) must not accidentally match inside
    // "Test Files" (singular "Test" + " Files") — if it did, `tests` would wrongly
    // pick up the FILE count instead of staying undefined.
    const stdout = "Test Files  1 passed (1)\n";
    expect(parseExecutedUnits(stdout)?.tests).toBeUndefined();
  });

  // ─── task-fix-spec-061-miss-vitest-t-zero-matched-case-run-recorded:
  // the "-t matches 0 cases" false-oracle miss. Fixtures below use REAL vitest
  // v3.2.6 output captured by running `bunx vitest run
  // packages/core/tests/attestation-completeness.test.ts -t '<pattern>'`
  // against this repo's own suite (not an imagined shape) — see task
  // verification_evidence / commit message for the exact repro commands.

  it("REGRESSION (task-fix-spec-061-miss-vitest-t-zero-matched-case-run-recorded): a -t filter matching 0 cases reports tests:0, not the 'skipped' total", () => {
    // reason: this is the EXACT false-oracle shape — every test in the loaded
    // file is reported "skipped" (not "passed"), so the line's trailing
    // parenthesised total (46) is nonzero even though nothing matched. Reading
    // that total (the pre-fix behavior) reported tests:46 for a filter that
    // matched zero cases.
    const stdout =
      " RUN  v3.2.6 /repo\n\n" +
      " ↓ packages/core/tests/attestation-completeness.test.ts (46 tests | 46 skipped)\n\n" +
      " Test Files  1 skipped (1)\n" +
      "      Tests  46 skipped (46)\n" +
      "   Start at  22:40:50\n" +
      "   Duration  272ms\n";
    expect(parseExecutedUnits(stdout)).toEqual({ files: 1, tests: 0 });
  });

  it("HAPPY: a -t filter matching SOME cases reports the passed+skipped breakdown's matched count, not the trailing total", () => {
    // reason: real captured shape — 16 of 46 cases matched (passed), the
    // other 30 were skipped (did not match); the trailing total (46) is the
    // file's full case count, not the matched count.
    const stdout =
      " ✓ packages/core/tests/attestation-completeness.test.ts (46 tests | 30 skipped) 2ms\n\n" +
      " Test Files  1 passed (1)\n" +
      "      Tests  16 passed | 30 skipped (46)\n";
    expect(parseExecutedUnits(stdout)).toEqual({ files: 1, tests: 16 });
  });

  it("BOUNDARY: a mixed passed+failed+skipped breakdown sums passed and failed, excluding skipped", () => {
    // reason: real captured shape from a 3-case file filtered to 2 cases (one
    // passing, one failing) — the matched count is failed(1)+passed(1)=2, the
    // skipped(1) case never ran and must not be counted.
    const stdout = " Test Files  1 failed (1)\n      Tests  1 failed | 1 passed | 1 skipped (3)\n";
    expect(parseExecutedUnits(stdout)).toEqual({ files: 1, tests: 2 });
  });

  it("STATE (T1-shape end-to-end): the full SPEC-075 T1-stage incident command now judges zero_match, never complete", () => {
    // reason: pins the exact incident end-to-end (task body: "'cd
    // packages/dashboard && bunx vitest run -t AC-075-N' ... executed the
    // existing 37-file suite, matched ZERO cases ... attestation recorded
    // completeness: complete, executed_files: 37"). The literal `-t AC-075-1`
    // command has no explicit file-path arguments (declaredPaths is 0) against
    // a 37-file-suite zero-matched-case vitest output. Pre-fix, this fell
    // through to the file-level `declaredPaths === 0 -> "complete"` rule
    // DESPITE zero cases matching; post-fix, the case-filter branch's
    // `tests === 0 -> "zero_match"` check fires first (VerifyRunnerService maps
    // any non-"complete" verdict to `inconclusive`, exit 3).
    const command = "cd packages/dashboard && bunx vitest run -t AC-075-1";
    const stdout =
      " Test Files  37 skipped (37)\n" + "      Tests  312 skipped (312)\n" + "   Duration  4.2s\n";
    const declaredPaths = countExplicitPathArgs(command);
    expect(declaredPaths).toBe(0);
    const executedUnits = parseExecutedUnits(stdout);
    expect(executedUnits).toEqual({ files: 37, tests: 0 });
    const hasCaseFilter = commandHasCaseFilter(command);
    expect(hasCaseFilter).toBe(true);
    expect(judgeCompleteness({ declaredPaths, executedUnits, hasCaseFilter })).toBe("zero_match");
  });
});

describe("commandHasCaseFilter", () => {
  it("HAPPY: recognises a short -t case filter", () => {
    expect(commandHasCaseFilter("bunx vitest run -t 'REPRO' packages/core/tests/a.test.ts")).toBe(
      true,
    );
  });

  it("HAPPY: recognises the long --testNamePattern flag", () => {
    expect(
      commandHasCaseFilter("bunx vitest run --testNamePattern REPRO packages/core/tests/a.test.ts"),
    ).toBe(true);
  });

  it("BOUNDARY: recognises the --testNamePattern=VALUE equals-form", () => {
    expect(commandHasCaseFilter("bunx vitest run --testNamePattern=REPRO")).toBe(true);
  });

  it("NEGATIVE: a filterless command is false", () => {
    expect(commandHasCaseFilter("bunx vitest run packages/core/tests/a.test.ts")).toBe(false);
    expect(commandHasCaseFilter("bun run test")).toBe(false);
  });

  it("BOUNDARY: a token merely CONTAINING '-t' as a substring is never a false positive", () => {
    // reason: exact-token matching, not substring matching — "--title" contains "-t"
    // as a substring but is an unrelated flag.
    expect(commandHasCaseFilter("bun run test --title foo")).toBe(false);
  });
});

describe("judgeCompleteness — Part B case-filter extension", () => {
  it("HAPPY: hasCaseFilter true + 0 matched cases -> zero_match", () => {
    expect(
      judgeCompleteness({
        declaredPaths: 0,
        executedUnits: { files: 1, tests: 0 },
        hasCaseFilter: true,
      }),
    ).toBe("zero_match");
  });

  it("BOUNDARY: hasCaseFilter true + matched cases >= 1 but fewer than declaredPaths -> under_match", () => {
    // reason: the -t 'REPRO' filter matched only 1 case even though 3 file paths
    // were declared — a plausible-typo shape the file-level check alone would miss
    // (each declared file individually "matched" at the file level).
    expect(
      judgeCompleteness({
        declaredPaths: 3,
        executedUnits: { files: 3, tests: 1 },
        hasCaseFilter: true,
      }),
    ).toBe("under_match");
  });

  it("HAPPY: hasCaseFilter true + matched cases >= declaredPaths -> complete", () => {
    expect(
      judgeCompleteness({
        declaredPaths: 1,
        executedUnits: { files: 1, tests: 4 },
        hasCaseFilter: true,
      }),
    ).toBe("complete");
  });

  it("REGRESSION: filterless command (hasCaseFilter omitted) is BYTE-IDENTICAL to file-count-only behavior, even when tests is suspiciously low", () => {
    // reason: this is the exact scenario a naive 'always parse cases' change would
    // break — declaredPaths===3, files===3 (file-level complete), but tests===1
    // (a low case count that would wrongly downgrade to under_match if the case
    // check ran unconditionally). Without hasCaseFilter, the tests field MUST be
    // ignored entirely.
    expect(
      judgeCompleteness({ declaredPaths: 3, executedUnits: { files: 3, tests: 1 } }),
    ).toBe("complete");
  });

  it("REGRESSION: hasCaseFilter explicitly false behaves identically to omitted", () => {
    expect(
      judgeCompleteness({
        declaredPaths: 3,
        executedUnits: { files: 3, tests: 1 },
        hasCaseFilter: false,
      }),
    ).toBe("complete");
  });

  it("STATE: hasCaseFilter true but tests unparseable (undefined) falls through to the file-level check", () => {
    // reason: fail-open — no case-level data means no case-level verdict; the
    // guard must not invent a zero/under-match out of missing information. The
    // file-level check still applies underneath (files < declaredPaths here).
    expect(
      judgeCompleteness({
        declaredPaths: 3,
        executedUnits: { files: 1 },
        hasCaseFilter: true,
      }),
    ).toBe("under_match");
  });

  it("ERROR: hasCaseFilter true + executedUnits null is still unknown_runner (null always wins first)", () => {
    expect(
      judgeCompleteness({ declaredPaths: 3, executedUnits: null, hasCaseFilter: true }),
    ).toBe("unknown_runner");
  });
});

// ─── Part A: build-freshness precheck (task
// task-verify-trust-extensions-build-freshness-t-case-count-guard, Part A) ──────

describe("commandReferencesCompiledBinary", () => {
  it("HAPPY: a relative dist/lore invocation is recognised", () => {
    expect(commandReferencesCompiledBinary("./dist/lore verify plan-1")).toBe(true);
  });

  it("HAPPY: an absolute path ending in dist/lore is recognised", () => {
    expect(commandReferencesCompiledBinary("/repo/dist/lore --version")).toBe(true);
  });

  it("NEGATIVE: an ordinary source-run command is false", () => {
    expect(commandReferencesCompiledBinary("bun run typecheck")).toBe(false);
    expect(commandReferencesCompiledBinary("lore claim task-1")).toBe(false);
  });

  it("BOUNDARY: a substring collision ('mydist/lore', no path separator boundary) is never a false positive", () => {
    // reason: word-boundary matching, not raw substring search — "mydist/lore"
    // contains the literal characters "dist/lore" but is not a path to the binary.
    expect(commandReferencesCompiledBinary("bun run mydist/lore-helper.ts")).toBe(false);
  });
});

describe("judgeBinaryFreshness", () => {
  it("HAPPY: null binaryMtimeMs (binary missing) -> missing", () => {
    expect(judgeBinaryFreshness({ binaryMtimeMs: null, newestSourceMtimeMs: 1000 })).toBe(
      "missing",
    );
  });

  it("HAPPY: newest source mtime newer than the binary -> stale", () => {
    expect(judgeBinaryFreshness({ binaryMtimeMs: 1000, newestSourceMtimeMs: 2000 })).toBe("stale");
  });

  it("HAPPY: binary mtime newer than every source file -> fresh", () => {
    expect(judgeBinaryFreshness({ binaryMtimeMs: 2000, newestSourceMtimeMs: 1000 })).toBe("fresh");
  });

  it("BOUNDARY: equal mtimes is fresh, not stale (strictly-greater-than source wins)", () => {
    expect(judgeBinaryFreshness({ binaryMtimeMs: 1000, newestSourceMtimeMs: 1000 })).toBe("fresh");
  });

  it("BOUNDARY: newestSourceMtimeMs 0 (no source files found) with a real binary is fresh", () => {
    expect(judgeBinaryFreshness({ binaryMtimeMs: 500, newestSourceMtimeMs: 0 })).toBe("fresh");
  });
});

// ─── isTestFileAnchor / commandRunsFileUnfiltered ────────────────────────────
// task-every-ac-oracle-is-t-scoped-so-the-file-passes-is-attested — the
// unfiltered-file-run detector `TaskWorkflowService.done`'s third evidence
// floor consumes.
//
// Dimension mapping:
//   HAPPY:      a plain file anchor is recognised as a test file; a plain
//               unfiltered command matches its exact anchor; a `cd <dir> &&`
//               prefixed command folds the offset into the match
//   NEGATIVE:   a directory-scoped anchor (trailing "/") is never a test
//               file; a command naming no token equal to the anchor never
//               matches; every enumerated case-filter spelling (long/short,
//               camel/kebab, "=" joined) defeats a match even when the exact
//               file token IS present
//   BOUNDARY:   a bare filename anchor (no "/") still recognised; a `./`
//               prefixed token still matches via comparison normalization;
//               an unrecognised cd-prefix shape (missing "&&") fails closed
//               rather than guessing an offset
//   ERROR:      n/a — both functions are pure/total, no throw surface;
//               garbage/empty input degrades to a boolean, never an exception
//   STATE:      n/a — no external state, pure function of its arguments
//   REGRESSION: a full-suite command with no explicit file token (`bun run
//               test`) and a selective/derived-set command (`bun run
//               test:changed main`) never count as an unfiltered run of a
//               specific file, however plausible it is that the file ran —
//               this module never DERIVES a touched-file set from a command

describe("isTestFileAnchor", () => {
  it("HAPPY: a .test.ts anchor is recognised", () => {
    expect(isTestFileAnchor("packages/core/tests/attestation-completeness.test.ts")).toBe(true);
  });

  it("HAPPY: a .bun.test.ts anchor is recognised (final two dot-segments match)", () => {
    expect(isTestFileAnchor("packages/lore/tests/unit/store/sqlite-store.bun.test.ts")).toBe(true);
  });

  it("HAPPY: a .spec.tsx anchor is recognised", () => {
    expect(isTestFileAnchor("packages/dashboard/src/components/Foo.spec.tsx")).toBe(true);
  });

  it("NEGATIVE: a directory-scoped anchor (trailing '/') is never a test file, even with a test-shaped name", () => {
    expect(isTestFileAnchor("packages/core/tests/")).toBe(false);
  });

  it("NEGATIVE: an ordinary source file is not a test file", () => {
    expect(isTestFileAnchor("packages/core/src/attestation-completeness.ts")).toBe(false);
  });

  it("BOUNDARY: a bare filename anchor with no '/' at all is still recognised", () => {
    expect(isTestFileAnchor("standalone.test.ts")).toBe(true);
  });

  it("REGRESSION: agrees with countExplicitPathArgs's own test-file convention on the same path", () => {
    const path = "packages/lore/tests/unit/setup-service.test.ts";
    expect(isTestFileAnchor(path)).toBe(true);
    expect(countExplicitPathArgs(`bunx vitest run ${path}`)).toBe(1);
  });
});

describe("commandRunsFileUnfiltered", () => {
  const FILE = "packages/core/tests/attestation-completeness.test.ts";

  it("HAPPY: a plain unfiltered vitest command naming the exact file matches", () => {
    expect(commandRunsFileUnfiltered(`bunx vitest run ${FILE}`, FILE)).toBe(true);
  });

  it("HAPPY: a cd-prefixed bun test command folds the offset into the match", () => {
    const command = "cd packages/lore && bun test tests/integration/verify-executor.bun.test.ts";
    expect(
      commandRunsFileUnfiltered(command, "packages/lore/tests/integration/verify-executor.bun.test.ts"),
    ).toBe(true);
  });

  it("HAPPY: a multi-file batch command matches on the file that IS present", () => {
    const command = `bunx vitest run ${FILE} packages/core/tests/other.test.ts`;
    expect(commandRunsFileUnfiltered(command, FILE)).toBe(true);
  });

  it("NEGATIVE: a command naming no token equal to the anchor never matches", () => {
    expect(commandRunsFileUnfiltered("bunx vitest run packages/core/tests/other.test.ts", FILE)).toBe(
      false,
    );
  });

  it("NEGATIVE: -t (short, space-separated) defeats a match even though the file is named", () => {
    expect(commandRunsFileUnfiltered(`bunx vitest run ${FILE} -t 'one case'`, FILE)).toBe(false);
  });

  it("NEGATIVE: --testNamePattern (long, camelCase, space-separated) defeats a match", () => {
    expect(commandRunsFileUnfiltered(`bunx vitest run ${FILE} --testNamePattern 'one case'`, FILE)).toBe(
      false,
    );
  });

  it("NEGATIVE: --test-name-pattern (long, kebab-case — bun test's own spelling) defeats a match", () => {
    expect(
      commandRunsFileUnfiltered(`bun test ${FILE} --test-name-pattern 'one case'`, FILE),
    ).toBe(false);
  });

  it("NEGATIVE: -t=<pattern> ('=' joined short form) defeats a match", () => {
    expect(commandRunsFileUnfiltered(`bunx vitest run ${FILE} -t=alpha`, FILE)).toBe(false);
  });

  it("NEGATIVE: --testNamePattern=<pattern> ('=' joined camelCase) defeats a match", () => {
    expect(commandRunsFileUnfiltered(`bunx vitest run ${FILE} --testNamePattern=alpha`, FILE)).toBe(
      false,
    );
  });

  it("NEGATIVE: --test-name-pattern=<pattern> ('=' joined kebab-case) defeats a match", () => {
    expect(commandRunsFileUnfiltered(`bun test ${FILE} --test-name-pattern=alpha`, FILE)).toBe(false);
  });

  it("BOUNDARY: a './'-prefixed token still matches via comparison normalization", () => {
    expect(commandRunsFileUnfiltered(`bunx vitest run ./${FILE}`, FILE)).toBe(true);
  });

  it("BOUNDARY: an unrecognised cd-prefix shape (missing '&&') fails closed rather than guessing an offset", () => {
    // "cd packages/lore bun test tests/x.bun.test.ts" has no "&&" — stripCdPrefix
    // leaves it untouched, so the (unstripped) command is tokenized as-is and no
    // token equals the repo-root-relative target — never a false positive.
    const command = "cd packages/lore bun test tests/integration/verify-executor.bun.test.ts";
    expect(
      commandRunsFileUnfiltered(command, "packages/lore/tests/integration/verify-executor.bun.test.ts"),
    ).toBe(false);
  });

  it("ERROR: an empty command string never throws, degrades to false", () => {
    expect(() => commandRunsFileUnfiltered("", FILE)).not.toThrow();
    expect(commandRunsFileUnfiltered("", FILE)).toBe(false);
  });

  it("REGRESSION: a full-suite command with no explicit file token never counts as an unfiltered run of a specific file", () => {
    expect(commandRunsFileUnfiltered("bun run test", FILE)).toBe(false);
  });

  it("REGRESSION: a selective/derived-set command (test:changed) never counts, however plausible the file ran", () => {
    expect(commandRunsFileUnfiltered("bun run test:changed main", FILE)).toBe(false);
  });
});
