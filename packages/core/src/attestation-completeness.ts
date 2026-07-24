/**
 * Attestation completeness guard — detects a "zero-match"/"under-match" test
 * oracle: a `script:test` acceptance-criterion command that exits 0 while
 * having actually executed FEWER test files than it explicitly named (or
 * none at all), because the runner silently ignored a non-matching path
 * filter. Pure, browser-safe module: no IO, no Date.now()/Math.random() calls
 * — mirrors `ac-quality.ts`/`staleness.ts`'s shape.
 *
 * Public surface:
 *   - countExplicitPathArgs(command) — counts argv tokens in a shell command
 *     string that look like explicit test-file path arguments, ignoring the
 *     command's own flags and their values.
 *   - parseExecutedUnits(stdout) — recognises the run-summary tail of the two
 *     runners this repo uses (vitest / bun test), returning how many files
 *     (and, when parseable, tests) were actually executed; `null` when no
 *     known summary line is present.
 *   - commandHasCaseFilter(command) — detects a `-t`/`--testNamePattern` case
 *     filter on the command (task "verify trust extensions" Part B).
 *   - judgeCompleteness({declaredPaths, executedUnits, hasCaseFilter?}) — pure
 *     decision combining the counts into a {@link CompletenessVerdict}.
 *   - commandReferencesCompiledBinary(command) — detects whether the command
 *     spawns the compiled `dist/lore` binary (task "verify trust extensions"
 *     Part A).
 *   - judgeBinaryFreshness({binaryMtimeMs, newestSourceMtimeMs}) — pure
 *     decision yielding a {@link BinaryFreshnessVerdict}; the caller performs
 *     the actual `stat()` calls (mtimes arrive as DATA, mirrors the
 *     `FsProbe`/git-facts precedent used elsewhere in this codebase).
 *
 * Invariants:
 *   - Referentially transparent: same input in → same output, always.
 *   - `countExplicitPathArgs` returns `0` for a command that declares no path
 *     arguments at all (e.g. `bun run test`) — a command that names nothing
 *     cannot be "under-matched" or "zero-matched" against its own declaration
 *     (see {@link judgeCompleteness}'s `declaredPaths === 0` short-circuit).
 *   - `parseExecutedUnits` never throws on arbitrary/garbled stdout — an
 *     unrecognised tail degrades to `null`, not an exception.
 *   - `judgeCompleteness`'s `hasCaseFilter` case-count branch is CONSULTED
 *     ONLY when `hasCaseFilter === true` AND `executedUnits.tests !== undefined`
 *     — a filterless command (the pre-existing SPEC-061 call shape, no third
 *     argument passed) is BYTE-IDENTICAL to before this module's Part B
 *     extension; an unparseable case count under a filter fails OPEN by
 *     falling through to the file-level check rather than inventing a verdict
 *     from missing data.
 *   - `judgeBinaryFreshness` never does IO itself — `binaryMtimeMs`/
 *     `newestSourceMtimeMs` are caller-supplied facts (the caller `stat()`s).
 *   - `parseExecutedUnits`'s vitest matched-case count (the `tests` field) is
 *     the sum of the "Tests" line's `passed`/`failed` segments, NEVER its
 *     trailing parenthesised total — a `-t` filter matching zero cases makes
 *     vitest report every test as `skipped` (e.g. `"Tests 46 skipped (46)"`),
 *     so reading the total would report 46 matched cases for a filter that
 *     matched none. See {@link countMatchedVitestCases}.
 *
 * Side-effect class: pure
 *
 * Source: SPEC-061 — Attestation completeness guard (detect zero-match /
 *   under-match test oracles), §Scope D1, §Acceptance Criteria AC-061-1..3;
 *   task "verify trust extensions" (build-freshness precheck + -t matched-case
 *   count guard), AC-061-9, AC-061-10; task
 *   task-fix-spec-061-miss-vitest-t-zero-matched-case-run-recorded (fixes the
 *   vitest "-t matches 0 cases but every test is reported `skipped`, not
 *   `passed`" miss — SPEC-075 T1-stage incident)
 */

// ─── Explicit Path-Argument Counting ────────────────────────────────────────

/**
 * Matches a token that looks like an explicit test-file path argument: an
 * ordinary (non-flag) shell token containing a `/` and ending in the
 * `.test.<ext>` / `.spec.<ext>` convention this repo's two runners use
 * (`ext` ∈ ts/tsx/js/jsx/mjs/cjs, optionally prefixed with a runner marker
 * such as `.bun.test.ts` — the pattern only anchors on the FINAL two
 * dot-segments, so `.bun.test.ts` matches via its trailing `.test.ts`).
 */
const TEST_FILE_PATH_PATTERN = /\.(test|spec)\.[cm]?[jt]sx?$/i;

/**
 * Splits a shell command string into argv-like tokens. Quoted substrings
 * (`"..."` / `'...'`) are kept intact as one token with the quotes stripped;
 * everything else splits on whitespace. This is a lightweight tokenizer, not
 * a full shell-grammar parser (no backslash-escape handling, no nested
 * quotes) — sufficient for the declarative `verify.command` strings this
 * module inspects (plain `bun run <script> <paths...>` / `bunx vitest run
 * <paths...>` invocations), never itself executed.
 */
function tokenizeCommand(command: string): string[] {
  const TOKEN_PATTERN = /"([^"]*)"|'([^']*)'|(\S+)/g;
  const tokens: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = TOKEN_PATTERN.exec(command)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return tokens;
}

/**
 * Counts the argv tokens in `command` that look like explicit test-file path
 * arguments (see {@link TEST_FILE_PATH_PATTERN}), ignoring the command's own
 * flags (`--foo`, `-f`) and — best-effort — a flag's own value token (the
 * token immediately following a flag that doesn't itself embed its value via
 * `=`), UNLESS that following token itself looks like an explicit test path
 * (a real positional path argument is never swallowed merely for following a
 * boolean flag with no value of its own, e.g. `--dry-run packages/x.test.ts`).
 *
 * @param command - The full shell command string (e.g. a script-mode AC's
 *   `verify.command`)
 * @returns The number of recognised explicit test-file path arguments; `0`
 *   for a command that declares none (e.g. `bun run test`, `bun run typecheck`)
 *
 * @example
 * countExplicitPathArgs(
 *   "bun run test:vitest packages/lore/tests/unit/setup-service.test.ts " +
 *     "packages/lore/tests/unit/assets-ssot.test.ts " +
 *     "packages/lore/tests/unit/real-setup-ports.test.ts",
 * );
 * // => 3 (the AC-060-7 false-attestation shape)
 *
 * @example
 * countExplicitPathArgs("bun run test") // => 0 — no path arguments declared
 *
 * @example
 * countExplicitPathArgs("bunx vitest run --reporter json") // => 0 — flag + its value, no paths
 */
export function countExplicitPathArgs(command: string): number {
  const tokens = tokenizeCommand(command);
  let count = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === undefined || token.length === 0) continue;

    if (token.startsWith("-")) {
      // A flag itself is never a path argument.
      continue;
    }

    const looksLikeTestPath = token.includes("/") && TEST_FILE_PATH_PATTERN.test(token);

    const previous = tokens[i - 1];
    const isFlagValue =
      previous !== undefined &&
      previous.startsWith("-") &&
      !previous.includes("=") &&
      !looksLikeTestPath;
    if (isFlagValue) {
      // This token is consumed as the preceding flag's value (e.g. the
      // "json" in "--reporter json") — never counted, regardless of shape.
      continue;
    }

    if (looksLikeTestPath) {
      count++;
    }
  }

  return count;
}

/**
 * The exact tokens (short and long form, plus the long form's `=value`
 * variant) this module recognises as a test-runner case-name filter. Both
 * vitest and bun test accept `-t`/`--testNamePattern <pattern>`.
 */
const CASE_FILTER_TOKENS = new Set(["-t", "--testNamePattern"]);
const CASE_FILTER_EQUALS_PREFIX = "--testNamePattern=";

/**
 * Detects whether `command` carries a `-t`/`--testNamePattern` test-CASE-name
 * filter (as opposed to the file-PATH filtering `countExplicitPathArgs`
 * counts). Exact-token matching, never substring matching — `--title` is a
 * different, unrelated flag that happens to contain `-t` as a substring.
 *
 * @param command - The full shell command string.
 * @returns `true` iff a case-filter flag token is present.
 *
 * @example
 * commandHasCaseFilter("bunx vitest run -t 'REPRO' packages/core/tests/a.test.ts")
 * // => true
 *
 * @example
 * commandHasCaseFilter("bun run test --title foo") // => false — "--title" is not "-t"
 */
export function commandHasCaseFilter(command: string): boolean {
  const tokens = tokenizeCommand(command);
  return tokens.some(
    (token) => CASE_FILTER_TOKENS.has(token) || token.startsWith(CASE_FILTER_EQUALS_PREFIX),
  );
}

// ─── Executed-Unit Parsing ───────────────────────────────────────────────────

/**
 * How many test files (and, when parseable, tests) a runner reports having
 * actually executed, extracted from its stdout summary line.
 *
 * @invariant `tests` is present-iff-parseable from the summary a runner
 *   emitted: bun's `"Ran N tests across M files"` line always carries both
 *   counts; vitest emits its file count on a `"Test Files … (N)"` line and
 *   (when present in the captured tail) its MATCHED-case count on a separate
 *   `"Tests … (N)"` line — `tests` is populated for a vitest-shaped match
 *   ONLY when that second line was captured (a tail truncation that drops it
 *   degrades to `tests: undefined`, never a fabricated count). For vitest,
 *   "matched" means the `passed`/`failed` segments of that line's breakdown
 *   (see {@link countMatchedVitestCases}), NOT the line's trailing
 *   parenthesised total — a `-t` filter that selects zero cases makes every
 *   test in the loaded file(s) `skipped`, so the total stays nonzero while
 *   the matched count is correctly `0`.
 */
export interface ExecutedUnits {
  files: number;
  tests?: number;
}

/**
 * bun test's run-summary tail, e.g. `"Ran 963 tests across 70 files."`.
 * Captures the test count (group 1) and file count (group 2).
 */
const BUN_SUMMARY_PATTERN = /\bRan\s+(\d+)\s+tests?\s+across\s+(\d+)\s+files?\b/i;

/**
 * vitest's run-summary tail, e.g. `"Test Files  1 passed (1)"` or, with a
 * mixed pass/fail breakdown, `"Test Files  3 failed | 4 passed (7)"`. The
 * parenthesised number is always the TOTAL file count vitest processed,
 * regardless of the pass/fail breakdown preceding it — that total is what
 * "how many files were actually executed" means for this guard.
 */
const VITEST_SUMMARY_PATTERN = /Test Files\s+.*?\((\d+)\)/;

/**
 * vitest's separate case-count summary line, e.g. `"Tests  4 passed (4)"` or
 * a mixed `"Tests  1 failed | 3 passed (4)"`. Captures the BREAKDOWN body
 * (group 1 — everything between "Tests" and the trailing parenthesised
 * total) rather than the total itself; see {@link countMatchedVitestCases}
 * for why the trailing number is the wrong thing to read here. The leading
 * `\b` anchors on the whole word "Tests" (plural) so this can never
 * false-match inside the "Test Files" line above (singular "Test" followed
 * by " Files", never the substring "Tests"). Present in vitest's default
 * reporter output alongside the "Test Files" line; a truncated tail that
 * drops it is a genuine "not captured" case (see {@link ExecutedUnits}'s
 * field invariant), not parsed as zero.
 */
const VITEST_TESTS_LINE_PATTERN = /\bTests\s+(.*?)\((\d+)\)/;

/**
 * Matches one `<N> passed` / `<N> failed` segment inside a vitest "Tests"
 * line's breakdown body (the text {@link VITEST_TESTS_LINE_PATTERN} captures
 * before the trailing total). Deliberately excludes `skipped`/`todo`
 * segments — see {@link countMatchedVitestCases}.
 */
const VITEST_TESTS_RAN_SEGMENT_PATTERN = /(\d+)\s+(?:passed|failed)\b/g;

/**
 * Sums the `passed` + `failed` counts out of a vitest "Tests" line's
 * breakdown body — the count of cases the `-t`/`--testNamePattern` filter
 * actually SELECTED and ran, as opposed to the line's trailing parenthesised
 * number, which is the TOTAL test count in the loaded file(s) regardless of
 * whether the filter matched them.
 *
 * // reason: this is the exact false-oracle miss task
 * // task-fix-spec-061-miss-vitest-t-zero-matched-case-run-recorded closes —
 * // when a `-t` filter matches ZERO cases, vitest does not print "0 tests";
 * // it prints every test in the loaded file(s) as `skipped`, e.g.
 * // `"Tests  46 skipped (46)"`. Reading the trailing `(46)` as the matched
 * // count (the pre-fix behavior) reports 46 MATCHED cases for a filter that
 * // actually matched none — the exact SPEC-075 T1-stage incident (verify
 * // ran `-t AC-075-N` before the matching tests existed; 37 files loaded,
 * // 0 cases matched, attestation still recorded `completeness: complete`).
 * // `skipped`/`todo` segments are never counted: a skipped/not-selected test
 * // did not run, so it cannot count as "matched by the filter".
 *
 * @param testsLineBody - The breakdown text between "Tests" and the line's
 *   trailing `(N)` total (e.g. `"1 failed | 3 passed | 2 skipped "`, or just
 *   `"46 skipped "` when nothing matched).
 * @returns The summed `passed` + `failed` count; `0` when the body contains
 *   neither segment (every test in scope was skipped — nothing matched).
 *
 * @example
 * countMatchedVitestCases("4 passed ") // => 4
 *
 * @example
 * countMatchedVitestCases("1 failed | 1 passed | 1 skipped ") // => 2
 *
 * @example
 * countMatchedVitestCases("46 skipped ") // => 0 — nothing matched the filter
 */
function countMatchedVitestCases(testsLineBody: string): number {
  let matched = 0;
  for (const segment of testsLineBody.matchAll(VITEST_TESTS_RAN_SEGMENT_PATTERN)) {
    matched += Number(segment[1]);
  }
  return matched;
}

/**
 * Recognises the run-summary tail of the two runners this repo uses (bun
 * test, then vitest) and extracts the count of files actually executed.
 * Never throws — arbitrary or garbled stdout that matches neither pattern
 * degrades to `null`.
 *
 * @param stdout - Captured process output (stdout+stderr concatenated,
 *   typically the tail-truncated `output_tail` a verify run recorded — the
 *   summary line is emitted near the end of both runners' output, so a tail
 *   truncation essentially never loses it)
 * @returns `{files}` (plus `tests` when a case count was also parseable —
 *   always for bun, iff the "Tests" line was captured for vitest) when a
 *   known summary is found; `null` when no known runner-summary line is
 *   present
 *
 * @example
 * parseExecutedUnits("...\nTest Files  1 passed (1)\nTests  4 passed (4)\n")
 * // => { files: 1, tests: 4 }
 *
 * @example
 * parseExecutedUnits("...\nRan 963 tests across 70 files. [1.2s]\n")
 * // => { files: 70, tests: 963 }
 *
 * @example
 * // A -t filter that matched nothing: every test in the loaded file is
 * // "skipped", not "passed" — the matched-case count is correctly 0, even
 * // though the file itself still shows as executed.
 * parseExecutedUnits("...\nTest Files  1 skipped (1)\nTests  46 skipped (46)\n")
 * // => { files: 1, tests: 0 }
 *
 * @example
 * parseExecutedUnits("some unrelated tool output\n") // => null
 */
export function parseExecutedUnits(stdout: string): ExecutedUnits | null {
  const bunMatch = BUN_SUMMARY_PATTERN.exec(stdout);
  if (bunMatch !== null) {
    const tests = Number(bunMatch[1]);
    const files = Number(bunMatch[2]);
    return { files, tests };
  }

  const vitestMatch = VITEST_SUMMARY_PATTERN.exec(stdout);
  if (vitestMatch !== null) {
    const files = Number(vitestMatch[1]);
    const testsMatch = VITEST_TESTS_LINE_PATTERN.exec(stdout);
    if (testsMatch !== null) {
      const testsLineBody = testsMatch[1] ?? "";
      return { files, tests: countMatchedVitestCases(testsLineBody) };
    }
    return { files };
  }

  return null;
}

// ─── Completeness Verdict ────────────────────────────────────────────────────

/**
 * The four possible completeness verdicts for one executed `script:test` AC:
 *   - `"complete"` — executed file count is ≥ the declared path count (incl.
 *     the vacuous `declaredPaths === 0` case — nothing declared, nothing to
 *     under/zero-match against).
 *   - `"under_match"` — executed some, but fewer files than were declared.
 *   - `"zero_match"` — executed zero files despite ≥1 declared path (the
 *     AC-060-7 shape: every declared path silently failed to match).
 *   - `"unknown_runner"` — the stdout carried no recognised runner-summary
 *     line at all; fail-OPEN (never blocks — see `judgeCompleteness`'s JSDoc).
 */
export type CompletenessVerdict = "complete" | "under_match" | "zero_match" | "unknown_runner";

/** Input to {@link judgeCompleteness}. */
export interface CompletenessJudgeInput {
  /** {@link countExplicitPathArgs}'s result for the executed command. */
  declaredPaths: number;
  /** {@link parseExecutedUnits}'s result for the command's captured stdout. */
  executedUnits: ExecutedUnits | null;
  /**
   * {@link commandHasCaseFilter}'s result for the executed command (Part B —
   * the `-t`/`--testNamePattern` matched-case guard). Omitted/`false` keeps
   * this function's decision BYTE-IDENTICAL to its pre-Part-B behavior —
   * `executedUnits.tests` is never consulted unless this is `true` (the
   * REGRESSION invariant a filterless command depends on).
   */
  hasCaseFilter?: boolean;
}

/**
 * Pure decision combining a command's declared-path count and its actually-
 * executed-file count into one {@link CompletenessVerdict}. Consulted ONLY
 * when the underlying process already exited 0 (a nonzero exit is already a
 * `fail`, and completeness is irrelevant — SPEC-061 §Design).
 *
 * Decision order:
 *   1. `executedUnits === null` → `"unknown_runner"` (fail-open: an
 *      unrecognised runner must never block a legitimate oracle merely
 *      because this guard doesn't understand its output format). This
 *      ALWAYS wins first, even when `hasCaseFilter` is `true`.
 *   2. `hasCaseFilter === true` AND `executedUnits.tests !== undefined` (Part
 *      B) — a case-name filter promises SOME test case matched; the matched
 *      CASE count is checked before the file-level check below:
 *        a. `executedUnits.tests === 0` → `"zero_match"` (the filter matched
 *           nothing at all — the exact "`vitest -t 'REPRO'` matched 0 tests"
 *           shape this guard closes).
 *        b. `declaredPaths > 0` AND `executedUnits.tests < declaredPaths` →
 *           `"under_match"` (fewer matched cases than declared file paths —
 *           a plausible signal that not every declared file's filtered case
 *           actually ran, even though each declared file individually
 *           "matched" at the file level below).
 *        c. Otherwise, falls through to the file-level check (defense in
 *           depth — a case-level pass does not exempt the file-level check).
 *      When `hasCaseFilter` is `true` but `executedUnits.tests` is
 *      `undefined` (case count unparseable from the captured stdout), this
 *      step is skipped entirely (fail-open — no case-level verdict is
 *      invented from missing data) and control falls through to the SAME
 *      file-level check every other input uses.
 *   3. `declaredPaths === 0` → `"complete"` (nothing was declared, so nothing
 *      can be under- or zero-matched — the BOUNDARY case, e.g. `bun run test`
 *      with no path arguments at all).
 *   4. `executedUnits.files === 0` → `"zero_match"` (≥1 path was declared,
 *      and NONE of them matched anything the runner actually ran — the
 *      AC-060-7 shape).
 *   5. `executedUnits.files < declaredPaths` → `"under_match"` (some, but not
 *      all, declared paths were matched).
 *   6. Otherwise (`executedUnits.files >= declaredPaths`) → `"complete"`.
 *
 * @example
 * judgeCompleteness({ declaredPaths: 3, executedUnits: { files: 1 } })
 * // => "under_match"
 *
 * @example
 * judgeCompleteness({ declaredPaths: 3, executedUnits: { files: 0 } })
 * // => "zero_match"
 *
 * @example
 * judgeCompleteness({ declaredPaths: 0, executedUnits: { files: 217 } })
 * // => "complete" — nothing was declared, so nothing can be under-matched
 *
 * @example
 * judgeCompleteness({ declaredPaths: 3, executedUnits: null })
 * // => "unknown_runner"
 *
 * @example
 * judgeCompleteness({
 *   declaredPaths: 3,
 *   executedUnits: { files: 3, tests: 1 },
 *   hasCaseFilter: true,
 * })
 * // => "under_match" — a -t filter matched only 1 of 3 declared files' cases
 */
export function judgeCompleteness(input: CompletenessJudgeInput): CompletenessVerdict {
  const { declaredPaths, executedUnits, hasCaseFilter = false } = input;

  if (executedUnits === null) {
    return "unknown_runner";
  }

  if (hasCaseFilter && executedUnits.tests !== undefined) {
    if (executedUnits.tests === 0) {
      return "zero_match";
    }
    if (declaredPaths > 0 && executedUnits.tests < declaredPaths) {
      return "under_match";
    }
    // Case-level check passed (>= 1 matched case, and not fewer than the
    // declared path count) — fall through to the file-level check below for
    // defense in depth; a case-level pass never SKIPS the file-level check.
  }

  if (declaredPaths === 0) {
    return "complete";
  }

  if (executedUnits.files === 0) {
    return "zero_match";
  }

  if (executedUnits.files < declaredPaths) {
    return "under_match";
  }

  return "complete";
}

// ─── Compiled-Binary Freshness (Part A) ─────────────────────────────────────

/**
 * Matches a command token that is (or ends in) a path to the compiled
 * `dist/lore` binary — `\b` before "dist" requires the preceding character
 * (if any) to be a non-word character (`/`, whitespace, start-of-string),
 * so a token like `mydist/lore-helper.ts` (no path-separator boundary before
 * "dist") never false-matches.
 */
const COMPILED_BINARY_PATTERN = /\bdist\/lore\b/;

/**
 * Detects whether `command` spawns the compiled `dist/lore` binary (as
 * opposed to running from source, e.g. `bun run src/index.ts` — which this
 * guard is not concerned with, since source-run commands are fresh by
 * construction).
 *
 * @param command - The full shell command string.
 * @returns `true` iff a `dist/lore` path token is present.
 *
 * @example
 * commandReferencesCompiledBinary("./dist/lore verify plan-1") // => true
 *
 * @example
 * commandReferencesCompiledBinary("bun run typecheck") // => false
 *
 * @example
 * commandReferencesCompiledBinary("bun run mydist/lore-helper.ts")
 * // => false — no path-separator boundary before "dist"
 */
export function commandReferencesCompiledBinary(command: string): boolean {
  return COMPILED_BINARY_PATTERN.test(command);
}

/**
 * Freshness verdict for the compiled `dist/lore` binary relative to this
 * repo's TypeScript sources:
 *   - `"missing"` — the binary does not exist at all.
 *   - `"stale"` — at least one source `.ts` file is newer than the binary
 *     (a `bun run build` has not run since the most recent source change).
 *   - `"fresh"` — the binary is at least as new as every scanned source file.
 */
export type BinaryFreshnessVerdict = "fresh" | "stale" | "missing";

/** Input to {@link judgeBinaryFreshness}. */
export interface BinaryFreshnessInput {
  /**
   * The compiled binary's `mtimeMs` (e.g. `fs.statSync(binPath).mtimeMs`), or
   * `null` when the binary does not exist at that path (e.g. `fs.existsSync`
   * returned `false`, so the caller never attempted the `stat()`).
   */
  binaryMtimeMs: number | null;
  /**
   * The newest `mtimeMs` among every relevant source `.ts` file (e.g. the
   * recursive scan `assert-fresh-binary.ts::newestTsMtimeMs` already
   * performs for `packages/lore/src` + `packages/core/src`); `0` when no
   * source file was found at all (a degenerate/empty scan — never treated as
   * "infinitely stale", see the BOUNDARY example below).
   */
  newestSourceMtimeMs: number;
}

/**
 * Pure decision comparing a compiled binary's mtime against the newest
 * relevant source file's mtime. Performs NO IO itself — both inputs are
 * caller-supplied facts (the caller `stat()`s; mirrors this codebase's
 * `FsProbe`/git-facts-as-DATA precedent, e.g. `verify-execution-root.ts`).
 *
 * @param input - `{binaryMtimeMs, newestSourceMtimeMs}`
 * @returns `"missing"` when `binaryMtimeMs` is `null`; `"stale"` when the
 *   newest source file is strictly newer than the binary; `"fresh"`
 *   otherwise (including the equal-mtime BOUNDARY case — the binary is
 *   considered fresh unless a source file is DEMONSTRABLY newer)
 *
 * @example
 * judgeBinaryFreshness({ binaryMtimeMs: null, newestSourceMtimeMs: 1000 })
 * // => "missing"
 *
 * @example
 * judgeBinaryFreshness({ binaryMtimeMs: 1000, newestSourceMtimeMs: 2000 })
 * // => "stale"
 *
 * @example
 * judgeBinaryFreshness({ binaryMtimeMs: 1000, newestSourceMtimeMs: 1000 })
 * // => "fresh" — equal mtimes are never stale
 */
export function judgeBinaryFreshness(input: BinaryFreshnessInput): BinaryFreshnessVerdict {
  const { binaryMtimeMs, newestSourceMtimeMs } = input;

  if (binaryMtimeMs === null) {
    return "missing";
  }

  if (newestSourceMtimeMs > binaryMtimeMs) {
    return "stale";
  }

  return "fresh";
}
