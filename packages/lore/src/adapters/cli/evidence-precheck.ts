/**
 * Pure command-string analysis for the `lore evidence` self-reported-pass
 * oracle-file precheck (defect: task-lore-evidence-self-reported-pass-lacks-
 * oracle-file, AC-080-3 incident — a self-reported `--oracle test --result
 * pass` recorded cleanly even though the referenced test file did not exist
 * on disk; only `lore verify`'s SPEC-061 zero-match guard caught it, two
 * verify rounds later).
 *
 * Public surface:
 *   - extractTestFileTokens(command) — pull test-file-like path tokens out of
 *     a shell command string
 *   - extractCdPrefixTarget(command) — detect a leading `cd <path> && ...`
 *     (or `cd <path>; ...`) prefix, if present
 *   - findMissingOracleFiles(command, opts) — compose both extractors with an
 *     injected existence port to report which extracted tokens resolve to no
 *     file anywhere plausible
 *   - findMissingOracleFilesForEvidence(input) — additionally composes the
 *     "test"/"e2e" + "pass" oracle/result gate on top of findMissingOracleFiles,
 *     so both the CLI (`commands/evidence.ts`) and MCP (`../mcp/tools.ts`'s
 *     `lore_evidence_add`) adapters share ONE decision of which calls are even
 *     in scope for this precheck (task-mcp-lore-evidence-add-bypasses-the-
 *     oracle-file-existence)
 *   - describePrecheckRoots(command, opts) — names the exact absolute root
 *     paths `findMissingOracleFiles` would check `command`'s tokens against,
 *     for refusal-message construction (defect: task-lore-evidence-s-oracle-
 *     file-precheck-resolves-against-the — the pre-fix refusal named no root
 *     at all)
 *   - findFilteredPassProofGap(input) / findFilteredPassRefusal(input) —
 *     the SECOND self-report guard hosted here (SPEC-061 AC-061-11..14, 17): a
 *     `--result pass` whose `--command` carries a `-t` case filter must arrive
 *     with the runner's own summary line as matched-count proof
 *
 * Both guards are ADJACENT but INDEPENDENT: the first asks "does the file this
 * command names exist at all", the second asks "did the filter this command
 * carries match anything". They share only the oracle/result scope gate
 * (`isSelfReportedPassInScope`).
 *
 * Design: token EXTRACTION and existence-port CHECKING both live here so the
 * whole precheck is unit-testable with a fake `fileExists` — no real
 * filesystem needed (mirrors `service/drift-check-service.ts`'s injected
 * `FsProbe` port / `adapters/real-fs-probe.ts`'s real implementation split).
 * Resolving the ACTUAL filesystem (which path is cwd, which is corpus root)
 * is deliberately left to the CLI command (`commands/evidence.ts`) — that
 * layer is the one that knows `process.cwd()` and the discovered `.lore/`
 * root; this module only needs `existsSync` handed to it as a function.
 *
 * Side-effect class: pure (no IO, no fs, no process access) — vitest-safe.
 *
 * Source: task-lore-evidence-self-reported-pass-lacks-oracle-file;
 *   task-lore-evidence-must-refuse-a-t-filtered-pass-with-no (SPEC-061,
 *   adr-lore-evidence-proves-a-filtered-pass-with-the-runner-s-own);
 *   task-lore-evidence-s-oracle-file-precheck-resolves-against-the
 *   (MCP `caller_cwd` escape hatch + roots-named refusal message)
 */

import {
  CASE_FILTER_FLAGS_DESCRIPTION,
  RUNNER_SUMMARY_FORMATS_DESCRIPTION,
  commandHasCaseFilter,
  parseExecutedUnits,
  type LoreError,
} from "@lore/core";

/**
 * Matches a path-like token ending in a recognized test-file suffix
 * (`.bun.test.ts`, `.test.tsx`, `.test.ts`, `.spec.ts`). The character class
 * excludes whitespace and quote characters, so a quoted token (`"foo.test.ts"`)
 * is captured WITHOUT its surrounding quotes automatically — no separate
 * quote-stripping step is needed for this pattern. `\b` at the end prevents a
 * false match on `foo.test.tsx-something` (an unlikely but not impossible
 * shell token).
 */
const TEST_FILE_TOKEN_PATTERN =
  /[^\s"'`]+\.(?:bun\.test\.ts|test\.tsx|test\.ts|spec\.ts)\b/g;

/**
 * Extracts every test-file-like path token from a raw shell command string.
 *
 * Deliberately naive tokenization — no shell-grammar parsing. A flag value
 * that happens to not end in a recognized test-file suffix (e.g. `-t "AC-1
 * happy path"`) never matches, since the pattern requires the suffix. A
 * command referencing no recognizable test file returns `[]` — this is a
 * deliberate fail-open (see `commands/evidence.ts`'s module header): a
 * command with no extractable token cannot be checked for existence, so the
 * precheck does not block it.
 *
 * @param command - the exact command string recorded via `lore evidence --command`
 * @returns de-duplicated, order-preserving list of path-like test-file tokens
 * @example
 *   extractTestFileTokens("bunx vitest run packages/lore/tests/foo.test.ts")
 *   // => ["packages/lore/tests/foo.test.ts"]
 *   extractTestFileTokens("bunx vitest run -t \"AC-1\" packages/x.test.ts")
 *   // => ["packages/x.test.ts"]
 *   extractTestFileTokens("bun run typecheck")
 *   // => []
 */
export function extractTestFileTokens(command: string): string[] {
  const matches = command.match(TEST_FILE_TOKEN_PATTERN) ?? [];
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const token of matches) {
    if (seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }
  return tokens;
}

/** Strips a single layer of matching wrapping quote characters, if present. */
function stripWrappingQuotes(token: string): string {
  if (token.length >= 2) {
    const first = token[0];
    const last = token[token.length - 1];
    if ((first === '"' || first === "'" || first === "`") && first === last) {
      return token.slice(1, -1);
    }
  }
  return token;
}

/**
 * Detects a leading `cd <path> && ...` (or `cd <path>; ...`) prefix at the
 * START of a command string and returns the cd target, quotes stripped. Only
 * recognizes a SINGLE leading `cd` — `foo && cd bar && baz` does not count
 * (the `cd` is not first): this is a narrow "cd-prefix" recognizer for the
 * common `cd <dir> && <oracle command>` shape recorded by evidence commands,
 * not a general shell-command interpreter.
 *
 * @param command - the exact command string recorded via `lore evidence --command`
 * @returns the cd target (quotes stripped), or `null` when the command has no
 *   leading cd-prefix
 * @example
 *   extractCdPrefixTarget("cd packages/lore && bun test tests/foo.bun.test.ts")
 *   // => "packages/lore"
 *   extractCdPrefixTarget("bunx vitest run foo.test.ts")
 *   // => null
 */
export function extractCdPrefixTarget(command: string): string | null {
  const match = /^\s*cd\s+("[^"]*"|'[^']*'|\S+)\s*(?:&&|;)/.exec(command);
  if (!match || match[1] === undefined) return null;
  const target = stripWrappingQuotes(match[1]);
  return target.length > 0 ? target : null;
}

/** Injectable filesystem-existence check — see this module's header. */
export type FileExistsPort = (absolutePath: string) => boolean;

/**
 * Minimal path-joining helper (POSIX-style, no `node:path` dependency — this
 * module stays free of Node builtins so it is importable from vitest). Treats
 * `base` as already absolute; `segment` may itself be absolute (returned
 * unchanged, matching `path.resolve`'s override behavior) or relative
 * (joined onto `base`). Does not normalize `..`/`.` segments — callers pass
 * already-clean roots (`process.cwd()`, a discovered corpus root) and
 * relatively well-formed command tokens; a `fileExists` port backed by real
 * `fs.existsSync` resolves any leftover `..`/`.` segments transparently at
 * the OS level.
 */
function joinPath(base: string, segment: string): string {
  if (segment.startsWith("/")) return segment;
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${normalizedBase}/${segment}`;
}

/**
 * Shared root-candidate computation for BOTH {@link findMissingOracleFiles}
 * (existence checking) and {@link describePrecheckRoots} (refusal-message
 * naming) — SSOT so the two can never drift on "which roots did we actually
 * try" (defect: task-lore-evidence-s-oracle-file-precheck-resolves-against-
 * the — the pre-fix refusal named NO root at all, leaving an author unable to
 * tell "your file is missing" from "I looked in the wrong tree").
 *
 * `opts.additionalCwds` (SPEC-042/M4-class fix, MCP-surface specific) is
 * treated EXACTLY like `opts.cwd` — including cd-prefix joining — never a
 * bare extra root. A long-lived MCP stdio server's own `process.cwd()`
 * reflects wherever THAT PROCESS was launched, not the calling agent's actual
 * current directory (a per-invocation CLI subprocess has no such gap —
 * `process.cwd()` there IS the caller's real cwd). `additionalCwds` gives the
 * calling agent an explicit channel to declare its real directory instead
 * (mirrors `lore verify`'s `--execution-root` escape hatch for the identical
 * class of "a process cannot autonomously know its correct execution root"
 * problem, SPEC-063). Purely ADDITIVE — every root `findMissingOracleFiles`
 * already tried is still tried; a genuinely-missing file still fails every
 * root, `additionalCwds` included (the anti-vacuous-pass control is
 * unaffected by construction: more candidates can only ever resolve MORE
 * tokens, never suppress a real miss).
 *
 * @param command - the exact command string recorded via `lore evidence --command`
 * @param opts.cwd - absolute current working directory
 * @param opts.additionalCwds - absolute directories to ALSO treat as `cwd`
 *   (cd-prefix joining included for each) — omitted for every caller that
 *   doesn't need this (CLI; MCP callers that never pass `caller_cwd`)
 * @param opts.corpusRoot - absolute discovered `.lore/` corpus root; omitted
 *   or equal to `cwd` means only `cwd` (+ any `additionalCwds`) is tried
 * @returns de-duplicated, order-preserving absolute root paths this command
 *   would be checked against (cd-target-joined bases first, then bare bases,
 *   then `corpusRoot` if distinct from every base)
 */
function computeCandidateRoots(
  command: string,
  opts: { cwd: string; additionalCwds?: string[]; corpusRoot?: string },
): string[] {
  const cdTarget = extractCdPrefixTarget(command);
  const bases = [opts.cwd, ...(opts.additionalCwds ?? [])];
  const roots: string[] = [];
  const seen = new Set<string>();
  const pushUnique = (root: string): void => {
    if (seen.has(root)) return;
    seen.add(root);
    roots.push(root);
  };
  for (const base of bases) {
    if (cdTarget !== null) pushUnique(joinPath(base, cdTarget));
    pushUnique(base);
  }
  if (opts.corpusRoot !== undefined) pushUnique(opts.corpusRoot);
  return roots;
}

/**
 * Reports which test-file tokens extracted from `command` resolve to no
 * existing file under ANY plausible root: the cd-prefix target (if the
 * command starts with `cd <dir> &&`/`cd <dir>; `), `opts.cwd` (and any
 * `opts.additionalCwds`), and `opts.corpusRoot` (when distinct from every
 * cwd candidate). A token already absolute is checked as-is (no root
 * candidates). A token counts as "missing" only when it fails EVERY
 * applicable root — the check is deliberately permissive about WHERE the
 * file lives, strict about WHETHER it exists anywhere plausible.
 *
 * @param command - the exact command string recorded via `lore evidence --command`
 * @param opts.cwd - absolute current working directory
 * @param opts.additionalCwds - see {@link computeCandidateRoots}'s param docs
 * @param opts.corpusRoot - absolute discovered `.lore/` corpus root; omitted
 *   or equal to `cwd` means only `cwd` is tried
 * @param opts.fileExists - injected existence check (real caller: `fs.existsSync`)
 * @returns the subset of extracted tokens (original, un-resolved strings)
 *   that do not exist under any candidate root; `[]` when `command`
 *   references no test-file token at all (nothing to check) or every
 *   extracted token resolves somewhere
 * @example
 *   findMissingOracleFiles("bunx vitest run x.test.ts", {
 *     cwd: "/repo",
 *     fileExists: (p) => p === "/repo/x.test.ts",
 *   })
 *   // => []
 */
export function findMissingOracleFiles(
  command: string,
  opts: { cwd: string; additionalCwds?: string[]; corpusRoot?: string; fileExists: FileExistsPort },
): string[] {
  const tokens = extractTestFileTokens(command);
  if (tokens.length === 0) return [];

  const roots = computeCandidateRoots(command, opts);

  const missing: string[] = [];
  for (const token of tokens) {
    if (token.startsWith("/")) {
      if (!opts.fileExists(token)) missing.push(token);
      continue;
    }
    const existsSomewhere = roots.some((root) =>
      opts.fileExists(joinPath(root, token)),
    );
    if (!existsSomewhere) missing.push(token);
  }
  return missing;
}

/**
 * Names the exact absolute root paths {@link findMissingOracleFiles} would
 * check `command`'s extracted test-file tokens against — for refusal-message
 * construction ONLY (never re-derives the existence check itself; SSOT via
 * {@link computeCandidateRoots}). Exists so a caller reading the refusal
 * message can tell "your file is missing" from "I looked in the wrong tree"
 * (defect: task-lore-evidence-s-oracle-file-precheck-resolves-against-the) —
 * the pre-fix message named neither.
 *
 * @param command - the exact command string recorded via `lore evidence --command`
 * @param opts - same shape {@link findMissingOracleFiles} accepts (minus `fileExists`)
 * @returns de-duplicated, order-preserving absolute root paths — `[]` iff
 *   `command` references no extractable test-file token at all (nothing
 *   would be checked, so there is nothing to name)
 * @example
 *   describePrecheckRoots("cd packages/lore && bun test tests/x.bun.test.ts", {
 *     cwd: "/repo", corpusRoot: "/main-checkout",
 *   })
 *   // => ["/repo/packages/lore", "/repo", "/main-checkout"]
 */
export function describePrecheckRoots(
  command: string,
  opts: { cwd: string; additionalCwds?: string[]; corpusRoot?: string },
): string[] {
  if (extractTestFileTokens(command).length === 0) return [];
  return computeCandidateRoots(command, opts);
}

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
 * @param input.additionalCwds - see {@link computeCandidateRoots}'s param
 *   docs — the MCP-surface `caller_cwd`-style escape hatch, omitted by every
 *   caller that doesn't need it (CLI; MCP callers that never pass it)
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
  "--output-tail (or --output-tail-file; MCP: output_tail); or record the run " +
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
 * // tail that shows matches, never by deleting the tail.
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
 */
export function findFilteredPassRefusal(input: {
  oracle: string;
  result: string;
  command: string;
  outputTail?: string;
}): LoreError | null {
  const gap = findFilteredPassProofGap(input);
  if (gap === null) return null;

  return {
    code: "VALIDATION_ERROR",
    field: "output_tail",
    message:
      `Filtered --result pass without matched-count proof: --command carries a ` +
      `case-name filter (${CASE_FILTER_FLAGS_DESCRIPTION}) and ${GAP_DIAGNOSIS[gap]}. ` +
      "A filter that matches nothing still exits 0 with every test reported skipped, " +
      `so this pass is unproven. ${MATCHED_COUNT_REPAIR_HINT}`,
    value: input.command,
  };
}
