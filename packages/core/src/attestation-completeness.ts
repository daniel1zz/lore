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
 *     were actually executed; `null` when no known summary line is present.
 *   - judgeCompleteness({declaredPaths, executedUnits}) — pure decision
 *     combining the two counts into a {@link CompletenessVerdict}.
 *
 * Invariants:
 *   - Referentially transparent: same input in → same output, always.
 *   - `countExplicitPathArgs` returns `0` for a command that declares no path
 *     arguments at all (e.g. `bun run test`) — a command that names nothing
 *     cannot be "under-matched" or "zero-matched" against its own declaration
 *     (see {@link judgeCompleteness}'s `declaredPaths === 0` short-circuit).
 *   - `parseExecutedUnits` never throws on arbitrary/garbled stdout — an
 *     unrecognised tail degrades to `null`, not an exception.
 *
 * Side-effect class: pure
 *
 * Source: SPEC-061 — Attestation completeness guard (detect zero-match /
 *   under-match test oracles), §Scope D1, §Acceptance Criteria AC-061-1..3
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

// ─── Executed-Unit Parsing ───────────────────────────────────────────────────

/**
 * How many test files (and, when parseable, tests) a runner reports having
 * actually executed, extracted from its stdout summary line.
 *
 * @invariant `tests` is present-iff-parseable from the SAME summary line
 *   `files` came from (this repo's vitest summary line carries no test
 *   count, only a file count — `tests` is therefore always absent for a
 *   vitest-shaped match; bun's summary line carries both).
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
 * Recognises the run-summary tail of the two runners this repo uses (bun
 * test, then vitest) and extracts the count of files actually executed.
 * Never throws — arbitrary or garbled stdout that matches neither pattern
 * degrades to `null`.
 *
 * @param stdout - Captured process output (stdout+stderr concatenated,
 *   typically the tail-truncated `output_tail` a verify run recorded — the
 *   summary line is emitted near the end of both runners' output, so a tail
 *   truncation essentially never loses it)
 * @returns `{files}` (bun additionally carries `tests`) when a known summary
 *   is found; `null` when no known runner-summary line is present
 *
 * @example
 * parseExecutedUnits("...\nTest Files  1 passed (1)\nTests  4 passed (4)\n")
 * // => { files: 1 }
 *
 * @example
 * parseExecutedUnits("...\nRan 963 tests across 70 files. [1.2s]\n")
 * // => { files: 70, tests: 963 }
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
 *      because this guard doesn't understand its output format).
 *   2. `declaredPaths === 0` → `"complete"` (nothing was declared, so nothing
 *      can be under- or zero-matched — the BOUNDARY case, e.g. `bun run test`
 *      with no path arguments at all).
 *   3. `executedUnits.files === 0` → `"zero_match"` (≥1 path was declared,
 *      and NONE of them matched anything the runner actually ran — the
 *      AC-060-7 shape).
 *   4. `executedUnits.files < declaredPaths` → `"under_match"` (some, but not
 *      all, declared paths were matched).
 *   5. Otherwise (`executedUnits.files >= declaredPaths`) → `"complete"`.
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
 */
export function judgeCompleteness(input: CompletenessJudgeInput): CompletenessVerdict {
  const { declaredPaths, executedUnits } = input;

  if (executedUnits === null) {
    return "unknown_runner";
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
