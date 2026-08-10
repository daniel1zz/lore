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
 *   - extractCaseFilterPatterns(command) — the VALUES of those same flags (the
 *     text the runner compiles as a regex), read from the SAME two flag sets
 *     `commandHasCaseFilter` uses so detection and extraction cannot disagree.
 *   - findRegexMetacharacters(pattern) / escapeCaseFilterPattern(pattern) /
 *     REGEX_METACHARACTERS_DESCRIPTION — the literal-vs-regex analysis and
 *     repair for a filter pasted from a test title
 *     (task-a-t-filter-is-a-regex-so-this-repo-s-own-ac-titles: a `-t` value is
 *     a REGULAR EXPRESSION, so this repo's own AC titles — `AC-2.H1 (GREEN)`,
 *     `all + caller_cwd` — select ZERO cases while the runner exits 0).
 *     Consumed by `lore evidence`'s filtered-pass guard
 *     (`adapters/cli/evidence-precheck.ts`).
 *   - CASE_FILTER_FLAGS_DESCRIPTION / RUNNER_SUMMARY_FORMATS_DESCRIPTION — the
 *     human-facing spelling of what the two rules above recognise, colocated
 *     with them so a consumer's error message never retypes (and drifts from)
 *     the vocabulary. Consumed by `lore evidence`'s filtered-pass guard
 *     (`adapters/cli/evidence-precheck.ts`).
 *   - judgeCompleteness({declaredPaths, executedUnits, hasCaseFilter?}) — pure
 *     decision combining the counts into a {@link CompletenessVerdict}.
 *   - commandReferencesCompiledBinary(command) — detects whether the command
 *     spawns the compiled `dist/lore` binary (task "verify trust extensions"
 *     Part A).
 *   - judgeBinaryFreshness({binaryMtimeMs, newestSourceMtimeMs}) — pure
 *     decision yielding a {@link BinaryFreshnessVerdict}; the caller performs
 *     the actual `stat()` calls (mtimes arrive as DATA, mirrors the
 *     `FsProbe`/git-facts precedent used elsewhere in this codebase).
 *   - isTestFileAnchor(anchor) — recognises whether a normalized
 *     `file_anchors` entry names a SPECIFIC test file (as opposed to a
 *     SPEC-042 D3 directory scope, trailing `/`) — task
 *     task-every-ac-oracle-is-t-scoped-so-the-file-passes-is-attested.
 *   - commandRunsFileUnfiltered(command, filePath) — pure decision: does
 *     `command` run the exact `filePath` test file with NO recognised
 *     case-name filter (a STRICT SUPERSET of `commandHasCaseFilter`'s flag
 *     set — see {@link UNFILTERED_RUN_CASE_FILTER_DESCRIPTION}'s own doc for
 *     why the two must not share one set). Consumed by
 *     `TaskWorkflowService.done`'s third evidence floor: one attested
 *     UNFILTERED `result:pass` run per declared test-file anchor, alongside
 *     the `-t`-scoped AC rows (`knowledge-assessment-implementation-lore-ac-
 *     set-the-dangling-ac`'s finding that a `-t`-filtered oracle attests only
 *     the ONE assertion it binds to, never "the file as a whole passes").
 *   - UNFILTERED_RUN_CASE_FILTER_DESCRIPTION — the human-facing spelling of
 *     the (broader) flag set {@link commandRunsFileUnfiltered} recognises,
 *     colocated for the same anti-drift reason as
 *     {@link CASE_FILTER_FLAGS_DESCRIPTION}.
 *   - findDiscoveryRefusal(outputTail) — recognises one of the three known
 *     runners' (vitest / bun test / playwright) discovery-refusal phrases —
 *     the wording printed when a runner's path filter(s) matched ZERO test
 *     files, an exit-1 outcome otherwise indistinguishable from a genuine
 *     assertion failure. Returns a {@link DiscoveryRefusal} naming the runner
 *     and the verbatim matched phrase, or `null` for any genuine run outcome
 *     or unrecognised input. spec-oracle-executability-a-runner-s-discovery-
 *     refusal-is-not-a §M6.1 — the missing primitive that makes
 *     `verify-runner-service.ts`'s completeness guard usable on the exit != 0
 *     branch (M6.2, consumed there, not in this module).
 *   - DiscoveryRefusal — the verdict shape `findDiscoveryRefusal` returns:
 *     `{runner: "vitest" | "bun" | "playwright", evidence: string}`.
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
 *   - `commandRunsFileUnfiltered` requires an EXACT token match against the
 *     target `filePath` (never a substring/"looks like a path" test) — this
 *     is deliberate: it is what makes the predicate immune to vitest's bare
 *     POSITIONAL filename filter (`vitest run <substring>`, no flag at all)
 *     without having to special-case that flag. Anything this module's
 *     `stripCdPrefix`/token comparison doesn't recognise (nested `cd`,
 *     subshells, glob expansion, `bun run <script>` indirection) fails
 *     CLOSED — no match found, never a fabricated one — forcing a clearer
 *     evidence command rather than risking a false positive.
 *
 * Side-effect class: pure
 *
 * Source: SPEC-061 — Attestation completeness guard (detect zero-match /
 *   under-match test oracles), §Scope D1, §Acceptance Criteria AC-061-1..3;
 *   task "verify trust extensions" (build-freshness precheck + -t matched-case
 *   count guard), AC-061-9, AC-061-10; task
 *   task-fix-spec-061-miss-vitest-t-zero-matched-case-run-recorded (fixes the
 *   vitest "-t matches 0 cases but every test is reported `skipped`, not
 *   `passed`" miss — SPEC-075 T1-stage incident); task
 *   task-every-ac-oracle-is-t-scoped-so-the-file-passes-is-attested (the
 *   unfiltered-file-run detector, §"Unfiltered-File-Run Detection" below);
 *   spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a §M6.1,
 *   AC-OX-1 (`findDiscoveryRefusal`, §"Discovery-Refusal Detection" below —
 *   task-add-finddiscoveryrefusal-to-lore-core-with-a-live-runner)
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
 * Human-facing spelling of the flags {@link commandHasCaseFilter} recognises,
 * for embedding in an operator-facing error message.
 *
 * // reason: this vocabulary lives HERE, beside the predicate that owns it,
 * // rather than being retyped inside each consumer's message string — a
 * // consumer that spells the flag itself is a second, drift-prone definition
 * // of "which flags count as a case filter" (SPEC-061 AC-061-14 scans
 * // `packages/lore/src` for exactly that literal and fails on any hit).
 */
export const CASE_FILTER_FLAGS_DESCRIPTION = "-t / --testNamePattern";

/**
 * Human-facing description of the runner-summary shapes
 * {@link parseExecutedUnits} recognises, for telling an operator what a
 * rejected output tail was missing. Colocated with the patterns themselves for
 * the same reason as {@link CASE_FILTER_FLAGS_DESCRIPTION}.
 */
export const RUNNER_SUMMARY_FORMATS_DESCRIPTION =
  'vitest\'s "Test Files … (N)" + "Tests … (N)" pair, or bun test\'s "Ran N tests across M files"';

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

/**
 * Extracts the VALUE of every case-filter flag in `command` — the pattern text
 * the runner will compile as a REGULAR EXPRESSION.
 *
 * Lives here, beside {@link commandHasCaseFilter} and the
 * {@link CASE_FILTER_TOKENS}/{@link CASE_FILTER_EQUALS_PREFIX} sets it shares
 * verbatim, for the same single-definition reason
 * {@link CASE_FILTER_FLAGS_DESCRIPTION} does (SPEC-061 AC-061-14 fails on any
 * re-spelling of the flag name in `packages/lore/src` executable code). A
 * consumer that needs the pattern therefore never re-tokenizes the command
 * itself, and detection ("is there a filter") can never disagree with
 * extraction ("what is it") — both read the SAME two sets.
 *
 * @param command - The full shell command string.
 * @returns Every case-filter value found, in source order, de-duplicated;
 *   `[]` when the command carries no case filter (or carries one with no
 *   value token — see the fail-open note below).
 *
 * // reason: a flag whose following token itself starts with `-` yields NO
 * // extracted pattern (skipped), rather than treating the next flag as the
 * // value. Both an argv parser (`-t --reporter x` → `-t` boolean) and this
 * // extractor would be guessing; extracting nothing means a consumer's
 * // diagnosis stays silent for that shape instead of naming a pattern the
 * // runner never received. This is a deliberate fail-open in the SAME
 * // direction as `countExplicitPathArgs`'s flag-value heuristic: it can only
 * // ever withhold a diagnosis, never fabricate one.
 *
 * @example
 * extractCaseFilterPatterns("bunx vitest run a.test.ts -t 'AC-2.H1 (GREEN)'")
 * // => ["AC-2.H1 (GREEN)"]
 *
 * @example
 * extractCaseFilterPatterns("bunx vitest run --testNamePattern=AC-1 a.test.ts")
 * // => ["AC-1"]
 *
 * @example
 * extractCaseFilterPatterns("bunx vitest run a.test.ts") // => []
 */
export function extractCaseFilterPatterns(command: string): string[] {
  const tokens = tokenizeCommand(command);
  const patterns: string[] = [];
  const seen = new Set<string>();
  const pushUnique = (pattern: string): void => {
    if (pattern.length === 0 || seen.has(pattern)) return;
    seen.add(pattern);
    patterns.push(pattern);
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) continue;
    if (token.startsWith(CASE_FILTER_EQUALS_PREFIX)) {
      pushUnique(token.slice(CASE_FILTER_EQUALS_PREFIX.length));
      continue;
    }
    if (!CASE_FILTER_TOKENS.has(token)) continue;
    const value = tokens[index + 1];
    if (value === undefined || value.startsWith("-")) continue;
    pushUnique(value);
  }
  return patterns;
}

// ─── Literal-vs-Regex Case-Filter Analysis ──────────────────────────────────

/**
 * Every character that carries special meaning inside a JavaScript regular
 * expression, and therefore every character whose presence in a PASTED TEST
 * TITLE silently changes what a `-t` filter selects
 * (task-a-t-filter-is-a-regex-so-this-repo-s-own-ac-titles: this repo's own
 * AC-naming convention — `AC-2.H1 (GREEN)`, `AC-VS-9 (BOUNDARY)`, `all +
 * caller_cwd` — puts two or three of them in almost every title an author
 * would paste, and the resulting filter matched ZERO cases while the runner
 * exited 0).
 *
 * The set is the full RegExp-syntax set, not the three that happened to bite:
 * a subset would be another contiguous-substring-class matcher whose misses
 * are silent (root CLAUDE.md, *Contiguous-substring assumption*). Ordered
 * `\` first so a reader sees the escape character is itself escaped.
 */
const REGEX_METACHARACTERS: readonly string[] = [
  "\\",
  "^",
  "$",
  ".",
  "|",
  "?",
  "*",
  "+",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
];

/**
 * Human-facing spelling of {@link REGEX_METACHARACTERS}, colocated with the
 * set for the same anti-drift reason as {@link CASE_FILTER_FLAGS_DESCRIPTION}
 * — a consumer's refusal message never retypes (and so can never under-state)
 * which characters are checked.
 */
export const REGEX_METACHARACTERS_DESCRIPTION = REGEX_METACHARACTERS.join(" ");

/**
 * Reports which {@link REGEX_METACHARACTERS} occur in `pattern`.
 *
 * @param pattern - a case-filter value (see {@link extractCaseFilterPatterns})
 * @returns the metacharacters present, de-duplicated, in
 *   {@link REGEX_METACHARACTERS} order — `[]` for a pattern that is already a
 *   pure literal
 * @example
 * findRegexMetacharacters("AC-2.H1 (GREEN)") // => [".", "(", ")"]
 * @example
 * findRegexMetacharacters("AC-1 happy path") // => []
 */
export function findRegexMetacharacters(pattern: string): string[] {
  return REGEX_METACHARACTERS.filter((metacharacter) => pattern.includes(metacharacter));
}

/**
 * Escapes every {@link REGEX_METACHARACTERS} occurrence in `pattern` so the
 * result, compiled as a regular expression, matches `pattern` LITERALLY —
 * the repair for a filter pasted from a test title.
 *
 * @invariant `new RegExp(escapeCaseFilterPattern(p)).test(p) === true` for
 *   every string `p`. This is the property a consumer relies on, and it is
 *   what makes the escaped form safe to hand an operator as a ready-to-run
 *   replacement (pinned per-metacharacter in this module's tests).
 *
 * Implemented as a per-character scan rather than a `String.replace` with a
 * character-class regex: escaping the escape character correctly is the one
 * place a regex-based escaper classically gets wrong, and a scan makes the
 * `\` → `\\` case ordinary instead of special.
 *
 * @param pattern - the literal text to match (typically a test-case title)
 * @returns the escaped pattern; a metacharacter-free `pattern` is returned
 *   CHARACTER-IDENTICAL (never gratuitously quoted or wrapped)
 * @example
 * escapeCaseFilterPattern("AC-2.H1 (GREEN)") // => "AC-2\\.H1 \\(GREEN\\)"
 * @example
 * escapeCaseFilterPattern("AC-1 happy path") // => "AC-1 happy path"
 */
export function escapeCaseFilterPattern(pattern: string): string {
  let escaped = "";
  for (const character of pattern) {
    if (REGEX_METACHARACTERS.includes(character)) escaped += "\\";
    escaped += character;
  }
  return escaped;
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

// ─── Unfiltered-File-Run Detection (task-every-ac-oracle-is-t-scoped) ───────
//
// A `-t`-scoped oracle attests exactly the ONE assertion it binds to — it
// never proves the test FILE, taken as a whole, passes together (two tests
// sharing mutable fixture state, or depending on execution order, can each
// pass individually under `-t` and fail when the file runs unfiltered). This
// section supplies the pure predicates `TaskWorkflowService.done`'s third
// evidence floor uses to require one attested UNFILTERED `result:pass` run
// per declared test-file anchor, alongside the `-t`-scoped AC rows.

/**
 * Recognises whether a normalized `file_anchors` entry (SPEC-042 D3 —
 * `file-anchors.ts::normalizeFileAnchors`'s output shape: repo-relative, no
 * leading `./`, a trailing `/` iff it is a DIRECTORY scope) names a SPECIFIC
 * test file.
 *
 * A directory-scoped anchor is deliberately EXCLUDED — it never names a
 * single file this module could demand one specific unfiltered command for;
 * a task declaring only directory-scoped anchors has nothing this floor can
 * check (the same "nothing declared → nothing to attest" shape
 * {@link judgeCompleteness}'s `declaredPaths === 0` short-circuit already
 * uses). Reuses {@link TEST_FILE_PATH_PATTERN} — the identical suffix
 * convention {@link countExplicitPathArgs} recognises — so "what counts as a
 * test file" is defined in exactly one place in this module.
 *
 * @param anchor - An already-normalized `file_anchors` entry.
 * @returns `true` iff `anchor` is NOT directory-scoped and its final two
 *   dot-segments match the `.test.<ext>`/`.spec.<ext>` convention.
 *
 * @example
 * isTestFileAnchor("packages/core/tests/attestation-completeness.test.ts") // => true
 *
 * @example
 * isTestFileAnchor("packages/core/tests/") // => false — directory scope, names no specific file
 *
 * @example
 * isTestFileAnchor("packages/core/src/attestation-completeness.ts") // => false — not a test file
 */
export function isTestFileAnchor(anchor: string): boolean {
  if (anchor.endsWith("/")) return false;
  return TEST_FILE_PATH_PATTERN.test(anchor);
}

/**
 * Case-name-filter flag spellings {@link commandRunsFileUnfiltered}
 * recognises — a STRICT SUPERSET of {@link commandHasCaseFilter}'s set,
 * deliberately kept as an INDEPENDENT set rather than widening that
 * function: `commandHasCaseFilter` already has a production consumer
 * (`adapters/cli/evidence-precheck.ts`, pinned by AC-061-14's single-
 * definition-site scan) and widening its detected set is out of this task's
 * scope/blast-radius. Empirically verified against the two runners this repo
 * actually uses (`bunx vitest run --help`, `bun test --help`) before being
 * hardcoded — evidence-driven, not guessed:
 *   - `-t` / `--testNamePattern` — vitest's own spelling (camelCase); also
 *     accepted by bun test's short `-t`.
 *   - `--test-name-pattern` — bun test's own spelling (kebab-case);
 *     vitest's cac-based parser ALSO accepts this kebab alias (confirmed:
 *     `vitest run <file> --test-name-pattern=<pattern>` narrows the run
 *     identically to `--testNamePattern=<pattern>`).
 *   - any of the three joined to its value with `=` (`-t=foo`,
 *     `--testNamePattern=foo`, `--test-name-pattern=foo` — all three
 *     confirmed to actually narrow: `vitest run <file> -t=alpha` and
 *     `bun test <file> -t=alpha` each report a skipped/filtered-out test,
 *     not a full run of the file).
 *
 * Deliberately NOT handled: vitest's bare POSITIONAL filename filter
 * (`vitest run <substring>`, no flag at all) is not a case-name filter at
 * all — it narrows which FILES load, never which tests within an
 * already-loaded file execute — so it has no entry in this set.
 * {@link commandRunsFileUnfiltered} defends against it a DIFFERENT way: it
 * requires an EXACT token match against the target anchor's full
 * repo-relative path, never a substring/prefix test, so a command carrying
 * only a vague positional filter (that happens to also match the target
 * file, and possibly others) never counts as "ran THIS file" — it fails
 * CLOSED unless the literal declared path is present as its own token.
 */
const UNFILTERED_RUN_CASE_FILTER_TOKENS = new Set(["-t", "--testNamePattern", "--test-name-pattern"]);
const UNFILTERED_RUN_CASE_FILTER_EQUALS_PREFIXES = ["-t=", "--testNamePattern=", "--test-name-pattern="];

/**
 * Human-facing spelling of the (broader) flag set
 * {@link commandRunsFileUnfiltered} recognises, for embedding in an
 * operator-facing refusal message — colocated with the set itself for the
 * same anti-drift reason as {@link CASE_FILTER_FLAGS_DESCRIPTION} (a
 * consumer imports this rather than retyping the flag spellings).
 */
export const UNFILTERED_RUN_CASE_FILTER_DESCRIPTION =
  "-t / --testNamePattern / --test-name-pattern (or any of the three joined to a value with '=')";

function commandHasAnyCaseFilter(command: string): boolean {
  const tokens = tokenizeCommand(command);
  return tokens.some(
    (token) =>
      UNFILTERED_RUN_CASE_FILTER_TOKENS.has(token) ||
      UNFILTERED_RUN_CASE_FILTER_EQUALS_PREFIXES.some((prefix) => token.startsWith(prefix)),
  );
}

/** Matches ONE leading `cd <dir> && ` segment — see {@link stripCdPrefix}. */
const CD_PREFIX_PATTERN = /^\s*cd\s+(\S+)\s*&&\s*/;

/**
 * Strips zero or more leading `cd <dir> && ` segments off `command`,
 * returning the accumulated repo-relative directory offset and the
 * remaining command string (the actual invocation to tokenize).
 *
 * Handles ONLY this exact, observed shape — the real bound-command example
 * this task's dispatch measured is `cd packages/lore && bun test
 * tests/integration/verify-executor.bun.test.ts`. Nothing fancier is
 * attempted: no `;`-joined `cd`, no subshells, no `cd -`, no glob expansion.
 * An unrecognised prefix shape is simply left unstripped (`offset` stays
 * `""`), which means {@link commandRunsFileUnfiltered}'s token comparison
 * falls through to a repo-root-relative match and correctly fails to find
 * the anchor — the FAIL-CLOSED direction this module's header promises: a
 * legitimately cd-offset command this parser doesn't recognise never
 * produces a FALSE MATCH, it just isn't recognised as attesting (forcing a
 * clearer evidence command rather than risking a silent false positive).
 *
 * @example
 * stripCdPrefix("cd packages/lore && bun test tests/a.bun.test.ts")
 * // => { offset: "packages/lore", rest: "bun test tests/a.bun.test.ts" }
 *
 * @example
 * stripCdPrefix("bunx vitest run packages/core/tests/a.test.ts")
 * // => { offset: "", rest: "bunx vitest run packages/core/tests/a.test.ts" }
 */
function stripCdPrefix(command: string): { offset: string; rest: string } {
  let offset = "";
  let rest = command;
  let match = CD_PREFIX_PATTERN.exec(rest);
  while (match !== null) {
    const dir = match[1] ?? "";
    offset = offset.length > 0 ? `${offset}/${dir}` : dir;
    rest = rest.slice(match[0].length);
    match = CD_PREFIX_PATTERN.exec(rest);
  }
  return { offset, rest };
}

/**
 * Collapses `./`/empty/repeated-slash segments for path COMPARISON only —
 * never used to validate or normalize a STORED anchor (that remains
 * `normalizeFileAnchors`'s exclusive job); this is a read-only equality
 * helper for {@link commandRunsFileUnfiltered}.
 */
function normalizeForComparison(rawPath: string): string {
  return rawPath
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".")
    .join("/");
}

/**
 * True iff `command` runs `filePath` (an already-normalized test-file
 * anchor — see {@link isTestFileAnchor}) WITHOUT any recognised case-name
 * filter (task-every-ac-oracle-is-t-scoped-so-the-file-passes-is-attested).
 *
 * "Runs `filePath`" means: after stripping a leading `cd <dir> &&` chain
 * ({@link stripCdPrefix}) and tokenizing what remains, at least one non-flag
 * token, joined to the accumulated `cd` offset, is EXACTLY `filePath` (after
 * collapsing `./`/redundant slashes on both sides for comparison — see
 * {@link normalizeForComparison}). Exact token identity — never a
 * substring/prefix test — is what makes this predicate immune to vitest's
 * bare positional filename filter without special-casing it (see
 * {@link UNFILTERED_RUN_CASE_FILTER_TOKENS}'s own doc).
 *
 * @param command - The full evidence `command` string.
 * @param filePath - The target test-file anchor (repo-relative, already
 *   normalized — see {@link isTestFileAnchor}).
 * @returns `true` iff `command` is a genuine unfiltered run of `filePath`.
 *
 * @example
 * commandRunsFileUnfiltered(
 *   "bunx vitest run packages/core/tests/attestation-completeness.test.ts",
 *   "packages/core/tests/attestation-completeness.test.ts",
 * ); // => true
 *
 * @example
 * commandRunsFileUnfiltered(
 *   "cd packages/lore && bun test tests/integration/verify-executor.bun.test.ts",
 *   "packages/lore/tests/integration/verify-executor.bun.test.ts",
 * ); // => true — the `cd` offset is folded into the comparison
 *
 * @example
 * commandRunsFileUnfiltered(
 *   "bunx vitest run packages/core/tests/attestation-completeness.test.ts -t 'one case'",
 *   "packages/core/tests/attestation-completeness.test.ts",
 * ); // => false — a case filter is present, even though the file path is named
 *
 * @example
 * commandRunsFileUnfiltered("bun run test:changed main", "packages/core/tests/attestation-completeness.test.ts");
 * // => false — no token names the file at all; a selective/derived-set
 * // command never counts, however plausible it is that the file ran
 */
export function commandRunsFileUnfiltered(command: string, filePath: string): boolean {
  if (commandHasAnyCaseFilter(command)) return false;

  const { offset, rest } = stripCdPrefix(command);
  const target = normalizeForComparison(filePath);
  const tokens = tokenizeCommand(rest);

  for (const token of tokens) {
    if (token.length === 0 || token.startsWith("-")) continue;
    const joined = offset.length > 0 ? `${offset}/${token}` : token;
    if (normalizeForComparison(joined) === target) return true;
  }
  return false;
}

// ─── Discovery-Refusal Detection (SPEC-OX M6.1) ─────────────────────────────
//
// A runner that finds ZERO matching test files exits 1 — the SAME exit code
// as a genuine assertion failure — but this repo's three runners each print
// a distinct, stable phrase that appears ONLY on a discovery refusal and
// NEVER alongside a real run summary (`parseExecutedUnits`'s two patterns).
// This is the missing primitive spec-oracle-executability-a-runner-s-
// discovery-refusal-is-not-a §M6.1 names: without it, dropping the
// `executedSuccessfully` gate on the exit != 0 branch (the "obvious fix") is
// a no-op, because `parseExecutedUnits` returns `null` for all three phrases
// and `judgeCompleteness` already fails open to `unknown_runner` on `null` —
// this module needs a DIFFERENT signal than "no summary line", namely "the
// runner said, in its own words, that it found nothing".

/**
 * One recognised runner's exact discovery-refusal wording, captured VERBATIM
 * from a live spawn against a nonexistent path (2026-08-10) — never
 * paraphrased, so a consumer's message can quote the runner rather than
 * describe it secondhand.
 */
const VITEST_DISCOVERY_REFUSAL_PATTERN = /No test files found, exiting with code 1/;
const BUN_DISCOVERY_REFUSAL_PATTERN = /The following filters did not match any test files/;
const PLAYWRIGHT_DISCOVERY_REFUSAL_PATTERN = /Error: No tests found\./;

/**
 * The verdict {@link findDiscoveryRefusal} returns for a recognised
 * discovery-refusal phrase.
 */
export type DiscoveryRefusal = {
  /** Which of the three runners this repo uses produced the refusal. */
  readonly runner: "vitest" | "bun" | "playwright";
  /**
   * The verbatim matched substring that proved it — quotes the runner,
   * never paraphrases (see {@link findDiscoveryRefusal}'s JSDoc for why this
   * matters to a consumer's operator-facing message).
   */
  readonly evidence: string;
};

/**
 * Recognises whether `outputTail` carries one of the three known runners'
 * discovery-refusal phrases — the wording a runner prints when its path
 * filter(s) matched ZERO test files, as opposed to a genuine run (of any
 * outcome) that always carries a `parseExecutedUnits`-shaped summary line.
 *
 * Detection is by RUNNER TEXT, never by exit code: every runner this repo
 * uses returns the SAME exit code (1) for "found nothing" as for "ran and at
 * least one assertion failed" — only the runner's own words separate the two.
 * A tail carrying a genuine failure summary (e.g. vitest's `"Test Files 3
 * failed | 4 passed (7)"`) never matches any of the three patterns below,
 * because a runner that actually loaded and executed a file never ALSO
 * prints "found nothing" — the two phrasings are mutually exclusive by
 * construction of each runner's own CLI, independently confirmed against a
 * live spawn of all three (see
 * `packages/lore/tests/e2e/discovery-refusal-live-capture.bun.test.ts`,
 * AC-OX-5 — the sibling oracle that re-captures these phrases by SPAWNING
 * each runner rather than trusting this hand-copied set of patterns to
 * never drift from what the runner actually prints).
 *
 * @param outputTail - Captured process output (stdout+stderr concatenated),
 *   the same shape {@link parseExecutedUnits} consumes.
 * @returns The matching {@link DiscoveryRefusal}, or `null` when `outputTail`
 *   carries none of the three known phrases (including every genuine run
 *   outcome, and arbitrary/garbled/empty input — never throws).
 *
 * @example
 * findDiscoveryRefusal("No test files found, exiting with code 1\n")
 * // => { runner: "vitest", evidence: "No test files found, exiting with code 1" }
 *
 * @example
 * findDiscoveryRefusal(
 *   'The following filters did not match any test files in --cwd="/repo":\n' +
 *     " tests/x.test.ts\n861 files were searched [7.00ms]\n",
 * )
 * // => { runner: "bun", evidence: "The following filters did not match any test files" }
 *
 * @example
 * findDiscoveryRefusal("Error: No tests found.\n")
 * // => { runner: "playwright", evidence: "Error: No tests found." }
 *
 * @example
 * findDiscoveryRefusal("Test Files  3 failed | 4 passed (7)\n") // => null — a genuine run, however it exits, never carries this phrasing
 */
export function findDiscoveryRefusal(outputTail: string): DiscoveryRefusal | null {
  const vitestMatch = VITEST_DISCOVERY_REFUSAL_PATTERN.exec(outputTail);
  if (vitestMatch !== null) {
    return { runner: "vitest", evidence: vitestMatch[0] };
  }

  const bunMatch = BUN_DISCOVERY_REFUSAL_PATTERN.exec(outputTail);
  if (bunMatch !== null) {
    return { runner: "bun", evidence: bunMatch[0] };
  }

  const playwrightMatch = PLAYWRIGHT_DISCOVERY_REFUSAL_PATTERN.exec(outputTail);
  if (playwrightMatch !== null) {
    return { runner: "playwright", evidence: playwrightMatch[0] };
  }

  return null;
}
