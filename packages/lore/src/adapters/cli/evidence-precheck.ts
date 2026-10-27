/**
 * Pure command-string analysis for the `lore evidence` self-reported-pass
 * oracle-file precheck (defect: task-lore-evidence-self-reported-pass-lacks-
 * oracle-file, AC-080-3 incident — a self-reported `--oracle test --result
 * pass` recorded cleanly even though the referenced test file did not exist
 * on disk; only `lore verify`'s SPEC-061 zero-match guard caught it, two
 * verify rounds later).
 *
 * Public surface:
 *   - extractTestFileTokens(command) / extractCdPrefixTarget(command) /
 *     describeDerivedCdTarget(command) / findMissingOracleFiles(command, opts)
 *     / describePrecheckRoots(command, opts) / FileExistsPort — the
 *     first guard's own file-existence primitives. As of
 *     task-promote-the-oracle-file-existence-primitives-into-lore these are
 *     no longer DEFINED here — they are PROMOTED to `@lore/core`'s
 *     `oracle-file-existence.ts` (mirroring `attestation-completeness.ts`'s
 *     precedent) and merely RE-EXPORTED from this module so every existing
 *     import site (`commands/evidence.ts`, `../mcp/tools.ts`, this module's
 *     own test file) keeps compiling and behaving byte-identically. See that
 *     module's own header for their docs; grep `from "@lore/core"` below for
 *     the exact re-export list.
 *   - findMissingOracleFilesForEvidence(input) — additionally composes the
 *     "test"/"e2e" + "pass" oracle/result gate on top of the (now-promoted)
 *     findMissingOracleFiles, so both the CLI (`commands/evidence.ts`) and MCP
 *     (`../mcp/tools.ts`'s `lore_evidence_add`) adapters share ONE decision of
 *     which calls are even in scope for this precheck (task-mcp-lore-
 *     evidence-add-bypasses-the-oracle-file-existence). This composition —
 *     the scope gate glued to the promoted primitive — is what stays LOCAL to
 *     this module; the primitive itself travels.
 *   - findFilteredPassProofGap(input) / findFilteredPassRefusal(input) —
 *     the SECOND self-report guard hosted here (SPEC-061 AC-061-11..14, 17): a
 *     `--result pass` whose `--command` carries a `-t` case filter must arrive
 *     with the runner's own summary line as matched-count proof
 *   - findLiteralFilterMismatches(command) — the SECOND guard's cause analysis
 *     (task-a-t-filter-is-a-regex-so-this-repo-s-own-ac-titles): a `-t` value
 *     is a REGULAR EXPRESSION, so a title pasted from this repo's own AC
 *     convention (`AC-2.H1 (GREEN)`, `all + caller_cwd`) compiles into a
 *     pattern that cannot match the title it came from — zero cases selected,
 *     exit 0, indistinguishable from a pass. Reported per offending filter
 *     with the metacharacters found and the ESCAPED replacement value, and
 *     folded into `findFilteredPassRefusal`'s message + `field` so a
 *     filter-caused zero-match is machine-distinguishable from a test that
 *     genuinely does not exist
 *   - findUnderMatchedPassRefusal(input) — the THIRD self-report guard hosted
 *     here (defect: task-vitest-run-silently-drops-a-bun-test-ts-named-
 *     alongside-a; re-derived by task-skill-implement-tg-32-evidence-precheck-
 *     follows-the-one): a `--result pass` whose runner summary shows FEWER test
 *     files executed than `--command` named — a runner given several files
 *     silently drops the ones it cannot load and exits 0. Decided from the
 *     runner's OWN output (`@lore/core` countExplicitPathArgs / parseExecutedUnits
 *     / judgeCompleteness, shared with `lore verify`), never from a filename
 *     suffix: the earlier `.bun.test.ts`-means-`bun test` rule refused the
 *     one-runner command this repo records since 90c2b081 and shipped a
 *     repo-private naming rule to consumers
 *   - findCaptureFlagConflict(input) — the FOURTH self-report guard hosted here
 *     (task-a-non-empty-output-tail-can-be-hand-authored-prose-and-the): a CLI
 *     usage-shape check over `--capture`'s two structural conflicts — combined
 *     with an explicit `--output-tail`/`--output-tail-file` (redundant: capture
 *     IS the tail), or combined with `--oracle manual` (nothing capturable —
 *     there is no command to spawn for a browser/visual check)
 *   - commandHasUnsafePipe(command) / findPipeRefusal(input) — the FIFTH
 *     self-report guard hosted here (task-refuse-a-self-reported-evidence-
 *     command-containing-a-shell, SPEC oracle-tier-falsifiability M2): a
 *     self-reported `--result pass` whose `--command` contains an unquoted,
 *     non-`||` shell pipe is refused, because `$?` observed after a pipe
 *     belongs to the LAST stage of the pipeline, never the oracle the call
 *     means to assert about — a THIRD recurrence of this exact trap in this
 *     repo (handoff-71 KD2 twice, then `bun run test:changed <base> 2>&1 |
 *     tail -100`, which would have recorded a pass sourced from `tail`'s exit
 *     code). `input.capture` is the load-bearing escape (see that function's
 *     own Opt-in note) — `--capture` measures the real exit code itself, so
 *     the pipe hazard does not apply there (an explicit non-goal of the
 *     governing spec). LIVE at both call sites since
 *     task-wire-findpiperefusal-into-the-live-lore-evidence-and-mcp — grep
 *     `findPipeRefusal` in `commands/evidence.ts` and `../mcp/tools.ts`.
 *   - findCapturedFailDiscoveryRefusal(input) — the SIXTH guard hosted here,
 *     and the FIRST that examines the FAIL direction instead of the PASS
 *     direction the other five share (task-wire-the-discovery-refusal-guard-
 *     into-the-evidence-capture, spec-oracle-executability-a-runner-s-
 *     discovery-refusal-is-not-a §M6.2's evidence-path sibling, AC-OX-12): a
 *     `--capture`d run whose observed output is one of `@lore/core`'s
 *     `findDiscoveryRefusal` three ZERO-EXECUTION phrases (vitest/bun test/
 *     playwright reporting "found no matching test file") is refused rather
 *     than recorded as a `fail`/`expected-fail` — the exact defect §M6.2
 *     already fixed for `lore verify`'s attested path, now closed for this
 *     SECOND write path that mints a red. Consumes `findDiscoveryRefusal`
 *     VERBATIM, never re-typing its three phrases.
 *
 * All SIX guards are ADJACENT but INDEPENDENT: the first asks "does the
 * file this command names exist at all", the second asks "did the filter this
 * command carries match anything — and, when it did not, is the filter itself
 * lexically incapable of matching the title it was pasted from", the third asks "would this command's OWN
 * invoked runner actually run every file it names", the fourth asks "does
 * --capture even make sense for this invocation's other flags", the fifth
 * asks "does this command's own `$?` even belong to the oracle being
 * asserted about, or did a pipe hand it off to something else", the sixth
 * asks "did a --capture'd run that exited nonzero actually EXECUTE anything,
 * or did its runner merely report finding nothing to run". The first FIVE
 * share the oracle/result scope gate (`isSelfReportedPassInScope`) — except
 * the fourth, which is a pure CLI-usage shape check independent of `result`
 * entirely (a malformed `--capture` combination is nonsensical regardless of
 * what `--result` claims) — while the SIXTH has its OWN, deliberately
 * SEPARATE scope gate (fail-family `result`, `capture === true`, `oracle ===
 * "test"`): widening `isSelfReportedPassInScope` to also cover the fail
 * direction would be meaningless for a fail (its entire premise, "a claimed
 * pass's `$?` may be lying", does not apply), the same reasoning D2 in this
 * guard's own governing spec already applies to the first five.
 *
 * ⛔ CORRECTED (task-promote-the-oracle-file-existence-primitives-into-lore):
 * the "share only the scope gate" sentence above describes what the FIVE
 * GUARDS share with EACH OTHER — it must NOT be read to imply the first
 * guard's own file-existence primitives are exclusive to this module. They
 * are not, anymore: `extractTestFileTokens`/`extractCdPrefixTarget`/
 * `findMissingOracleFiles`/`FileExistsPort` now live in `@lore/core`'s
 * `oracle-file-existence.ts` and are reused by a THIRD, non-evidence,
 * non-self-report consumer — `AcService.addCriterion`/`setCriterion`'s
 * declaration-time path-existence check (spec-oracle-executability-a-runner-
 * s-discovery-refusal-is-not-a §M6.3/D8) — which gates them behind its OWN
 * independent decision (script-mode + declaration-time + the
 * `--allow-missing-path` escape), deliberately NOT `isSelfReportedPassInScope`
 * (widening that shared gate to also cover AC declaration would silently arm
 * guards 2/3/5 for a direction none of them reason about — see this task's
 * own non-negotiable design constraint). This module still defines and owns
 * ONLY the scope-gated composition (`findMissingOracleFilesForEvidence`) and
 * the refusal-message renderers (`describePrecheckRoots`/
 * `describeDerivedCdTarget`) — the underlying primitives are promoted,
 * shared infrastructure now, not private to evidence-precheck.ts.
 *
 * Design: token EXTRACTION and existence-port CHECKING both live in
 * `@lore/core`'s `oracle-file-existence.ts` (promoted from here) so the
 * whole precheck — AND `AcService`'s independent declaration-time check — is
 * unit-testable with a fake `fileExists` — no real filesystem needed (mirrors
 * `service/drift-check-service.ts`'s injected `FsProbe` port /
 * `adapters/real-fs-probe.ts`'s real implementation split). Resolving the
 * ACTUAL filesystem (which path is cwd, which is corpus root) is deliberately
 * left to each CALLER (`commands/evidence.ts` for this module's own guard 1;
 * the eventual `lore ac add`/`ac set` CLI wiring for `AcService`'s check) —
 * that layer is the one that knows `process.cwd()` and the discovered
 * `.lore/` root; neither this module nor the promoted primitive module ever
 * imports `existsSync` itself.
 *
 * Side-effect class: pure (no IO, no fs, no process access) — vitest-safe.
 *
 * Source: task-lore-evidence-self-reported-pass-lacks-oracle-file;
 *   task-lore-evidence-must-refuse-a-t-filtered-pass-with-no (SPEC-061,
 *   adr-lore-evidence-proves-a-filtered-pass-with-the-runner-s-own);
 *   task-lore-evidence-s-oracle-file-precheck-resolves-against-the
 *   (MCP `caller_cwd` escape hatch + roots-named refusal message);
 *   task-vitest-run-silently-drops-a-bun-test-ts-named-alongside-a (the
 *   dropped-file guard, re-derived from runner output by
 *   task-skill-implement-tg-32-evidence-precheck-follows-the-one);
 *   task-a-t-filter-is-a-regex-so-this-repo-s-own-ac-titles (the literal-vs-
 *   regex filter diagnosis folded into the filtered-pass guard);
 *   task-refuse-a-self-reported-evidence-command-containing-a-shell (SPEC
 *   oracle-tier-falsifiability-a-criterion-never-observed-red M2, ADR
 *   falsifiability-moves-from-the-task-tier-to-the-oracle-tier — the pipe-
 *   refusal guard, `commandHasUnsafePipe`/`findPipeRefusal`);
 *   task-promote-the-oracle-file-existence-primitives-into-lore (promotes
 *   guard 1's own primitives to `@lore/core`, spec-oracle-executability-a-
 *   runner-s-discovery-refusal-is-not-a §M6.3/D8);
 *   task-wire-the-discovery-refusal-guard-into-the-evidence-capture (the
 *   sixth, fail-direction guard, `findCapturedFailDiscoveryRefusal`,
 *   spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a §M6.2's
 *   evidence-path sibling, AC-OX-12)
 */

import {
  CASE_FILTER_FLAGS_DESCRIPTION,
  REGEX_METACHARACTERS_DESCRIPTION,
  RUNNER_SUMMARY_FORMATS_DESCRIPTION,
  commandHasCaseFilter,
  commandHasUnsafePipe,
  countExplicitPathArgs,
  escapeCaseFilterPattern,
  extractCaseFilterPatterns,
  findRegexMetacharacters,
  judgeCompleteness,
  parseExecutedUnits,
  parseFailedCaseCount,
  // reason: task-wire-the-discovery-refusal-guard-into-the-evidence-capture
  // (spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a §M6.2's
  // evidence-path sibling, AC-OX-12) — the SIXTH guard hosted here,
  // findCapturedFailDiscoveryRefusal (defined further down in this file),
  // consumes this primitive VERBATIM, never re-typing its three refusal
  // phrases (they live ONLY in @lore/core's attestation-completeness.ts).
  // NOTE: deliberately no curly-brace JSDoc link markup anywhere in THIS
  // import block, not even inside a plain comment — AC-061-14's own
  // regression test scans this exact block for its FIRST closing curly brace
  // to find the "from" clause, so any stray closing brace earlier in a
  // comment (measured the hard way while first authoring this note) makes
  // that scan find nothing at all.
  findDiscoveryRefusal,
  // reason: the following six symbols are RE-EXPORTED (not just used
  // internally) below — task-promote-the-oracle-file-existence-primitives-
  // into-lore promoted them out of this file into `@lore/core`'s
  // `oracle-file-existence.ts`. Every existing import site
  // (`commands/evidence.ts`, `../mcp/tools.ts`, this module's own test file)
  // still imports them from `evidence-precheck.js`, so the re-export keeps
  // every one of those call sites compiling and behaving unchanged.
  extractTestFileTokens,
  extractCdPrefixTarget,
  describeDerivedCdTarget,
  findMissingOracleFiles,
  describePrecheckRoots,
  CAPTURE_TAIL_CHARS,
  type FileExistsPort,
  type LoreError,
} from "@lore/core";

export {
  commandHasUnsafePipe,
  extractTestFileTokens,
  extractCdPrefixTarget,
  describeDerivedCdTarget,
  findMissingOracleFiles,
  describePrecheckRoots,
  type FileExistsPort,
};

/**
 * The oracle/result scope both self-report guards in this module share: only a
 * `test`/`e2e` oracle claiming `pass` is a self-reported assertion that can be
 * false-green. Every other oracle kind, and every `fail`/`expected-fail`
 * result, is out of scope for BOTH guards and passes through untouched.
 *
 * @param input.oracle - the oracle kind as received (untyped `string` — see
 *   {@link findMissingOracleFilesForEvidence}'s param docs for why)
 * @param input.result - the result as received
 * @returns `true` iff this call is a self-reported test/e2e pass
 */
function isSelfReportedPassInScope(input: { oracle: string; result: string }): boolean {
  if (input.oracle !== "test" && input.oracle !== "e2e") return false;
  return input.result === "pass";
}

/**
 * Composes the "does this evidence-add call even need the missing-oracle-file
 * precheck" gate (only a self-reported `test`/`e2e` oracle claiming `pass` is
 * in scope — see this module's header) with `findMissingOracleFiles` itself.
 *
 * Both CLI adapter callers of the precheck (`commands/evidence.ts`) AND MCP
 * adapter callers (`../mcp/tools.ts`'s `lore_evidence_add` handler — defect:
 * task-mcp-lore-evidence-add-bypasses-the-oracle-file-existence, an MCP call
 * used to bypass the precheck entirely because it never routed through this
 * CLI command) apply the SAME oracle/result gate before deciding whether to
 * block a call; this function is the single place that gate is expressed, so
 * neither adapter can drift on which oracle/result combinations it covers.
 *
 * @param input.oracle - the oracle kind as received from the caller (CLI
 *   `--oracle` / MCP `oracle` arg) — deliberately untyped `string` so this
 *   helper stays agnostic of either adapter's own (structurally identical but
 *   independently declared) enum type
 * @param input.result - the result as received (CLI `--result` / MCP `result`
 *   arg), same untyped-`string` reasoning
 * @param input.command - the exact command string, passed straight through to
 *   `findMissingOracleFiles`
 * @param input.cwd - absolute current working directory
 * @param input.additionalCwds - see `@lore/core`'s
 *   `oracle-file-existence.ts::findMissingOracleFiles`'s param docs — the
 *   MCP-surface `caller_cwd`-style escape hatch, omitted by every caller that
 *   doesn't need it (CLI; MCP callers that never pass it)
 * @param input.corpusRoot - absolute discovered corpus root; omitted or equal
 *   to `cwd` means only `cwd` is tried
 * @param input.fileExists - injected existence check (real caller:
 *   `fs.existsSync`)
 * @returns the subset of extracted tokens that resolve nowhere plausible;
 *   `[]` when the oracle/result combination is out of this precheck's scope
 *   (every other oracle kind, or `result !== "pass"`) OR every extracted
 *   token exists somewhere — the caller never blocks on an empty result
 * @example
 *   findMissingOracleFilesForEvidence({
 *     oracle: "tsc", result: "pass", command: "bun run typecheck",
 *     cwd: "/repo", fileExists: () => false,
 *   })
 *   // => [] — oracle "tsc" is out of scope, fileExists is never even called
 */
export function findMissingOracleFilesForEvidence(input: {
  oracle: string;
  result: string;
  command: string;
  cwd: string;
  additionalCwds?: string[];
  corpusRoot?: string;
  fileExists: FileExistsPort;
}): string[] {
  if (!isSelfReportedPassInScope(input)) return [];
  return findMissingOracleFiles(input.command, {
    cwd: input.cwd,
    // reason: exactOptionalPropertyTypes — conditionally spread rather than
    // pass the field verbatim, since the input's type is `T | undefined` (an
    // explicit `undefined` call-site value is legal here) while
    // findMissingOracleFiles's own optional fields reject an explicit
    // `undefined` under this tsconfig (mirrors the pre-existing `corpusRoot`
    // spread immediately below).
    ...(input.additionalCwds !== undefined ? { additionalCwds: input.additionalCwds } : {}),
    ...(input.corpusRoot !== undefined ? { corpusRoot: input.corpusRoot } : {}),
    fileExists: input.fileExists,
  });
}

// ─── Dropped-File Guard (task-vitest-run-silently-drops-a-bun-test-ts-named-alongside-a, ──
// ─── re-derived by task-skill-implement-tg-32-evidence-precheck-follows-the-one) ─────────

/**
 * How an operator repairs a run that executed fewer files than it named —
 * appended verbatim to the refusal so it always ends with the action.
 */
const DROPPED_FILE_REPAIR_HINT =
  "Find which named file the runner skipped (an exclude pattern in the runner's config, " +
  "a file the runner cannot load, a path it does not match), fix the command or the " +
  "config so every named file runs, and record the re-run with --capture; or record " +
  "each runner's files as its OWN separate lore evidence call.";

/**
 * The THIRD self-report guard hosted here — refuses a `--result pass` whose
 * runner summary shows FEWER test files executed than `--command` named (or
 * none). Defect (task-vitest-run-silently-drops-a-bun-test-ts-named-alongside-
 * a, measured 2026-08-01): a runner given several file arguments runs the
 * ones it can load, drops the rest, and exits 0 with no warning — its own
 * "no test files found" refusal is evaluated over the WHOLE invocation, so one
 * matching file silences it for every other named file.
 *
 * // reason: this reads the RUNNER'S OUTPUT, not a filename convention. The
 * // first version of this guard decided "which runner can run this file" from
 * // the `.bun.test.ts` suffix (the two-runner split of this repo's CLAUDE.md).
 * // Since 90c2b081 (adr-tg-1-test-runner-decision-measured-comparison-of-bun-
 * // only) that suffix runs under `bunx --bun vitest run`, so the rule refused
 * // a command that genuinely ran the file — and it shipped a repo-private
 * // naming rule to every consumer (task-gh-1343388703-46). Whether a file
 * // ran is a fact of the run; `countExplicitPathArgs` + `parseExecutedUnits` +
 * // `judgeCompleteness` (`@lore/core`, the trio `lore verify` already uses)
 * // read it from the summary, so the guard holds for any runner and any file
 * // naming scheme. Do not reintroduce a filename-suffix classification.
 *
 * Scope and fail-open posture (each documented, none silent):
 *   - needs an output tail — `--capture`'s real output, or a supplied tail. No
 *     tail means nothing to compare; the separate pass-tail requirement owns
 *     that gap, so this returns `null`.
 *   - an unrecognised runner summary yields `unknown_runner` and is left alone,
 *     exactly as `lore verify` treats it.
 *   - a case-filtered command is left to {@link findFilteredPassRefusal}: a
 *     `-t` filter legitimately skips files, so file counts prove nothing there.
 *
 * @param input - same shape {@link findFilteredPassRefusal} accepts
 * @returns a `VALIDATION_ERROR` (exit code 4 via `utils.ts::exitCode`) on field
 *   `output_tail` naming declared vs executed counts and the repair, or `null`
 *   when the write may proceed
 *
 * @example
 * findUnderMatchedPassRefusal({
 *   oracle: "test", result: "pass",
 *   command: "bunx vitest run a.test.ts b.test.ts",
 *   outputTail: "Test Files  1 passed (1)\n     Tests  4 passed (4)\n",
 * })
 * // => VALIDATION_ERROR naming 2 files declared, 1 executed
 *
 * @example
 * findUnderMatchedPassRefusal({
 *   oracle: "test", result: "pass",
 *   command: "bunx --bun vitest run a.bun.test.ts",
 *   outputTail: "Test Files  1 passed (1)\n     Tests  4 passed (4)\n",
 * })
 * // => null — the one named file ran
 */
export function findUnderMatchedPassRefusal(input: {
  oracle: string;
  result: string;
  command: string;
  outputTail?: string;
}): LoreError | null {
  if (!isSelfReportedPassInScope(input)) return null;
  if (input.outputTail === undefined || input.outputTail.trim().length === 0) return null;
  if (commandHasCaseFilter(input.command)) return null;

  const declaredPaths = countExplicitPathArgs(input.command);
  const executedUnits = parseExecutedUnits(input.outputTail);
  const verdict = judgeCompleteness({ declaredPaths, executedUnits });
  if (verdict !== "under_match" && verdict !== "zero_match") return null;

  // reason: judgeCompleteness returns these two verdicts only for a non-null
  // executedUnits, so the optional chain is a type narrowing, not a fallback.
  const executedFiles = executedUnits?.files ?? 0;

  return {
    code: "VALIDATION_ERROR",
    field: "output_tail",
    message:
      `Dropped-file --result pass (${verdict}): --command names ${declaredPaths} test file path(s) ` +
      `but the runner summary shows ${executedFiles} test file(s) executed. A runner given several ` +
      "files runs the ones it can load, silently drops the rest and still exits 0 (its own " +
      '"no test files found" refusal is evaluated over the WHOLE invocation, not per named ' +
      "argument), so this exit-0 does not prove every named file ran. " +
      DROPPED_FILE_REPAIR_HINT,
    value: input.command,
    rule: "BR-252",
  };
}

// ─── Literal-Title Case-Filter Diagnosis (task-a-t-filter-is-a-regex-so- ────
// ─── this-repo-s-own-ac-titles) ─────────────────────────────────────────────

/**
 * One case-filter value that provably cannot match the literal text it was
 * pasted from — the measured defect
 * (task-a-t-filter-is-a-regex-so-this-repo-s-own-ac-titles).
 *
 * @property pattern - the filter value exactly as it appears in `--command`
 * @property metacharacters - the regex metacharacters it contains
 * @property escaped - the same text escaped so it matches LITERALLY; the
 *   ready-to-run repair (`escapeCaseFilterPattern`'s round-trip invariant)
 * @property compiles - `false` when the pattern is not even a valid regular
 *   expression (an unbalanced `(` / `[`, a trailing `\`), so the runner cannot
 *   compile it at all; `true` when it compiles but selects the wrong thing
 */
export interface LiteralFilterMismatch {
  pattern: string;
  metacharacters: string[];
  escaped: string;
  compiles: boolean;
}

/**
 * Reports every case filter in `command` whose value, compiled as the REGULAR
 * EXPRESSION the runner will actually compile, cannot match its own literal
 * text — i.e. every filter that was pasted from a test title and silently
 * turned into something else.
 *
 * The predicate is `new RegExp(p).test(p)`, not "contains a metacharacter":
 *
 *   - `AC-2.H1 (GREEN)` → the parens become a group, so the regex needs
 *     `AC-2?H1 GREEN` WITHOUT parens; the literal title has them → MISMATCH
 *     (measured instance 1: 0 matched, exit 0, read as a pass).
 *   - `…all + caller_cwd` → `+` quantifies the preceding space, so the regex
 *     needs two spaces where the title has ` + ` → MISMATCH (instance 2).
 *   - `AC-1.H1` → the `.` matches the literal `.`; the filter still selects
 *     the intended case → NOT a mismatch, never reported. A
 *     "contains a metacharacter" check would have refused this, and `.`
 *     appears in essentially every AC id this repo writes.
 *   - `AC-1 {a}` → `{a}` is not a valid quantifier, so JS treats it as literal
 *     text and the filter still matches → NOT a mismatch.
 *
 * That exactness is what keeps DELIBERATE regex use possible: it is only
 * combined with a missing/zero matched-count proof by
 * {@link findFilteredPassRefusal}, never used to refuse on its own — see that
 * function's Proxy note.
 *
 * @param command - the exact command string recorded via `lore evidence --command`
 * @returns one entry per distinct offending filter value, in command order;
 *   `[]` when the command carries no case filter, carries only
 *   metacharacter-free filters, or carries filters that DO match their own
 *   literal text
 *
 * @example
 * findLiteralFilterMismatches("bunx vitest run a.test.ts -t 'AC-2.H1 (GREEN)'")
 * // => [{ pattern: "AC-2.H1 (GREEN)", metacharacters: [".", "(", ")"],
 * //       escaped: "AC-2\\.H1 \\(GREEN\\)", compiles: true }]
 *
 * @example
 * findLiteralFilterMismatches("bunx vitest run a.test.ts -t 'AC-1 happy path'")
 * // => [] — a pure literal, unaffected
 */
export function findLiteralFilterMismatches(command: string): LiteralFilterMismatch[] {
  const mismatches: LiteralFilterMismatch[] = [];
  for (const pattern of extractCaseFilterPatterns(command)) {
    const metacharacters = findRegexMetacharacters(pattern);
    if (metacharacters.length === 0) continue;

    // reason: a pattern the RegExp constructor rejects is NOT swallowed — it is
    // classified as `compiles: false` and reported, which is a STRONGER form of
    // the same finding (the runner cannot compile it either, so it can match
    // nothing at all). The subject of `.test` is the pattern itself: operator-
    // authored, and as short as a test title, so this cannot become an
    // untrusted-input backtracking surface.
    let compiles = true;
    let matchesOwnLiteral = false;
    try {
      matchesOwnLiteral = new RegExp(pattern).test(pattern);
    } catch {
      compiles = false;
    }
    if (compiles && matchesOwnLiteral) continue;

    mismatches.push({
      pattern,
      metacharacters,
      escaped: escapeCaseFilterPattern(pattern),
      compiles,
    });
  }
  return mismatches;
}

/**
 * Renders {@link findLiteralFilterMismatches}'s findings as the clause appended
 * to a filtered-pass refusal: what the filter really means, why no output tail
 * can ever rescue it, and the escaped value to re-run with.
 *
 * // reason: names the flags via the imported `CASE_FILTER_FLAGS_DESCRIPTION`
 * // instead of spelling one, so this message can never state a narrower flag
 * // set than the extractor actually reads (SPEC-061 AC-061-14's single-
 * // definition rule). Adapter-neutral in the same way
 * // `describeDerivedCdTarget` is — no CLI-only flag spelling beyond the
 * // shared descriptions.
 *
 * @param mismatches - a NON-EMPTY findings list
 * @returns the clause, ending in the action; `""` for an empty list so a caller
 *   can concatenate unconditionally
 */
function describeLiteralFilterMismatches(mismatches: readonly LiteralFilterMismatch[]): string {
  if (mismatches.length === 0) return "";
  const rendered = mismatches
    .map((mismatch) => {
      const cause = mismatch.compiles
        ? `contains regex metacharacter(s) ${mismatch.metacharacters.join(" ")} that make it unable to match its own literal text`
        : `contains regex metacharacter(s) ${mismatch.metacharacters.join(" ")} that do not even form a valid regular expression, so the runner cannot compile it at all`;
      return `"${mismatch.pattern}" ${cause} — escaped, literal-matching value: ${mismatch.escaped}`;
    })
    .join("; ");
  return (
    `ALSO — the cause is lexical, not a missing tail: a ${CASE_FILTER_FLAGS_DESCRIPTION} value is a ` +
    `REGULAR EXPRESSION, and this --command's filter ${rendered}. ` +
    "Pasting a test title verbatim therefore selects ZERO cases while the runner still exits 0, so " +
    "no output tail will ever show a match until the FILTER changes. Re-run with the escaped value " +
    "above (single-quote it in the shell so the backslashes survive), or drop the filter and run the " +
    `whole file unfiltered — never route around this with a manual oracle. Metacharacters checked: ${REGEX_METACHARACTERS_DESCRIPTION}.`
  );
}

// ─── Filtered-Pass Matched-Count Proof (SPEC-061 AC-061-11..14, 17) ─────────

/**
 * Why a self-reported filtered `pass` carries no usable matched-count proof.
 * Exhaustive — `null` from {@link findFilteredPassProofGap} means "no gap",
 * never "unclassified".
 *
 *   - `"missing_tail"` — no output tail was supplied at all.
 *   - `"unparseable_tail"` — a tail was supplied but carries no runner-summary
 *     line the shared `@lore/core` parser recognises.
 *   - `"no_matched_case_count"` — a runner summary WAS found, but it carries no
 *     matched-CASE count (e.g. a vitest tail truncated to its "Test Files" line
 *     only), so the one number that would prove the filter matched something is
 *     absent.
 *   - `"zero_match"` — the summary parsed, and it says the filter matched ZERO
 *     cases: the exit-0 this `pass` rests on proves nothing.
 */
export type FilteredPassProofGap =
  | "missing_tail"
  | "unparseable_tail"
  | "no_matched_case_count"
  | "zero_match";

/**
 * Classifies whether a self-reported evidence write is a case-filtered `pass`
 * lacking matched-count proof, and if so, why.
 *
 * Scope: only a `test`/`e2e` oracle claiming `pass`
 * ({@link isSelfReportedPassInScope}) whose command carries a case filter
 * (`commandHasCaseFilter`, imported — never re-derived here) is examined. An
 * UNFILTERED command is never gated: a whole-file run whose path filter matches
 * nothing exits 1 loudly, so the silent-green failure mode this guard exists for
 * does not arise (adr-lore-evidence-proves-a-filtered-pass-with-the-runner-s-own
 * §Consequences).
 *
 * // reason: fail-CLOSED — a missing or unreadable tail is a GAP, not a pass.
 * // This deliberately inverts `judgeCompleteness`'s fail-OPEN posture inside
 * // `lore verify` (`unknown_runner` never blocks there). The runner has
 * // independently observed the exit code and can afford to be generous about
 * // an unrecognised summary format; `lore evidence` has observed NOTHING —
 * // the tail is its only evidence, so an unreadable tail is no evidence
 * // (adr-lore-evidence-proves-a-filtered-pass-with-the-runner-s-own §Decision).
 * // Do not "harmonise" the two postures; the asymmetry is the decision.
 *
 * @param input.oracle - oracle kind as received from the caller (CLI
 *   `--oracle` / MCP `oracle`), untyped `string` for the same adapter-agnostic
 *   reason as {@link findMissingOracleFilesForEvidence}
 * @param input.result - result as received (CLI `--result` / MCP `result`)
 * @param input.command - the exact command string being recorded
 * @param input.outputTail - the resolved output tail (CLI `--output-tail` or
 *   the tail of `--output-tail-file`; MCP `output_tail`), absent when none was
 *   supplied
 * @returns the {@link FilteredPassProofGap}, or `null` when the call is out of
 *   scope OR the tail genuinely proves ≥1 matched case
 *
 * @example
 * findFilteredPassProofGap({
 *   oracle: "test", result: "pass",
 *   command: "bunx vitest run a.test.ts -t 'AC-1'",
 * })
 * // => "missing_tail"
 *
 * @example
 * findFilteredPassProofGap({
 *   oracle: "test", result: "pass",
 *   command: "bunx vitest run a.test.ts -t 'AC-1'",
 *   outputTail: "Test Files  1 skipped (1)\nTests  46 skipped (46)\n",
 * })
 * // => "zero_match" — every case was skipped; the filter matched none
 *
 * @example
 * findFilteredPassProofGap({
 *   oracle: "test", result: "pass",
 *   command: "bunx vitest run a.test.ts",
 * })
 * // => null — unfiltered, never gated
 */
export function findFilteredPassProofGap(input: {
  oracle: string;
  result: string;
  command: string;
  outputTail?: string;
}): FilteredPassProofGap | null {
  if (!isSelfReportedPassInScope(input)) return null;
  if (!commandHasCaseFilter(input.command)) return null;

  const tail = input.outputTail;
  if (tail === undefined || tail.trim().length === 0) return "missing_tail";

  const executedUnits = parseExecutedUnits(tail);
  if (executedUnits === null) return "unparseable_tail";
  if (executedUnits.tests === undefined) return "no_matched_case_count";
  if (executedUnits.tests === 0) return "zero_match";

  return null;
}

/**
 * How an operator repairs any of the four gaps — appended verbatim to every
 * refusal so the message always ends with the action, not just the diagnosis.
 */
const MATCHED_COUNT_REPAIR_HINT =
  "Re-run the command, capture the runner's summary lines, and pass them via " +
  "--output-tail (or --output-tail-file); or record the run " +
  "honestly with --result fail / expected-fail.";

/** Per-gap diagnosis, in the operator's words. */
const GAP_DIAGNOSIS: Readonly<Record<FilteredPassProofGap, string>> = {
  missing_tail:
    "no output tail was supplied at all, so nothing shows the filter matched a single case",
  unparseable_tail:
    `the supplied output tail carries no runner summary this classifier recognises (${RUNNER_SUMMARY_FORMATS_DESCRIPTION}), ` +
    "so the matched-case count cannot be read — fail-closed: an unreadable tail is no evidence",
  no_matched_case_count:
    "the supplied output tail has a runner summary but no matched-CASE count in it (the case-count line looks truncated away), " +
    "so the one number that would prove the filter matched something is absent",
  zero_match:
    "zero_match — the supplied output tail's runner summary reports 0 matched test cases, " +
    "so the exit-0 this pass rests on proves nothing (fix the filter or the test title, then re-run)",
};

/**
 * The single decision BOTH evidence-write surfaces call: the CLI
 * (`commands/evidence.ts`) and the MCP `lore_evidence_add` handler
 * (`../mcp/tools.ts`). Returns the refusal to render, or `null` to proceed.
 *
 * Returning the fully-formed {@link LoreError} — rather than a boolean the two
 * adapters would each phrase for themselves — is what makes SPEC-061 AC-061-17's
 * gate parity assertable by BEHAVIOUR: the two surfaces cannot drift on
 * scope, code, field, or wording, because there is only one of each.
 *
 * // reason: `field: "output_tail"` on every gap, including `zero_match`,
 * // where the command's filter is arguably at fault. The field names the
 * // input the caller must CHANGE to make the write legal, which is the tail
 * // in every case — a `zero_match` is repaired by re-running and supplying a
 * // tail that shows matches, never by deleting the tail. The ONE exception is
 * // a literal-vs-regex filter mismatch ({@link findLiteralFilterMismatches}):
 * // there the tail provably CANNOT be repaired — the regex cannot match the
 * // title under any run — so the field names `command`, making the two
 * // outcomes machine-distinguishable ("your filter is broken" vs "this test
 * // genuinely does not exist") rather than one undifferentiated refusal.
 *
 * Per adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the:
 *   - **Proxy** — the mismatch clause is combined with the gap by AND, never
 *     used to refuse on its own. Input satisfying the proxy while violating the
 *     property: a DELIBERATE regex (`AC-(1|2)`), which also cannot match its
 *     own literal text. Because a proven non-zero matched count returns `null`
 *     BEFORE the clause is ever computed, deliberate regex use stays fully
 *     available with no opt-out flag and nothing extra to record in the
 *     evidence row — the task's Opt-in requirement is satisfied by needing no
 *     opt-in at all. Named, accepted residual in the other direction: a
 *     metacharacter-corrupted pattern that matched some OTHER case (e.g. a
 *     title containing `a+b` matching a different test named `ab`) reports a
 *     non-zero count and is NOT refused, so the intended case still went
 *     unrun. Distinguishing it from deliberate regex needs author INTENT,
 *     which no lexical check has; refusing it would require exactly the
 *     recorded safety-check opt-out this design avoids.
 *   - **Silence** — none added: every mismatch is named verbatim in the
 *     refusal, with the metacharacters found and the escaped replacement, so a
 *     zero-match can no longer be diagnosed as "the test does not exist".
 *   - **Opt-in** — n/a: unconditional for every filtered pass already lacking
 *     matched-count proof.
 *
 * @param input - same shape as {@link findFilteredPassProofGap}
 * @returns a `VALIDATION_ERROR` (exit code 4 via `utils.ts::exitCode`) naming
 *   the missing proof, or `null` when the write may proceed
 *
 * @example
 * findFilteredPassRefusal({
 *   oracle: "test", result: "pass",
 *   command: "bunx vitest run a.test.ts -t 'AC-1'",
 *   outputTail: "Test Files  1 passed (1)\nTests  3 passed (3)\n",
 * })
 * // => null — three cases genuinely matched
 *
 * @example
 * findFilteredPassRefusal({
 *   oracle: "test", result: "pass",
 *   command: "bunx vitest run a.test.ts -t 'AC-2.H1 (GREEN)'",
 *   outputTail: "Test Files  1 skipped (1)\nTests  56 skipped (56)\n",
 * })
 * // => VALIDATION_ERROR on field "command", naming ". ( )" and the escaped
 * //    value "AC-2\\.H1 \\(GREEN\\)"
 */
export function findFilteredPassRefusal(input: {
  oracle: string;
  result: string;
  command: string;
  outputTail?: string;
}): LoreError | null {
  const gap = findFilteredPassProofGap(input);
  if (gap === null) return null;

  const mismatches = findLiteralFilterMismatches(input.command);
  const mismatchClause = describeLiteralFilterMismatches(mismatches);

  return {
    code: "VALIDATION_ERROR",
    field: mismatches.length > 0 ? "command" : "output_tail",
    message:
      `Filtered --result pass without matched-count proof: --command carries a ` +
      `case-name filter (${CASE_FILTER_FLAGS_DESCRIPTION}) and ${GAP_DIAGNOSIS[gap]}. ` +
      "A filter that matches nothing still exits 0 with every test reported skipped, " +
      `so this pass is unproven. ${MATCHED_COUNT_REPAIR_HINT}` +
      (mismatchClause.length > 0 ? ` ${mismatchClause}` : ""),
    value: input.command,
    rule: "BR-153",
  };
}

// ─── Capture-Flag Conflict Guard (task-a-non-empty-output-tail-can-be-hand- ─
// ─── authored-prose-and-the) ─────────────────────────────────────────────

/**
 * The FOURTH self-report guard hosted here — a pure CLI-usage-shape check over
 * `--capture` (`commands/evidence.ts`'s own child-process-spawn mechanism,
 * task-a-non-empty-output-tail-can-be-hand-authored-prose-and-the) combined
 * with either of its two structural conflicts:
 *
 *   - `--output-tail`/`--output-tail-file` ALSO supplied — redundant and
 *     ambiguous: `--capture` spawns `--command` itself and uses that real
 *     stdout+stderr AS the tail, so a second, caller-supplied tail can only
 *     ever be ignored (silently) or contradict the captured one. Refused
 *     loudly instead so the caller picks exactly one evidentiary source.
 *   - `--oracle manual` ALSO supplied — a manual/visual check has, by
 *     definition, no command whose exit code proves anything (task's own
 *     AC-4 BOUNDARY); there is nothing for `--capture` to spawn that would
 *     mean what a browser/visual check means. The legitimate path for a
 *     manual pass row is an explicit, non-empty, hand-typed description via
 *     `--output-tail`/`--output-tail-file` — the residual self-report path
 *     this task's design review deliberately keeps open, never deleted.
 *
 * Independent of `result` entirely (unlike every other guard in this module)
 * — a malformed `--capture` combination is nonsensical regardless of what
 * `--result` claims, so this runs BEFORE the oracle/result scope gate the
 * other three guards share.
 *
 * @param input.oracle - the oracle kind as received (untyped `string`, same
 *   adapter-agnostic reasoning as this module's other guards)
 * @param input.capture - whether `--capture` was passed
 * @param input.outputTail - `--output-tail` as received, `undefined` when omitted
 * @param input.outputTailFile - `--output-tail-file` as received, `undefined` when omitted
 * @returns a `VALIDATION_ERROR` (exit code 4 via `utils.ts::exitCode`) naming the
 *   conflicting flag combination, or `null` when the combination is legal
 * @example
 * findCaptureFlagConflict({ oracle: "test", capture: true, outputTail: "x" });
 * // => VALIDATION_ERROR naming the --output-tail conflict
 * @example
 * findCaptureFlagConflict({ oracle: "manual", capture: true });
 * // => VALIDATION_ERROR naming the --oracle manual conflict
 * @example
 * findCaptureFlagConflict({ oracle: "test", capture: true }); // => null — legal
 */
export function findCaptureFlagConflict(input: {
  oracle: string;
  capture: boolean;
  outputTail?: string;
  outputTailFile?: string;
}): LoreError | null {
  if (!input.capture) return null;

  if (input.outputTail !== undefined || input.outputTailFile !== undefined) {
    return {
      code: "VALIDATION_ERROR",
      field: "capture",
      message:
        "--capture is mutually exclusive with --output-tail/--output-tail-file — " +
        "--capture spawns --command itself and uses ITS OWN captured stdout+stderr " +
        "as the tail; supply exactly one evidentiary source, not both.",
      value: true,
      rule: "BR-152",
    };
  }

  if (input.oracle === "manual") {
    return {
      code: "VALIDATION_ERROR",
      field: "capture",
      message:
        "--capture cannot be used with --oracle manual — a manual/visual check has no " +
        "command whose exit code proves anything. Describe what was manually verified " +
        "via --output-tail/--output-tail-file instead (a non-empty description is " +
        "still required for a manual --result pass).",
      value: true,
      rule: "BR-152",
    };
  }

  return null;
}

// ─── Pipe-Refusal Guard (task-refuse-a-self-reported-evidence-command- ─────
// ─── containing-a-shell — SPEC oracle-tier-falsifiability M2) ──────────────
// The detector itself, `commandHasUnsafePipe`, lives in `@lore/core` (command-pipe.ts) — one definition,
// shared with the AC write chokepoint; re-exported below so existing importers keep their import line.

/**
 * How an operator repairs a self-reported command a shell pipe was refused
 * on — appended verbatim so the refusal always ends with the action.
 */
const PIPE_REPAIR_HINT =
  "Either re-run with --capture (lore spawns --command itself and cross-checks the REAL " +
  "observed exit code against --result — the pipe hazard does not apply there), or record " +
  "the piped-to command's own outcome honestly instead (run the oracle alone, or split the " +
  "pipeline into two separate lore evidence recordings, one per stage).";

/**
 * The FIFTH self-report guard hosted in this module — refuses a self-reported
 * `--result pass` for a `test`/`e2e` oracle whose `--command` contains an
 * unquoted, non-`||` shell pipe ({@link commandHasUnsafePipe}), because `$?`
 * after a pipe belongs to the LAST stage, not the oracle the caller means to
 * assert about (see that function's header for the full defect history —
 * governing spec: spec-oracle-tier-falsifiability-a-criterion-never-observed-
 * red M2; governing ADR: adr-falsifiability-moves-from-the-task-tier-to-the-
 * oracle-tier).
 *
 * `input.capture` is the load-bearing escape, and it is NOT a silencing flag
 * — see this function's own Opt-in note below. Composes the SAME
 * oracle/result scope gate the other self-report guards in this module share
 * ({@link isSelfReportedPassInScope}), checked after the capture
 * short-circuit (a `--capture` call with an out-of-scope oracle/result still
 * short-circuits to `null` for the same reason: nothing to check either way).
 *
 * WIRED at both call sites (`commands/evidence.ts`'s CLI adapter and
 * `../mcp/tools.ts`'s `lore_evidence_add` MCP handler) by
 * task-wire-findpiperefusal-into-the-live-lore-evidence-and-mcp: each calls
 * this function once, immediately after its own missing-oracle-file block and
 * before its `filteredPassRefusal` computation, passing `capture: <the same
 * boolean already resolved at that call site>`. To verify mechanically rather
 * than by trusting this sentence: grep `findPipeRefusal` in both files — each
 * carries an `import` of it and a `const pipeRefusal = findPipeRefusal({` call
 * site (⛔ no hit COUNT is stated here; a count goes stale the moment a comment
 * mentions the symbol). Note also that AC-FALS-9's oracle spawns a REAL
 * `lore evidence` process and asserts exit 4 without `--capture` / exit 0 with
 * it, so a silently-unwired regression fails that test rather than passing.
 *
 * ⛔ The guard's position after the missing-oracle-file guard
 * is deliberate (a nonexistent file is a more fundamental fault); ordering against the filtered-pass guard is immaterial,
 * the two conditions are independent. This function is hosted here, alongside
 * its four siblings, so BOTH adapters share ONE definition — ⛔ never a second,
 * parallel entry point per surface.
 *
 * Per adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the:
 *   - **Proxy** — "an unquoted, non-`||` `|` is present" is a proxy for "the
 *     recorded `$?` was NOT genuinely measured against the stage the caller
 *     means to assert about". Property violated while the proxy does NOT
 *     trigger (accepted false negative, the SAME "cannot be checked, so it is
 *     not blocked" posture this module's other guards already have):
 *     `bun run typecheck > out.log 2>&1; tail -100 out.log` — `;` sequences
 *     two SEPARATE statements, so `$?` after the whole chain is STILL
 *     `tail`'s exit code, yet no `|` character appears anywhere. This guard
 *     is deliberately narrow to the PIPE shape the governing task names
 *     (M2's own scope is literally "a shell pipe", not a general
 *     "last-executed-command owns `$?`" detector) — the broader form is a
 *     DIFFERENT defect this guard does not claim to close. Property
 *     SATISFIED while the proxy DOES trigger (accepted false positive, biased
 *     toward refusal — the SAME direction {@link extractCdPrefixTarget}'s own
 *     Proxy note is biased in): a command preceded by `set -o pipefail`
 *     (bash-only; makes `$?` reflect the FIRST failing stage, not the last)
 *     would be a genuinely-measured result this guard cannot distinguish from
 *     an unprotected pipe — `set -o pipefail` is typically set once, earlier,
 *     in a different shell/script, and is invisible to a per-invocation
 *     string scan. Refusing a technically-safe pipe is the safe direction to
 *     be wrong in.
 *   - **Silence** — none: the refusal names the exact command string carrying
 *     the pipe and states the last-stage-exit-code mechanism by name, so a
 *     future reader never has to guess why a seemingly-passing command was
 *     refused (mirrors {@link findUnderMatchedPassRefusal}'s own no-silence
 *     posture).
 *   - **Opt-in** — `input.capture` is the only escape, and it does not
 *     SILENCE this check the way a bypass flag would: it changes WHICH
 *     mechanism produces the recorded result. Under `--capture`, lore spawns
 *     `--command` itself and cross-checks its OWN observed exit code against
 *     the declared `--result`
 *     (`../../evidence-capture.js::captureOracleCommand`) — the result is
 *     measured, not self-reported, so the property this guard protects (a
 *     genuinely-measured result) is independently satisfied a DIFFERENT way.
 *     The governing spec names this explicitly as an out-of-scope non-goal
 *     ("Changing `--capture`'s behaviour… there lore spawns the command
 *     itself, so the pipe hazard does not apply"). There is no OTHER opt-in
 *     of any kind — unconditional for every other self-reported test/e2e pass.
 *
 * @param input.oracle - untyped `string`, same adapter-agnostic reasoning as
 *   this module's other guards
 * @param input.result - result as received
 * @param input.command - the exact command string
 * @param input.capture - whether `--capture` was passed for this call;
 *   `true` short-circuits to `null` unconditionally (see Opt-in above) —
 *   REQUIRED, not optional, so a caller can never accidentally omit it and
 *   silently lose the escape
 * @returns a `VALIDATION_ERROR` (exit code 4 via `utils.ts::exitCode`) naming
 *   the pipe and the repair, or `null` when the write may proceed
 * @example
 * findPipeRefusal({
 *   oracle: "test", result: "pass",
 *   command: "bun run test:changed abc 2>&1 | tail -100",
 *   capture: false,
 * })
 * // => VALIDATION_ERROR naming the pipe
 * @example
 * findPipeRefusal({
 *   oracle: "test", result: "pass",
 *   command: "bun run test:changed abc 2>&1 | tail -100",
 *   capture: true,
 * })
 * // => null — --capture measures the real exit code itself
 * @example
 * findPipeRefusal({
 *   oracle: "test", result: "pass",
 *   command: "grep 'a|b' file.ts", capture: false,
 * })
 * // => null — the pipe is inside a quoted run, never a shell operator
 */
export function findPipeRefusal(input: {
  oracle: string;
  result: string;
  command: string;
  capture: boolean;
}): LoreError | null {
  if (input.capture) return null;
  if (!isSelfReportedPassInScope(input)) return null;
  if (!commandHasUnsafePipe(input.command)) return null;

  return {
    code: "VALIDATION_ERROR",
    field: "command",
    message:
      `Self-reported --result pass with a shell pipe in --command: "${input.command}". ` +
      "$? observed after a pipe belongs to the LAST stage of the pipeline, not the oracle " +
      "this call means to assert about, so the recorded result cannot have been measured " +
      `against it. ${PIPE_REPAIR_HINT}`,
    value: input.command,
    rule: "BR-154",
  };
}

// ─── Captured-Fail Discovery-Refusal Guard (task-wire-the-discovery-refusal- ─
// ─── guard-into-the-evidence-capture, spec-oracle-executability-a-runner-s- ─
// ─── discovery-refusal-is-not-a §M6.2's evidence-path sibling, AC-OX-12) ────

/**
 * The SIXTH guard hosted in this module, and the FIRST that examines the
 * FAIL direction rather than the self-reported PASS direction the other five
 * share ({@link isSelfReportedPassInScope}). Closes the gap AC-OX-12 names:
 * `findDiscoveryRefusal` (`@lore/core`'s `attestation-completeness.ts`,
 * §M6.1) had exactly ONE production consumer before this task —
 * `service/verify-runner-service.ts`'s §M6.2 call site, which downgrades a
 * runner's discovery refusal (a ZERO-EXECUTION nonzero exit, e.g. vitest's
 * "No test files found, exiting with code 1") to `inconclusive` rather than
 * letting it mint a permanent, indistinguishable-from-a-real-red `fail`. The
 * SECOND write path that mints a red — `lore evidence --capture` / MCP
 * `lore_evidence_add` with `capture: true`, both via
 * `../evidence-capture.js::captureOracleCommand` — never consulted the
 * primitive at all: a poisoned cwd making `bunx vitest run <path>` print that
 * exact phrase would have been recorded as a genuine `fail`/`expected-fail`
 * carrying `capture_source: "runner"`, the corpus's strongest self-report
 * label, for a run that measured NOTHING.
 *
 * // reason: the outcome-shape decision (spec §"You decide the outcome
 * // shape" in the governing task) is REFUSE LOUDLY (`VALIDATION_ERROR`,
 * // exit 4 / MCP `isError`), NOT a silent downgrade to `result:
 * // "inconclusive"`. Three reasons, all load-bearing:
 * //   1. Every OTHER guard in this module already refuses loudly on the
 * //      SAME "the recorded outcome cannot have been measured" family of
 * //      defect ({@link findUnderMatchedPassRefusal}, {@link findFilteredPassRefusal},
 * //      {@link findPipeRefusal}) — a sixth guard silently downgrading
 * //      instead of refusing would be the ONE inconsistent member of its own
 * //      sibling set, forcing a reader to remember which of six behaves
 * //      differently.
 * //   2. `"inconclusive"` is a valid {@link EVIDENCE_RESULTS} member, but
 * //      BOTH CLI adapters' own `VALID_RESULTS`/`EvidenceOutcome` enums
 * //      (`commands/evidence.ts`, `../mcp/tools.ts`) restrict `--result`/
 * //      `result` to `pass | fail | expected-fail` — it is reserved for the
 * //      RUNNER-ATTESTED `lore verify` path (§M6.2's own call site). Silently
 * //      substituting a value the caller never typed, and could not have
 * //      typed, for the value they DID type is exactly the "no silent
 * //      fallback" violation this repo's own coding discipline names — the
 * //      caller must SEE the refusal and re-run, not discover later that
 * //      their `expected-fail` was quietly rewritten.
 * //   3. A loud refusal costs the caller nothing they were entitled to keep:
 * //      `--capture` observed a REAL exit code from a REAL spawn that
 * //      genuinely never executed anything — there is no "genuine measurement
 * //      of a failure" being thrown away, only a false credential being
 * //      declined.
 *
 * Scope, mirroring `verify-runner-service.ts`'s §M6.2 call site EXACTLY (same
 * three conjuncts, same order of reasoning):
 *   - `input.capture !== true` → out of scope. A self-reported `fail`/
 *     `expected-fail` with a HAND-TYPED tail is the pre-existing, explicitly
 *     out-of-scope residual this spec's own asymmetry table names ("self-
 *     reported … NONE" for the fail direction) — nothing here MEASURED that
 *     tail, so there is nothing for this guard to cross-check it against.
 *   - `input.oracle !== "test"` → out of scope, byte-identical to §M6.2's own
 *     `criterion.verify.oracle === "test"` gate. `findDiscoveryRefusal`'s
 *     three phrases are test-runner discovery phrases (vitest/bun test/
 *     playwright); widening to `e2e` or any other oracle kind is a SEPARATE
 *     decision this task does not make (none of §M6.2, this guard's own
 *     governing spec, or its sibling guards' scope gates do either).
 *   - `input.result` not in the fail family (`"fail" | "expected-fail"`) →
 *     out of scope. A captured `pass` can never reach this guard carrying a
 *     discovery-refusal tail in the first place: {@link captureOracleCommand}
 *     (`../evidence-capture.js`) cross-checks the declared result against the
 *     REAL observed exit code BEFORE this guard ever runs, and a discovery
 *     refusal always exits nonzero — a declared `pass` against that exit
 *     already fails THAT check and returns `{ok: false}`, recording nothing.
 *   - `input.outputTail === undefined` → out of scope (fail-open: nothing
 *     captured, nothing to classify — mirrors every other guard's "cannot be
 *     checked, so it is not blocked" posture).
 *
 * @param input.oracle - the oracle kind as received (untyped `string`, same
 *   adapter-agnostic reasoning as this module's other guards)
 * @param input.result - the result as received (CLI `--result` / MCP
 *   `result`)
 * @param input.capture - whether `--capture`/`capture: true` was requested
 *   for this call — REQUIRED, not optional, so a caller can never omit it and
 *   silently widen this guard onto the self-reported path it deliberately
 *   excludes
 * @param input.command - the exact command string being recorded, echoed
 *   into the refusal's `value` so an operator sees exactly what was refused
 * @param input.outputTail - the tail `captureOracleCommand` actually
 *   observed (CLI: `captured.value.outputTail`; MCP: `capturedTail`),
 *   `undefined` when capture did not run
 * @returns a `VALIDATION_ERROR` (exit code 4 via `utils.ts::exitCode`) naming
 *   the refusing runner and its verbatim evidence phrase, or `null` when the
 *   write may proceed
 *
 * @example
 * findCapturedFailDiscoveryRefusal({
 *   oracle: "test", result: "expected-fail", capture: true,
 *   command: "bunx vitest run packages/core/tests/does-not-exist.test.ts",
 *   outputTail: "No test files found, exiting with code 1\n",
 * })
 * // => VALIDATION_ERROR naming "vitest" and the phrase
 *
 * @example
 * findCapturedFailDiscoveryRefusal({
 *   oracle: "test", result: "expected-fail", capture: true,
 *   command: "bunx vitest run packages/core/tests/a.test.ts",
 *   outputTail: "Test Files  1 failed (1)\nTests  1 failed (1)\n",
 * })
 * // => null — a GENUINE assertion failure; expected-fail is still recorded
 *
 * @example
 * findCapturedFailDiscoveryRefusal({
 *   oracle: "test", result: "fail", capture: false,
 *   command: "bunx vitest run packages/core/tests/does-not-exist.test.ts",
 *   outputTail: "No test files found, exiting with code 1\n",
 * })
 * // => null — capture is false; the self-reported fail direction is this
 * // task's explicitly out-of-scope residual, not this guard's job
 */
export function findCapturedFailDiscoveryRefusal(input: {
  oracle: string;
  result: string;
  capture: boolean;
  command: string;
  outputTail?: string;
}): LoreError | null {
  if (!input.capture) return null;
  if (input.oracle !== "test") return null;
  if (input.result !== "fail" && input.result !== "expected-fail") return null;
  if (input.outputTail === undefined) return null;

  const refusal = findDiscoveryRefusal(input.outputTail);
  if (refusal === null) return null;

  return {
    code: "VALIDATION_ERROR",
    field: "command",
    message:
      `--capture ran --command and observed a ${refusal.runner} discovery refusal ` +
      `("${refusal.evidence}") — no test executed, so this is a ZERO-EXECUTION event, ` +
      `not a measured "${input.result}". Recording it as one would mint a permanent, ` +
      "indistinguishable-from-a-real-red row for a run that measured nothing " +
      "(spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a §M6.2's own defect, " +
      "now closed on this write path too). Fix the test path/filter in --command so the " +
      "runner actually executes something, then re-run with --capture; or, if the run " +
      "genuinely never executed anything on purpose, record nothing and investigate why.",
    value: input.command,
    rule: "BR-155",
  };
}

/**
 * Captured-red proof (spec-evidence-labels-and-reds-are-honest D8/D9/D10,
 * issue #53; BR-1077, BR-152). A captured `fail`/`expected-fail` is a red
 * only if the command genuinely ran something and failed:
 *   - exit 126/127 (not runnable / not found) is never a red, for ANY oracle;
 *   - oracle test/e2e needs, in the STORED output tail, a recognised runner
 *     summary reporting >= 1 failed test. A summary pushed out of the stored
 *     window by trailing stderr is refused with a `2>&1` hint.
 * Known limit: a hand-printed summary line passes ("a summary appeared", not
 * "a test ran"). Playwright output has no recognised summary and is refused.
 *
 * Shared verbatim by CLI `lore evidence` and MCP `lore_evidence_add`, so both
 * surfaces return the same LoreError. `captureOracleCommand` is unchanged (D10).
 *
 * @param input.capture - false => never judged (typed-in output is not a capture)
 * @param input.exitCode - the observed exit code of the captured run
 * @param input.outputTail - the STORED tail (CAPTURE_TAIL_CHARS window)
 * @returns VALIDATION_ERROR (exit 4) naming what is missing, or `null`
 *
 * @example
 * findCapturedRedProofGap({ oracle: "test", result: "expected-fail", capture: true,
 *   exitCode: 1, outputTail: "cd: no such file\n" }) // => VALIDATION_ERROR
 */
export function findCapturedRedProofGap(input: {
  oracle: string;
  result: string;
  capture: boolean;
  exitCode: number | null;
  outputTail?: string;
}): LoreError | null {
  if (!input.capture) return null;
  if (input.result !== "fail" && input.result !== "expected-fail") return null;

  if (input.exitCode === 126 || input.exitCode === 127) {
    return {
      code: "VALIDATION_ERROR",
      field: "command",
      message:
        `--capture observed exit code ${input.exitCode} (command not runnable or not found), ` +
        `so nothing was measured: it cannot be recorded as "${input.result}" for any check ` +
        "(BR-1077). Fix the command so it actually runs, then re-run with --capture.",
      value: input.exitCode,
      rule: "BR-1077",
    };
  }

  if (input.oracle !== "test" && input.oracle !== "e2e") return null;

  const failed = parseFailedCaseCount(input.outputTail ?? "");
  if (failed !== null && failed >= 1) return null;

  const missing =
    failed === null
      ? `the stored output tail carries no runner summary this check recognises (${RUNNER_SUMMARY_FORMATS_DESCRIPTION})`
      : "the runner summary in the stored output tail reports 0 failed tests";
  return {
    code: "VALIDATION_ERROR",
    field: "command",
    message:
      `--capture cannot record a "${input.result}" for oracle ${input.oracle}: ${missing}. ` +
      "A red must show a failed test, otherwise a broken command (failed cd, bad flag) would " +
      `satisfy the red-first floor (BR-1077). Only the last ${CAPTURE_TAIL_CHARS} characters are stored; if the ` +
      "runner's summary was pushed out by later stderr, add `2>&1` to --command so the summary " +
      "stays at the end. Playwright output has no recognised summary and cannot be captured as a red.",
    value: input.outputTail ?? "",
    rule: "BR-1077",
  };
}
