/**
 * Oracle-file existence primitives — pure command-string analysis answering
 * "does the file a script-mode oracle command names actually exist", plus the
 * injected filesystem port it is checked through. Promoted out of
 * `packages/lore/src/adapters/cli/evidence-precheck.ts` (task-promote-the-
 * oracle-file-existence-primitives-into-lore, spec-oracle-executability-a-
 * runner-s-discovery-refusal-is-not-a §M6.3) so a SECOND, non-evidence
 * consumer — `AcService.addCriterion`/`setCriterion`'s declaration-time
 * path-existence check — can reuse the identical logic instead of forking a
 * second, drift-prone copy. Mirrors `attestation-completeness.ts`'s
 * established shape: pure + an injected port + multiple adapters/services on
 * the consuming side.
 *
 * Public surface:
 *   - FileExistsPort — the injectable filesystem-existence check (real
 *     caller: `fs.existsSync`; tests inject a fake).
 *   - splitCommandSegments(command) — the ONE segmentation seam (task-
 *     promote-splitcommandsegments-to-the-one-segmentation-seam): splits a
 *     shell command chain into its `&&`/`;`-separated segments, quote-aware.
 *     Every consumer that needs to reason about "which part of this chain is
 *     the actual test-runner invocation" calls THIS, never a second parser —
 *     see `classifyCommandSegment`'s own header for why a second walker over
 *     the unsegmented string was the root defect this promotion closes.
 *   - classifyCommandSegment(segment) / classifyCommandSegments(command) —
 *     labels one (or every) `&&`/`;` segment as a recognised test-runner
 *     invocation or `"unclassified"` — the shared predicate both
 *     `extractTestFileTokens` (this file) and `countExplicitPathArgs`
 *     (`attestation-completeness.ts`) scope their path extraction to, so
 *     "what counts as a runner segment" has exactly one definition.
 *   - extractTestFileTokens(command) — pull test-file-like path tokens out of
 *     a shell command string, scoped to its recognised runner segments only.
 *   - extractCdPrefixTarget(command) — derive the working directory a
 *     command's test-file tokens resolve against, read by the shared cwd-aware
 *     parser (`shell-cwd.ts`); this module has no `cd` handling of its own.
 *   - describeDerivedCdTarget(command) — names the cd target
 *     `extractCdPrefixTarget` derived, as a ready-to-append refusal clause.
 *   - findMissingOracleFiles(command, opts) — composes both extractors with
 *     an injected `FileExistsPort` to report which extracted tokens resolve
 *     to no file anywhere plausible.
 *   - describePrecheckRoots(command, opts) — names the exact absolute root
 *     paths `findMissingOracleFiles` would check `command`'s tokens against,
 *     for refusal-message construction.
 *
 * Invariants:
 *   - Referentially transparent: same input in → same output, always. No IO,
 *     no `Date.now()`/`Math.random()` calls — the caller supplies the clock
 *     (n/a here) and the filesystem (via `FileExistsPort`).
 *   - `extractTestFileTokens` returns `[]` for a command naming no
 *     recognizable test-file token — a deliberate fail-open: a command that
 *     names nothing checkable is never blocked by anything built on top of
 *     this primitive (both consumers' own scope gates decide separately
 *     whether an EMPTY result should refuse or pass through).
 *   - `extractTestFileTokens` scans ONLY the segments `classifyCommandSegment`
 *     recognises as a runner invocation (task-promote-splitcommandsegments-
 *     to-the-one-segmentation-seam, AC-061-18/20/21) — a path-shaped token
 *     sitting in an `echo`/`cd`/`git grep`/etc. segment is prose or a shell
 *     builtin argument, never a test-file argument a runner will receive, and
 *     is NEVER extracted regardless of its shape. A segment that is not a
 *     recognised runner invocation is `classifyCommandSegment`'s
 *     `"unclassified"`, never silently treated as "a runner that happens to
 *     declare zero paths" — the two are observably different states so a
 *     caller can tell "nothing to see here" from "this module didn't
 *     recognise this shape at all".
 *   - `findMissingOracleFiles` is permissive about WHERE a named file lives
 *     (cd-derived root, bare cwd, any `additionalCwds`, `corpusRoot`) and
 *     strict about WHETHER it exists anywhere plausible — a token counts as
 *     missing only when it fails EVERY candidate root.
 *   - This module owns NO oracle/result scope gate and NO `LoreError`
 *     construction — those decisions belong to each CONSUMER
 *     (`evidence-precheck.ts`'s `isSelfReportedPassInScope`-gated composition
 *     for self-reported evidence; `AcService`'s own D8 escape-hatch decision
 *     for AC declaration). Consumers compose this module's pure facts into
 *     their own refusal, never the reverse.
 *
 * Side-effect class: pure (no IO, no fs, no process access) — browser-safe,
 *   vitest-safe.
 *
 * Source: task-lore-evidence-self-reported-pass-lacks-oracle-file (original
 *   authoring, evidence-precheck.ts); task-lore-evidence-s-oracle-file-
 *   precheck-resolves-against-the (roots-named refusal message); task-
 *   evidence-precheck-only-sees-a-cd-in-the-first-segment-of-a (whole-chain cd
 *   scan); task-promote-the-oracle-file-existence-primitives-into-lore
 *   (THIS promotion — spec-oracle-executability-a-runner-s-discovery-
 *   refusal-is-not-a §M6.3/D8)
 */

import { ABSTRACT_ROOT, CWD_BUILTINS, parseShellCommand, type NotMeasured } from "./shell-cwd.js";

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
 * Extracts every test-file-like path token from a raw shell command string,
 * scanning ONLY the `&&`/`;` segments {@link classifyCommandSegment}
 * recognises as a test-runner invocation.
 *
 * Deliberately naive tokenization within a recognised segment — no
 * shell-grammar parsing. A flag value that happens to not end in a
 * recognized test-file suffix (e.g. `-t "AC-1 happy path"`) never matches,
 * since the pattern requires the suffix. A command referencing no
 * recognizable test file returns `[]` — this is a deliberate fail-open (see
 * this module's own Invariants): a command with no extractable token cannot
 * be checked for existence, so neither consumer's precheck blocks it. This is
 * the EXACT structural blind spot
 * spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a's AC-OX-4
 * pins by name: `bun run test`, `bun run typecheck`, a `test $(grep -rln ...
 * | wc -l) -eq 0` form, a `bun run dev -- setup --dry-run ...` form, and a
 * `diff <(shasum ...) <(shasum ...)` pair all carry NO extractable token, so
 * `AcService`'s declaration-time check (like `evidence-precheck.ts`'s guard 1
 * before it) can never refuse them — asserted explicitly, never hidden
 * behind a green run.
 *
 * A SECOND, independent reason a token now goes unextracted (task-promote-
 * splitcommandsegments-to-the-one-segmentation-seam, AC-061-18/20): a segment
 * that is not a recognised runner invocation — a `cd`, an `echo`, a `git
 * grep`, a `test -f` shell-builtin check — contributes NO tokens even when
 * its text happens to contain a `.test.ts`-suffixed substring (a bare test
 * basename mentioned inside a human-readable success `echo` is prose, not an
 * argument any runner will ever receive). Pre-fix, this function scanned the
 * WHOLE raw command string with one global regex, so that basename was
 * extracted as if it were a real path argument and then reported missing by
 * `findMissingOracleFiles` — measured 2026-08-19, `AcService.addCriterion`
 * refused a declaration naming a real, existing integration test solely
 * because its own success echo also spelled that file's basename.
 *
 * @param command - the exact command string recorded via `lore evidence --command`
 *   or declared via `lore ac add`/`lore ac set --command`
 * @returns de-duplicated, order-preserving list of path-like test-file tokens
 *   found in the command's recognised runner segment(s) only
 * @example
 *   extractTestFileTokens("bunx vitest run packages/lore/tests/foo.test.ts")
 *   // => ["packages/lore/tests/foo.test.ts"]
 *   extractTestFileTokens("bunx vitest run -t \"AC-1\" packages/x.test.ts")
 *   // => ["packages/x.test.ts"]
 *   extractTestFileTokens("bun run typecheck")
 *   // => []
 * @example
 *   // the echo segment is NOT a runner invocation — its basename is prose,
 *   // never extracted, even though it matches the test-file suffix pattern.
 *   extractTestFileTokens(
 *     "bun test packages/x/real.bun.test.ts && echo 'ran real.bun.test.ts'",
 *   );
 *   // => ["packages/x/real.bun.test.ts"]
 */
export function extractTestFileTokens(command: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const { segment, runner } of classifyCommandSegments(command)) {
    if (runner === "unclassified") continue;
    const matches = segment.match(TEST_FILE_TOKEN_PATTERN) ?? [];
    for (const token of matches) {
      if (seen.has(token)) continue;
      seen.add(token);
      tokens.push(token);
    }
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
 * Splits a command chain into its `&&`/`;`-separated segments, IGNORING
 * separators that sit inside a quoted run (`"…"`, `'…'`, `` `…` ``).
 *
 * Quote awareness is load-bearing, not polish: a naive `split(/&&|;/)` breaks
 * `cd "weird;dir" && bun test f.test.ts` (the `;` inside the quoted target
 * would split the cd segment in half and yield the garbage target `"weird`),
 * a case the pre-chain-scan regex handled correctly via its `"[^"]*"`
 * alternative. Splitting here preserves that.
 *
 * Deliberately NOT a shell grammar: `||`, single `|`, `&`, newlines, subshell
 * `(…)`, and backslash escapes are NOT treated as separators or quote escapes.
 * Every one of those makes a `cd` INVISIBLE to {@link extractCdPrefixTarget},
 * which subtracts a candidate root and therefore biases toward a LOUD refusal
 * — never toward a false accept (see that function's Proxy/Silence notes).
 *
 * Quote characters are kept in the emitted segment text so the cd-segment
 * matcher's own quote alternatives still see (and strip) them.
 *
 * Promoted to a module export (task-promote-splitcommandsegments-to-the-one-
 * segmentation-seam) so `attestation-completeness.ts`'s `countExplicitPathArgs`
 * reuses THIS parser instead of walking the raw, unsegmented command string a
 * second time — two independent walkers over one string are two definitions
 * of "what counts as a path here", and pre-fix they disagreed in opposite
 * directions (one over-counted a compound chain's shell-builtin arguments as
 * declared test paths, the other under-counted by scanning only the first
 * segment). This function is now the ONE place that answers "where does this
 * command chain split".
 *
 * @param command - the exact command string being analyzed
 * @returns the segments in source order; a command with no separator yields
 *   exactly one segment (never `[]`, even for an empty command)
 */
export function splitCommandSegments(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let openQuote: string | null = null;

  for (let index = 0; index < command.length; index += 1) {
    // reason: the `as string` is a bounds assertion, not a fallback — `index <
    // command.length` guarantees the read. Do NOT "harden" it into `?? ""`:
    // under noUncheckedIndexedAccess an empty-string default would silently
    // append a phantom character instead of failing, which is exactly the
    // no-silent-fallback rule's target.
    const char = command[index] as string;

    if (openQuote !== null) {
      if (char === openQuote) openQuote = null;
      current += char;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      openQuote = char;
      current += char;
      continue;
    }
    if (char === ";") {
      segments.push(current);
      current = "";
      continue;
    }
    if (char === "&" && command[index + 1] === "&") {
      segments.push(current);
      current = "";
      index += 1;
      continue;
    }
    current += char;
  }

  segments.push(current);
  return segments;
}

/**
 * The FIVE test-runner-invocation SHAPES this repo's `script:test`/
 * `script:e2e` acceptance-criterion commands actually declare — measured
 * 2026-08-21 (task-promote-splitcommandsegments-to-the-one-segmentation-seam,
 * AC-061-18) against this repo's own `package.json` scripts and its corpus's
 * declared `verify.command` strings: `vitest run …` (with or without a
 * leading `bunx` launcher — some declared commands omit it), `bun test …`,
 * `bun run <script> …`, `playwright test …` (again with or without `bunx`),
 * and a direct invocation of the compiled `dist/lore` binary itself (this
 * repo's own dogfooding shape — SPEC-061 AC-061-9's own worked example is
 * `./dist/lore verify plan-1 <paths…>`; the fifth arm tests this segment's
 * LEADING token against a pattern DERIVED from
 * {@link COMPILED_BINARY_TOKEN_PATTERN}'s `.source` — see
 * `LEADING_COMPILED_BINARY_PATTERN`'s own JSDoc for why "leading" and
 * "anywhere" are deliberately different scopes for two different
 * consumers, `attestation-completeness.ts`'s `commandReferencesCompiledBinary`
 * being the "anywhere" one — while "what does a dist/lore PATH look like"
 * still has exactly one textual definition). A segment matching NONE of
 * these five is not a runner invocation at all — a `cd`, an `echo`, a
 * `git grep`, a `test -f` shell-builtin check, or anything else — and is
 * classified `"unclassified"`.
 */
export type RecognizedRunner = "vitest" | "bun-test" | "bun-run" | "playwright" | "lore-cli";

/**
 * One `&&`/`;`-split command segment ({@link splitCommandSegments}),
 * paired with {@link classifyCommandSegment}'s verdict for it.
 */
export interface ClassifiedSegment {
  readonly segment: string;
  readonly runner: RecognizedRunner | "unclassified";
}

// reason: `bunx --bun vitest` is the one-runner form every AC command uses (SPEC-143 C9); without
// the optional `--bun` the segment read "unclassified" and AC-CT-4's radius lost its test-file targets.
const VITEST_SEGMENT_PATTERN = /^\s*(?:bunx\s+(?:--bun\s+)?)?vitest\b/;
const BUN_TEST_SEGMENT_PATTERN = /^\s*bun\s+test\b/;
const BUN_RUN_SEGMENT_PATTERN = /^\s*bun\s+run\s+\S+/;
const PLAYWRIGHT_SEGMENT_PATTERN = /^\s*(?:bunx\s+)?playwright\s+test\b/;

/**
 * Matches a command token that is (or ends in) a path to the compiled
 * `dist/lore` binary — `\b` before "dist" requires the preceding character
 * (if any) to be a non-word character (`/`, whitespace, start-of-string), so
 * a token like `mydist/lore-helper.ts` (no path-separator boundary before
 * "dist") never false-matches. THE SSOT for this shape: promoted here from
 * `attestation-completeness.ts` (task-promote-splitcommandsegments-to-the-
 * one-segmentation-seam) once `classifyCommandSegment` needed the identical
 * check — `attestation-completeness.ts`'s `commandReferencesCompiledBinary`
 * now imports THIS constant rather than declaring its own copy, so "does a
 * command reference the compiled binary" has exactly one definition despite
 * two independent call sites (whole-command freshness-check triggering vs.
 * per-segment runner classification).
 */
export const COMPILED_BINARY_TOKEN_PATTERN = /\bdist\/lore\b/;

/**
 * Matches a segment whose LEADING (first whitespace-delimited) token IS a
 * path to the compiled `dist/lore` binary — the segment-classification
 * counterpart of {@link COMPILED_BINARY_TOKEN_PATTERN}, which deliberately
 * keeps its "anywhere in the whole command" semantics for
 * `attestation-completeness.ts`'s `commandReferencesCompiledBinary` (a
 * freshness-check TRIGGER: even a `dist/lore` invocation buried later in an
 * `&&` chain still needs a freshness check before the chain's result is
 * trusted, so "anywhere" is the CORRECT scope for that consumer).
 *
 * `classifyCommandSegment`'s job is different: identify what SHAPE this ONE
 * already-`&&`/`;`-split segment IS, exactly like its other four arms
 * (`^\s*(?:bunx\s+)?vitest\b`, etc.) — none of which test "does this segment
 * CONTAIN the word vitest anywhere", because a segment whose invocation is
 * something else entirely (an `echo` whose success prose happens to mention
 * "vitest", say) is obviously not a vitest invocation. The fifth arm using
 * {@link COMPILED_BINARY_TOKEN_PATTERN} unanchored was exactly that same
 * mistake for the compiled binary (task-re-anchor-the-compiled-binary-
 * classifier-arm-and-credit, AC-061-22 — gap 8 reintroduced through this
 * narrower door, in the very commit that closed it): an `echo` success line
 * mentioning `dist/lore` in prose was classified as a `"lore-cli"` runner
 * invocation, re-admitting the exact phantom-token defect AC-061-20 exists
 * to close.
 *
 * `^\s*\S*` bounds the search to the segment's first token only — `\S*`
 * cannot cross a whitespace character, so it can never reach into a SECOND
 * token (an argument, or prose after the leading command word). Within that
 * bound, {@link COMPILED_BINARY_TOKEN_PATTERN}'s own `\b…\b` word-boundary
 * requirement is reused verbatim (via its `.source`) rather than
 * re-typed — so "what does a dist/lore PATH look like" still has exactly
 * one definition; only the "where in the string is it allowed to appear"
 * scope differs between the two consumers.
 *
 * @example
 *   LEADING_COMPILED_BINARY_PATTERN.test("./dist/lore verify plan-1") // => true
 *   LEADING_COMPILED_BINARY_PATTERN.test("/repo/dist/lore --version") // => true
 * @example
 *   // "dist/lore" is present, but not as the segment's LEADING token.
 *   LEADING_COMPILED_BINARY_PATTERN.test("test -f dist/lore") // => false
 *   LEADING_COMPILED_BINARY_PATTERN.test('echo "ships dist/lore"') // => false
 */
const LEADING_COMPILED_BINARY_PATTERN = new RegExp(
  `^\\s*\\S*${COMPILED_BINARY_TOKEN_PATTERN.source}`,
);

/**
 * Classifies ONE `&&`/`;`-split command segment as a {@link RecognizedRunner}
 * invocation, or `"unclassified"` when its shape matches none of the five
 * (task-promote-splitcommandsegments-to-the-one-segmentation-seam, AC-061-18).
 *
 * `"unclassified"` is a DISTINCT verdict from "a runner segment that happens
 * to declare zero paths" (e.g. `bun run typecheck`, which classifies as
 * `"bun-run"`) — collapsing the two would silently fold "this module has no
 * idea what this segment is" into the same "nothing to see here" a genuinely
 * path-less runner invocation produces. AC-061-18 requires the opposite: a
 * confident wrong answer (silently treating an unrecognised shape as
 * contributing zero, indistinguishably from a recognised one) is the failure
 * mode this guards against, not an absent one — every caller built on this
 * function can tell the two states apart via the `runner` field.
 *
 * @param segment - one element of {@link splitCommandSegments}'s output —
 *   never re-splits it further (a segment by definition contains no
 *   unquoted `&&`/`;`)
 * @example
 *   classifyCommandSegment("bunx vitest run x.test.ts")
 *   // => { segment: "bunx vitest run x.test.ts", runner: "vitest" }
 * @example
 *   classifyCommandSegment("./dist/lore verify plan-1 x.test.ts")
 *   // => { segment: "./dist/lore verify plan-1 x.test.ts", runner: "lore-cli" }
 * @example
 *   classifyCommandSegment("echo 'ran x.test.ts'")
 *   // => { segment: "echo 'ran x.test.ts'", runner: "unclassified" }
 */
export function classifyCommandSegment(segment: string): ClassifiedSegment {
  if (VITEST_SEGMENT_PATTERN.test(segment)) return { segment, runner: "vitest" };
  if (PLAYWRIGHT_SEGMENT_PATTERN.test(segment)) return { segment, runner: "playwright" };
  if (BUN_TEST_SEGMENT_PATTERN.test(segment)) return { segment, runner: "bun-test" };
  if (BUN_RUN_SEGMENT_PATTERN.test(segment)) return { segment, runner: "bun-run" };
  if (LEADING_COMPILED_BINARY_PATTERN.test(segment)) return { segment, runner: "lore-cli" };
  return { segment, runner: "unclassified" };
}

/**
 * Splits `command` via {@link splitCommandSegments} and classifies EVERY
 * resulting segment via {@link classifyCommandSegment} — never drops a
 * segment from the result, so a caller can always audit "which parts of this
 * chain did this module actually recognise" rather than reading only an
 * aggregate count that a non-runner segment silently disappeared into.
 *
 * @param command - the exact command string being analyzed
 * @returns one {@link ClassifiedSegment} per `&&`/`;` segment, in source
 *   order; never `[]` ({@link splitCommandSegments} never returns one)
 */
export function classifyCommandSegments(command: string): ClassifiedSegment[] {
  return splitCommandSegments(command).map(classifyCommandSegment);
}

// ─── AC-EI-2: interpreter / runner script paths ────────────────────────────

/**
 * Leading-token shapes of a segment that hands a FILE to an interpreter (AC-EI-2,
 * spec-evidence-identity-an-attested-row-counts-only-for-the): bare `bun`/`node`/`sh`/`bash`/`tsx`, or
 * `bunx`/`npx` (optionally `--bun`/`-y`/`--yes`) followed by `bun`/`node`/`tsx`. Capture 1 = the
 * interpreter after a launcher, capture 2 = a bare interpreter, capture 3 = the rest of the segment.
 * `bunx vitest` / `bunx playwright` never match here (they are {@link RecognizedRunner}s whose paths
 * {@link extractTestFileTokens} already reads).
 */
const INTERPRETER_SEGMENT_PATTERN =
  /^\s*(?:(?:bunx|npx)\s+(?:(?:--bun|-y|--yes)\s+)*(bun|node|tsx)|(bun|node|sh|bash|tsx))(?=\s|$)([\s\S]*)$/;

/** Flags after which the NEXT token is the flag's value, never the script (node/bun/tsx option surface). */
const VALUE_TAKING_INTERPRETER_FLAGS: ReadonlySet<string> = new Set([
  "-r", "--require", "--import", "--loader", "--env-file", "--conditions", "-C", "--cwd", "--preload", "--config", "--tsconfig",
]);

/** Flags that hand INLINE code to the interpreter: there is no file to check, so the segment is unclassifiable. */
const INLINE_CODE_FLAGS_BY_FAMILY = {
  // reason: `-e` is errexit for sh/bash (NOT inline code) — the inline flag is per-family, never one shared set.
  shell: new Set(["-c"]),
  js: new Set(["-e", "-p", "--eval", "--print"]),
} as const;

/** A token that plausibly names a file: has a path separator or a script extension, and no shell expansion syntax. */
const SCRIPT_EXTENSION_PATTERN = /\.(?:[cm]?[jt]sx?|sh|bash)$/;
const SHELL_EXPANSION_PATTERN = /[$`*?<>()|{}]/;

/**
 * Shell builtins / output commands that take no script and run no oracle: a segment led by one of these is
 * never reported as unchecked (it is not an oracle invocation). Anything else the extractor cannot classify IS reported.
 */
const BENIGN_SHELL_LEADERS: ReadonlySet<string> = new Set([
  ...CWD_BUILTINS, "echo", "printf", "test", "[", "true", "false", ":", "export", "set", "exit",
]);

function tokenizeSegment(segment: string): string[] {
  return (segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(stripWrappingQuotes);
}

/**
 * Reads the script file one segment hands to an interpreter.
 *
 * @param segment - one `&&`/`;` segment ({@link splitCommandSegments})
 * @returns `{ kind: "path", path }` when the first positional argument names a file; `{ kind: "unresolved" }`
 *   when the segment IS an interpreter invocation but names no checkable file (inline `-e`/`-c` code, a
 *   shell-expanded or extension-less word, no argument); `null` when the segment is not an interpreter
 *   invocation, or is `bun test` / `bun run <script-name>` (recognised runners whose names are not files).
 * @example
 *   extractInterpreterScript("bun scripts/measure-test-wall.ts --max-seconds 600")
 *   // => { kind: "path", path: "scripts/measure-test-wall.ts" }
 *   extractInterpreterScript("sh -c 'exit 1'") // => { kind: "unresolved" }
 *   extractInterpreterScript("bun run typecheck") // => null
 */
export function extractInterpreterScript(
  segment: string,
): { kind: "path"; path: string } | { kind: "unresolved" } | null {
  const match = INTERPRETER_SEGMENT_PATTERN.exec(segment);
  if (match === null) return null;
  const interpreter = match[1] ?? match[2];
  const tokens = tokenizeSegment(match[3] ?? "");
  const inlineFlags: ReadonlySet<string> =
    interpreter === "sh" || interpreter === "bash" ? INLINE_CODE_FLAGS_BY_FAMILY.shell : INLINE_CODE_FLAGS_BY_FAMILY.js;
  let skipNext = false;
  let sawRun = false;
  for (const token of tokens) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (inlineFlags.has(token)) return { kind: "unresolved" };
    if (VALUE_TAKING_INTERPRETER_FLAGS.has(token)) {
      skipNext = true;
      continue;
    }
    if (token.startsWith("-")) continue;
    if (interpreter === "bun" && !sawRun && token === "test") return null;
    if (interpreter === "bun" && !sawRun && token === "run") {
      sawRun = true;
      continue;
    }
    const pathLike = (token.includes("/") || SCRIPT_EXTENSION_PATTERN.test(token)) && !SHELL_EXPANSION_PATTERN.test(token);
    if (pathLike) return { kind: "path", path: token };
    // reason: `bun run typecheck` names a package script, not a file: a recognised runner, nothing to extract.
    return sawRun ? null : { kind: "unresolved" };
  }
  return sawRun ? null : { kind: "unresolved" };
}

/**
 * Every file path a declared command asks the filesystem to hold: test-file tokens of recognised runner
 * segments ({@link extractTestFileTokens}) PLUS the script path of every interpreter segment
 * ({@link extractInterpreterScript}). AC-EI-2: `bun scripts/measure-test-wall.ts --max-seconds 600` yields
 * `scripts/measure-test-wall.ts`.
 *
 * @param command - the exact command string
 * @returns de-duplicated, order-preserving path tokens
 */
export function extractOraclePathTokens(command: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  const push = (token: string): void => {
    if (seen.has(token)) return;
    seen.add(token);
    tokens.push(token);
  };
  for (const { segment, runner } of classifyCommandSegments(command)) {
    if (runner !== "unclassified") for (const token of segment.match(TEST_FILE_TOKEN_PATTERN) ?? []) push(token);
    const script = extractInterpreterScript(segment);
    if (script?.kind === "path") push(script.path);
  }
  return tokens;
}

/**
 * Segments of `command` the extractor could not classify (AC-EI-2 half 5; baseline AS-17): neither a
 * recognised runner, nor an interpreter segment naming a file, nor a benign shell builtin. The existence check
 * says NOTHING about them, so a caller must report them instead of reading silence as "checked clean".
 *
 * @param command - the exact command string
 * @returns trimmed text of each unclassifiable segment, in source order; `[]` when every segment is understood
 * @example
 *   findUncheckedOracleSegments("python3 check.py && echo done") // => ["python3 check.py"]
 *   findUncheckedOracleSegments("bunx --bun vitest run a.test.ts && echo ok") // => []
 */
export function findUncheckedOracleSegments(command: string): string[] {
  const unchecked: string[] = [];
  for (const { segment, runner } of classifyCommandSegments(command)) {
    const text = segment.trim();
    if (text.length === 0 || runner !== "unclassified") continue;
    const script = extractInterpreterScript(segment);
    if (script?.kind === "path") continue;
    const leader = tokenizeSegment(text)[0] ?? "";
    if (script === null && BENIGN_SHELL_LEADERS.has(leader)) continue;
    unchecked.push(text);
  }
  return unchecked;
}

/**
 * Derives the working directory a command's test-file tokens resolve against: the directory the LAST
 * test-naming segment runs in, root-relative, as the ONE shell parser ({@link parseShellCommand}) reads it.
 *
 * Real cwd semantics, not a proxy: a later `cd` composes onto an earlier relative one (`cd a && cd b` runs in
 * `a/b`), a `( cd x && … )` subshell scopes its `cd` to itself, a `cd` AFTER the runner never applies to it, and a
 * `cd` in any earlier chain segment applies (#229). A directory the text cannot name — an unset `$VAR`, `cd -`,
 * `$( )`, `pushd` — derives `null` AND is named in {@link describeDerivedCdTarget}'s refusal clause; an absolute `cd`
 * outside the working root derives `null` and is reported as refused (#221), never resolved onto a base.
 *
 * Per adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the: the property is "the shell's cwd when the
 * runner resolves the path"; the parser follows `&&`/`||`/`;`/`|`/`&`/newline chains and subshells, and reports
 * what it cannot follow instead of guessing. {@link findMissingOracleFiles} stays deliberately permissive about
 * WHERE a file lives (it tries every segment's directory plus the bare base), strict about WHETHER it exists.
 *
 * @param command - the exact command string being analyzed
 * @returns the cd target (quotes stripped), or `null` when no `cd` segment
 *   precedes the named test file(s)
 * @example
 *   extractCdPrefixTarget("cd packages/lore && bun test tests/foo.bun.test.ts")
 *   // => "packages/lore"
 * @example
 *   extractCdPrefixTarget("bun run build && cd packages/lore && bun test tests/e2e/x.bun.test.ts")
 *   // => "packages/lore" — the defect case: this used to be null
 * @example
 *   extractCdPrefixTarget("cd a && cd b && bun test f.test.ts")
 *   // => "b" — a later cd overrides an earlier one
 * @example
 *   extractCdPrefixTarget("bun test f.test.ts && cd packages/lore")
 *   // => null — the cd runs AFTER the path is resolved
 * @example
 *   extractCdPrefixTarget("bunx vitest run foo.test.ts")
 *   // => null
 */
export function extractCdPrefixTarget(command: string): string | null {
  return readOracleSegmentCwds(command, ABSTRACT_ROOT).lastOffset;
}

/** What the shared parser ({@link parseShellCommand}) says about the directories of a command's path-naming segments. */
interface OracleSegmentCwdReading {
  /** Distinct non-empty root-relative directories of the path-naming segments, in source order. */
  readonly offsets: string[];
  /** Root-relative directory of the LAST path-naming segment when it is a non-empty `inside` one, else `null`. */
  readonly lastOffset: string | null;
  /** Absolute directories (outside the root) path-naming segments run in: refused, never resolved. */
  readonly refused: string[];
  /** Path-naming segments whose directory could not be measured, with the named cause. */
  readonly notMeasured: NotMeasured[];
}

/**
 * Reads, through the ONE shell parser, the directory each path-naming segment of `command` runs in.
 * Every site that needs "where does this oracle file resolve" goes through here; none reads `cd` itself.
 *
 * @param command - the exact command string
 * @param root - absolute directory the command starts in ({@link ABSTRACT_ROOT} when only relative answers matter)
 */
function readOracleSegmentCwds(command: string, root: string): OracleSegmentCwdReading {
  const parse = parseShellCommand(command, { root, env: {} });
  const offsets: string[] = [];
  const refused: string[] = [];
  const notMeasured: NotMeasured[] = [];
  if (parse.kind === "not-measured") {
    notMeasured.push(parse);
    return { offsets, lastOffset: null, refused, notMeasured };
  }
  let lastOffset: string | null = null;
  for (const segment of parse.segments) {
    if (extractOraclePathTokens(segment.raw).length === 0) continue;
    const { cwd } = segment;
    if (cwd.kind === "not-measured") {
      notMeasured.push(cwd);
      lastOffset = null;
    } else if (cwd.kind === "outside") {
      refused.push(cwd.absolute);
      lastOffset = null;
    } else {
      lastOffset = cwd.relative.length > 0 ? cwd.relative : null;
      if (lastOffset !== null && !offsets.includes(lastOffset)) offsets.push(lastOffset);
    }
  }
  return { offsets, lastOffset, refused, notMeasured };
}

/**
 * Names the cd target {@link extractCdPrefixTarget} derived from `command`, as
 * a ready-to-append clause of an "Oracle file(s) not found" refusal — the
 * companion to {@link describePrecheckRoots}'s roots clause (required by
 * task-evidence-precheck-only-sees-a-cd-in-the-first-segment-of-a: the roots
 * alone say WHERE the check looked, not WHY it looked there, so a future
 * cd-derivation mismatch would again need a source read to diagnose).
 *
 * // reason: deliberately adapter-NEUTRAL wording — no `--command`/`--oracle`
 * // (CLI spelling) and no `"command"`/`oracle: "manual"` (MCP spelling), so
 * // every consuming surface can append the identical string without
 * // rendering a flag name that does not exist on its own interface.
 *
 * @param command - the exact command string being analyzed
 * @returns a non-empty sentence naming the derived target, or stating that
 *   none was derived — never an empty string, so the clause is always present
 *   in the refusal and its absence can never be mistaken for "not measured"
 * @example
 *   describeDerivedCdTarget("bun run build && cd packages/lore && bun test tests/x.bun.test.ts")
 *   // => "Derived cd target: packages/lore (…)"
 * @example
 *   describeDerivedCdTarget("bunx vitest run x.test.ts")
 *   // => "Derived cd target: none (…)"
 */
export function describeDerivedCdTarget(command: string): string {
  const reading = readOracleSegmentCwds(command, ABSTRACT_ROOT);
  const target = reading.lastOffset;
  const caveats = [
    ...reading.refused.map((path) => ` Refused: a segment runs in ${path}, outside the working root.`),
    ...reading.notMeasured.map((cause) => ` Not measured (${cause.cause}): ${cause.detail}.`),
  ].join("");
  if (target === null) {
    return (
      "Derived cd target: none — no `cd <dir>` segment precedes the named test " +
      "file(s) in this command chain, so each root above is a base directory as-is." +
      caveats
    );
  }
  return (
    `Derived cd target: ${target} — the directory the last test-naming segment runs in after the ` +
    "`cd` segment(s) before it; each cd-joined root above is that target resolved onto a base directory." +
    caveats
  );
}

/**
 * Injectable filesystem-existence check — see this module's header. Real
 * caller: `fs.existsSync`; tests inject a fake so this module (and everything
 * built on top of it) stays vitest-safe with no real filesystem access.
 */
export type FileExistsPort = (absolutePath: string) => boolean;

/**
 * Minimal path-joining helper (POSIX-style, no `node:path` dependency — this
 * module stays free of Node builtins so it is importable from a browser
 * bundle and from vitest). Treats `base` as already absolute; `segment` may
 * itself be absolute (returned unchanged, matching `path.resolve`'s override
 * behavior) or relative (joined onto `base`). Does not normalize `..`/`.`
 * segments — callers pass already-clean roots (`process.cwd()`, a discovered
 * corpus root) and relatively well-formed command tokens; a `fileExists` port
 * backed by real `fs.existsSync` resolves any leftover `..`/`.` segments
 * transparently at the OS level.
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
 * @param command - the exact command string being analyzed
 * @param opts.cwd - absolute current working directory
 * @param opts.additionalCwds - absolute directories to ALSO treat as `cwd`
 *   (cd-prefix joining included for each) — omitted for every caller that
 *   doesn't need this (CLI; MCP callers that never pass `caller_cwd`; the AC
 *   declaration-time check)
 * @param opts.corpusRoot - absolute discovered `.lore/` corpus root; omitted
 *   or equal to `cwd` means only `cwd` (+ any `additionalCwds`) is tried
 * @returns de-duplicated, order-preserving absolute root paths this command
 *   would be checked against (cd-target-joined bases first, then bare bases,
 *   then `corpusRoot` if distinct from every base)
 */
function computeCandidateRoots(
  command: string,
  opts: { cwd: string; additionalCwds?: string[]; corpusRoot?: string; executionRoot?: string },
): string[] {
  const plainBases = [opts.cwd, ...(opts.additionalCwds ?? [])];
  // reason: F7 — an attested execution root is a base like any cwd, tried
  // FIRST and ADDITIVELY (every plain base is still tried, so it can only
  // resolve more tokens, never hide a real miss).
  const executionRoot = opts.executionRoot;
  const rootBases =
    executionRoot === undefined || executionRoot.length === 0
      ? []
      : plainBases.map((base) => joinPath(base, executionRoot));
  const bases = [...rootBases, ...plainBases];
  const roots: string[] = [];
  const seen = new Set<string>();
  const pushUnique = (root: string): void => {
    if (seen.has(root)) return;
    seen.add(root);
    roots.push(root);
  };
  for (const base of bases) {
    // reason: the parse runs PER BASE so an absolute `cd` is classified against the base it would run from:
    // inside it, it becomes an offset; outside it, it is refused (no candidate root) — #221, never joined in.
    for (const offset of readOracleSegmentCwds(command, base).offsets) pushUnique(joinPath(base, offset));
    pushUnique(base);
  }
  if (opts.corpusRoot !== undefined) pushUnique(opts.corpusRoot);
  return roots;
}

/**
 * Reports which test-file tokens extracted from `command` resolve to no
 * existing file under ANY plausible root: the cd target derived from the
 * command's `&&`/`;` chain ({@link extractCdPrefixTarget}), `opts.cwd` (and any
 * `opts.additionalCwds`), and `opts.corpusRoot` (when distinct from every
 * cwd candidate). A token already absolute is checked as-is (no root
 * candidates). A token counts as "missing" only when it fails EVERY
 * applicable root — the check is deliberately permissive about WHERE the
 * file lives, strict about WHETHER it exists anywhere plausible.
 *
 * Two consumers compose this same pure fact into two DIFFERENT refusal
 * decisions, deliberately never sharing a scope gate (see this module's own
 * header Invariants): `evidence-precheck.ts::findMissingOracleFilesForEvidence`
 * gates it behind `isSelfReportedPassInScope` (self-reported `test`/`e2e`
 * `pass` only); `AcService.addCriterion`/`setCriterion` gates it behind
 * "script-mode criterion, declaration-time" plus the D8
 * `--allow-missing-path` escape — an entirely independent decision with its
 * own narrow predicate, per this task's own non-negotiable design constraint
 * (widening `isSelfReportedPassInScope` to cover AC declaration would silently
 * arm the OTHER four evidence guards for a direction none of them reason
 * about).
 *
 * @param command - the exact command string being analyzed
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
  opts: {
    cwd: string;
    additionalCwds?: string[];
    corpusRoot?: string;
    /** Attested execution root (repo-relative or absolute), joined with any `cd` offset. Never parsed from the command. */
    executionRoot?: string;
    fileExists: FileExistsPort;
  },
): string[] {
  const tokens = extractOraclePathTokens(command);
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

/** Collapses `.`, empty and `..` segments of a posix path so `./a/../x.test.ts` and `x.test.ts` compare equal. */
function normalizePosixPath(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === ".." && out.length > 0 && out[out.length - 1] !== "..") out.pop();
    else out.push(part);
  }
  return (path.startsWith("/") ? "/" : "") + out.join("/");
}

/** Every normalised absolute location `tokens` could denote under `command`'s candidate roots. */
function resolveTokenLocations(
  command: string,
  tokens: readonly string[],
  opts: { cwd: string; additionalCwds?: string[]; corpusRoot?: string; executionRoot?: string },
): Set<string> {
  const roots = computeCandidateRoots(command, opts);
  const locations = new Set<string>();
  for (const token of tokens) {
    if (token.startsWith("/")) {
      locations.add(normalizePosixPath(token));
      continue;
    }
    for (const root of roots) locations.add(normalizePosixPath(joinPath(root, token)));
  }
  return locations;
}

/**
 * True when a recorded evidence command RAN a criterion's now-missing oracle file: some test-file token of
 * the evidence command (extracted by {@link extractTestFileTokens}, the one extraction `verify` uses) resolves —
 * under the SAME candidate roots {@link findMissingOracleFiles} uses, including the attested `executionRoot` —
 * to the same normalised location as one of the criterion's missing paths. So `./x.test.ts` equals `x.test.ts`,
 * and a package-relative path recorded with an execution root equals the repo-relative AC path. A pass that
 * ran other files returns `false` (TG-22; spec-test-governance-guards-that-refuse-bad-tests-declared AC-TG-6).
 *
 * Fails CLOSED toward "it did run it": every location both sides could denote is compared, so ambiguity
 * can only add matches (the refusal), never hide one.
 *
 * @param evidence.command - command recorded on the evidence row
 * @param evidence.executionRoot - the row's attested `execution_root`, when present
 * @param criterion.command - the criterion's CURRENT script command
 * @param criterion.missingPaths - what {@link findMissingOracleFiles} returned for `criterion.command`
 * @param ctx - the same cwd/additionalCwds/corpusRoot used to compute `missingPaths`
 * @returns `false` when `missingPaths` is empty or the evidence command names none of them
 * @example
 *   evidenceRanMissingOracle({ command: "bun test ./a.test.ts" }, { command: "bun test a.test.ts", missingPaths: ["a.test.ts"] }, { cwd: "/r" })
 *   // => true
 */
export function evidenceRanMissingOracle(
  evidence: { command: string; executionRoot?: string },
  criterion: { command: string; missingPaths: readonly string[] },
  ctx: { cwd: string; additionalCwds?: string[]; corpusRoot?: string },
): boolean {
  if (criterion.missingPaths.length === 0) return false;
  const ran = resolveTokenLocations(evidence.command, extractOraclePathTokens(evidence.command), {
    ...ctx,
    ...(evidence.executionRoot !== undefined ? { executionRoot: evidence.executionRoot } : {}),
  });
  const missing = resolveTokenLocations(criterion.command, criterion.missingPaths, ctx);
  for (const location of ran) if (missing.has(location)) return true;
  return false;
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
 * @param command - the exact command string being analyzed
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
  if (extractOraclePathTokens(command).length === 0) return [];
  return computeCandidateRoots(command, opts);
}
