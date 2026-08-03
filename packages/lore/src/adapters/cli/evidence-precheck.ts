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
 *   - extractCdPrefixTarget(command) — derive the working directory a command's
 *     test-file tokens resolve against: the LAST `cd <path>` segment of the
 *     `&&`/`;` chain that precedes the test invocation, if any
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
 *   - describeDerivedCdTarget(command) — names the cd target the chain scan
 *     derived, the WHY clause beside describePrecheckRoots's WHERE clause
 *     (defect: task-evidence-precheck-only-sees-a-cd-in-the-first-segment-of-a)
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
 *   - findCrossRunnerTokens(command) / findMixedRunnerRefusal(input) — the
 *     THIRD self-report guard hosted here (defect: task-vitest-run-silently-
 *     drops-a-bun-test-ts-named-alongside-a): a single `vitest run` invocation
 *     naming a `.bun.test.ts` path alongside a real vitest file (or the
 *     symmetric `bun test` invocation naming a plain `.test.ts` file) silently
 *     runs only the files belonging to the runner it actually invoked — the
 *     OTHER named file is dropped with exit 0 and no warning, because vitest's
 *     own "no test files found" loud refusal is evaluated over the WHOLE
 *     invocation, not per named argument
 *   - findCaptureFlagConflict(input) — the FOURTH self-report guard hosted here
 *     (task-a-non-empty-output-tail-can-be-hand-authored-prose-and-the): a CLI
 *     usage-shape check over `--capture`'s two structural conflicts — combined
 *     with an explicit `--output-tail`/`--output-tail-file` (redundant: capture
 *     IS the tail), or combined with `--oracle manual` (nothing capturable —
 *     there is no command to spawn for a browser/visual check)
 *
 * All FOUR guards are ADJACENT but INDEPENDENT: the first asks "does the
 * file this command names exist at all", the second asks "did the filter this
 * command carries match anything — and, when it did not, is the filter itself
 * lexically incapable of matching the title it was pasted from", the third asks "would this command's OWN
 * invoked runner actually run every file it names", the fourth asks "does
 * --capture even make sense for this invocation's other flags". They share
 * only the oracle/result scope gate (`isSelfReportedPassInScope`) — except the
 * fourth, which is a pure CLI-usage shape check independent of `result`
 * entirely (a malformed `--capture` combination is nonsensical regardless of
 * what `--result` claims).
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
 *   (MCP `caller_cwd` escape hatch + roots-named refusal message);
 *   task-vitest-run-silently-drops-a-bun-test-ts-named-alongside-a (mixed-
 *   runner invocation guard);
 *   task-a-t-filter-is-a-regex-so-this-repo-s-own-ac-titles (the literal-vs-
 *   regex filter diagnosis folded into the filtered-pass guard)
 */

import {
  CASE_FILTER_FLAGS_DESCRIPTION,
  REGEX_METACHARACTERS_DESCRIPTION,
  RUNNER_SUMMARY_FORMATS_DESCRIPTION,
  commandHasCaseFilter,
  escapeCaseFilterPattern,
  extractCaseFilterPatterns,
  findRegexMetacharacters,
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
 * @param command - the exact command string recorded via `lore evidence --command`
 * @returns the segments in source order; a command with no separator yields
 *   exactly one segment (never `[]`, even for an empty command)
 */
function splitCommandSegments(command: string): string[] {
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
 * Matches a segment that consists of NOTHING BUT `cd <target>` — the target
 * being a double-quoted, single-quoted, or bare run. Anchored at BOTH ends on
 * purpose: `cd a b` is not a recognized cd segment (the pre-chain-scan regex
 * likewise refused it, since it required a separator immediately after the
 * single target token), and neither is a segment that merely CONTAINS the word
 * `cd`.
 */
const CD_SEGMENT_PATTERN = /^\s*cd\s+("[^"]*"|'[^']*'|\S+)\s*$/;

/**
 * Derives the working directory a command's test-file tokens resolve against:
 * the LAST `cd <dir>` segment of the `&&`/`;` chain that PRECEDES the first
 * segment naming a test file, quotes stripped.
 *
 * Scanning the whole chain — rather than only its first segment — is the fix
 * for task-evidence-precheck-only-sees-a-cd-in-the-first-segment-of-a. The
 * previous regex was anchored at `^`, so this repo's OWN mandated compiled-e2e
 * form (`bun run build && cd packages/lore && bun test <e2e file>`) and its
 * mandated fresh-worktree form (`bun install && cd … && …`) derived no cd
 * target at all; the precheck then resolved the test path against the repo
 * root and REFUSED a correct command naming an existing file. The measured
 * harm was second-order: the cheapest escape from that refusal is
 * `--oracle manual`, which skips file checking entirely, so a false refusal
 * converted verifiable rows into unverifiable ones as the path of least
 * resistance.
 *
 * "LAST one that precedes the test invocation" is shell semantics: a later
 * `cd` overrides an earlier one, and a `cd` AFTER the runner has already
 * resolved its paths does not apply at all. The trailing-`cd` bound is what
 * keeps this fix from widening into "any `cd` anywhere", which would add a
 * candidate root capable only of a FALSE ACCEPT.
 *
 * // reason: when the command names NO test-file token, the scan falls back to
 * // the last `cd` in the whole chain (there is no invocation to bound it).
 * // That branch is unreachable from this module's own consumers —
 * // `findMissingOracleFiles` and `describePrecheckRoots` both short-circuit
 * // on zero tokens before ever asking for a cd target — and exists solely so
 * // a direct caller keeps the historical answer for a token-free command like
 * // `cd packages/lore && bun run typecheck`. Do not "simplify" it into
 * // returning null: that would silently change this function's contract for
 * // every non-test command.
 *
 * Per adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the:
 *   - **Proxy** — "the last pre-invocation `cd` segment of an `&&`/`;` chain"
 *     is a proxy for "the shell's cwd when the runner resolves the path".
 *     Concrete input satisfying the property while violating the proxy:
 *     `cd a || cd b && bun test f.test.ts` (`||` is not a recognized
 *     separator, so `cd a || cd b` is one unmatched segment → `null`), and
 *     `cd $TARGET && bun test f.test.ts` (an unexpanded variable is returned
 *     literally and joins to a root that cannot exist). Accepted: both
 *     subtract a candidate root, so both can only produce a LOUD refusal
 *     naming the roots and the derived target — never a false accept. The
 *     inverse direction (proxy satisfied, property violated) is a `cd` this
 *     scan sees but the shell would not reach; it adds one candidate root, and
 *     is accepted for the same reason {@link findMissingOracleFiles} is
 *     already deliberately permissive about WHERE a file lives. A THIRD,
 *     narrower gap, named rather than fixed: successive RELATIVE cds are not
 *     COMPOSED — `cd a && cd b` derives `b`, whereas a shell would sit in
 *     `a/b`. This is what the task's own AC-5 pins ("resolve against the LAST
 *     one … assert the derived target BY VALUE"), and composing them would
 *     contradict it. The residual false-accept requires a file to exist at
 *     `<base>/b` while the shell looks in `<base>/a/b`; no command shape this
 *     repo emits chains relative cds at all, so it is accepted, not fixed.
 *   - **Silence** — none: the derived target (INCLUDING the "none" case) is
 *     named verbatim in the refusal message via
 *     {@link describeDerivedCdTarget}, so a future mismatch between "what the
 *     author meant" and "what this derived" is diagnosable from the message
 *     alone, without reading this source.
 *   - **Opt-in** — n/a: unconditional for every command the precheck examines;
 *     there is no flag that turns the chain scan off.
 *
 * @param command - the exact command string recorded via `lore evidence --command`
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
  const segments = splitCommandSegments(command);
  const invocationIndex = segments.findIndex(
    (segment) => extractTestFileTokens(segment).length > 0,
  );
  const scanEnd = invocationIndex === -1 ? segments.length : invocationIndex;

  for (let index = scanEnd - 1; index >= 0; index -= 1) {
    // reason: `as string` is a bounds assertion — `scanEnd <= segments.length`
    // and `index >= 0` guarantee the read (same rationale as
    // splitCommandSegments's own cast).
    const match = CD_SEGMENT_PATTERN.exec(segments[index] as string);
    if (match?.[1] === undefined) continue;
    const target = stripWrappingQuotes(match[1]);
    if (target.length > 0) return target;
  }
  return null;
}

/**
 * Names the cd target {@link extractCdPrefixTarget} derived from `command`, as
 * a ready-to-append clause of the "Oracle file(s) not found" refusal — the
 * companion to {@link describePrecheckRoots}'s roots clause (required by
 * task-evidence-precheck-only-sees-a-cd-in-the-first-segment-of-a: the roots
 * alone say WHERE the check looked, not WHY it looked there, so a future
 * cd-derivation mismatch would again need a source read to diagnose).
 *
 * // reason: deliberately adapter-NEUTRAL wording — no `--command`/`--oracle`
 * // (CLI spelling) and no `"command"`/`oracle: "manual"` (MCP spelling), so
 * // both evidence-write surfaces can append the identical string without
 * // rendering a flag name that does not exist on their own interface. This is
 * // the same anti-drift shape `findMixedRunnerRefusal` uses by returning a
 * // fully-formed error instead of a boolean each adapter phrases itself.
 *
 * @param command - the exact command string recorded via `lore evidence --command`
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
  const target = extractCdPrefixTarget(command);
  if (target === null) {
    return (
      "Derived cd target: none — no `cd <dir>` segment precedes the named test " +
      "file(s) in this command chain, so each root above is a base directory as-is."
    );
  }
  return (
    `Derived cd target: ${target} — the last \`cd\` segment preceding the named ` +
    "test file(s); each cd-joined root above is that target resolved onto a base directory."
  );
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
 * existing file under ANY plausible root: the cd target derived from the
 * command's `&&`/`;` chain ({@link extractCdPrefixTarget}), `opts.cwd` (and any
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

// ─── Mixed-Runner Invocation Guard (task-vitest-run-silently-drops-a-bun-test-ts-named-alongside-a) ─

/**
 * Matches a command invoking vitest's `run` subcommand — every shape this
 * repo actually emits (`bunx vitest run <files>`, `vitest run <files>`,
 * `npx vitest run <files>`; `package.json`'s own `test:vitest` script is
 * `bunx vitest run`). Requires the `run` subcommand token, not just the bare
 * word `vitest`, so a command that merely references `vitest.config.ts` in a
 * path (no invocation at all) is never mistaken for one.
 */
const VITEST_RUN_INVOCATION_PATTERN = /\bvitest\s+run\b/;

/**
 * Matches a command invoking `bun test` — every shape this repo actually
 * emits (`bun test <files>`, `cd packages/lore && bun test <files>`;
 * `package.json`'s own `test:bun` script is `cd packages/lore && bun test
 * --timeout 30000 .bun.test`). Requires an actual whitespace gap between the
 * two tokens, so a path component like `bun.test.ts` (no space) never matches.
 */
const BUN_TEST_INVOCATION_PATTERN = /\bbun\s+test\b/;

/**
 * The suffix that makes a token `bun test`'s EXCLUSIVE file, per this repo's
 * two-runner split (root CLAUDE.md "Test file convention"): `.bun.test.ts`
 * files use `bun:sqlite` and are excluded from `vitest.config.ts`; every
 * OTHER extracted suffix (`.test.ts`, `.test.tsx`, `.spec.ts`) runs under
 * vitest only. Checked via `endsWith` (never a second regex) because
 * `.bun.test.ts` itself contains the substring `.test.ts` — a plain
 * `.includes(".test.ts")` would misclassify it as a vitest-only file.
 */
const BUN_ONLY_FILE_SUFFIX = ".bun.test.ts";

/**
 * Reports which of `command`'s extracted test-file tokens
 * ({@link extractTestFileTokens}) belong to the OTHER runner's EXCLUSIVE
 * suffix — the exact defect shape measured 2026-08-01
 * (task-vitest-run-silently-drops-a-bun-test-ts-named-alongside-a): a single
 * `vitest run` invocation naming a `.bun.test.ts` path alongside a genuine
 * vitest file exits 0 having silently run ONLY the vitest file. vitest's own
 * "no test files found" loud refusal is evaluated over the WHOLE invocation,
 * not per named argument — a quorum of one matching file silences it for
 * every OTHER named file the runner drops. The symmetric case (a `bun test`
 * invocation naming a plain `.test.ts`/`.test.tsx`/`.spec.ts` file) is
 * reported for the same reason: this repo's two-runner convention never
 * intends that file to run under `bun test`.
 *
 * Deliberately narrow to the two invocation shapes this repo actually emits
 * ({@link VITEST_RUN_INVOCATION_PATTERN}, {@link BUN_TEST_INVOCATION_PATTERN})
 * — NOT a shell-grammar parser (mirrors {@link extractCdPrefixTarget}'s own
 * documented narrowness). A command naming BOTH invocation shapes (a chained
 * `vitest run … && … bun test …`) or NEITHER is left alone: this detector
 * cannot attribute a token to one sub-invocation over the other in the
 * former case, and has no runner to classify against in the latter — the
 * same "cannot be checked, so it is not blocked" fail-open posture
 * {@link extractTestFileTokens}'s "no extractable token" case already has.
 *
 * @param command - the exact command string recorded via `lore evidence --command`
 * @returns the subset of extracted tokens this command's OWN invoked runner
 *   would silently exclude; `[]` when the command invokes neither runner (or
 *   both), or invokes exactly one and names no token belonging to the other's
 *   exclusive suffix
 * @example
 *   findCrossRunnerTokens("bunx vitest run a.test.ts b.bun.test.ts")
 *   // => ["b.bun.test.ts"]
 * @example
 *   findCrossRunnerTokens("cd packages/lore && bun test tests/x.bun.test.ts")
 *   // => [] — the only named token IS bun test's own file
 */
export function findCrossRunnerTokens(command: string): string[] {
  const tokens = extractTestFileTokens(command);
  if (tokens.length === 0) return [];

  const invokesVitest = VITEST_RUN_INVOCATION_PATTERN.test(command);
  const invokesBunTest = BUN_TEST_INVOCATION_PATTERN.test(command);
  // reason: both true (a chained multi-runner command) or both false (neither
  // recognised) are equally "cannot attribute", so both collapse to the same
  // fail-open branch — see this function's own doc.
  if (invokesVitest === invokesBunTest) return [];

  return invokesVitest
    ? tokens.filter((token) => token.endsWith(BUN_ONLY_FILE_SUFFIX))
    : tokens.filter((token) => !token.endsWith(BUN_ONLY_FILE_SUFFIX));
}

/**
 * How an operator repairs a mixed-runner command — appended verbatim to the
 * refusal so it always ends with the action, not just the diagnosis.
 */
const MIXED_RUNNER_REPAIR_HINT =
  'Split into two separate --command recordings, one per runner: run the vitest-only ' +
  'files through "vitest run <files>" and the .bun.test.ts files through ' +
  '"bun test <files>" (cd packages/lore first) — record each as its OWN lore evidence call.';

/**
 * The THIRD self-report guard hosted here — refuses a `--result pass` whose
 * `--command` names test files belonging to two DIFFERENT runners in a
 * single invocation (see {@link findCrossRunnerTokens}'s header for the exact
 * defect shape). Composes the same oracle/result scope gate the other two
 * guards in this module share ({@link isSelfReportedPassInScope}).
 *
 * // reason: why this is a PATH-SHAPE check, not the fabricable-integer class
 * // this module's `findFilteredPassRefusal` header excludes a `--matched <n>`
 * // flag for. A `--matched <n>` flag would be a bare number the caller
 * // asserts INDEPENDENTLY of what the command actually names — pure
 * // self-report, exactly as fabricable as the `pass` it would gate. This
 * // guard reads the `--command` string the caller ALREADY supplied to name
 * // what ran; there is no separate number to lie about. The caller cannot
 * // satisfy it by typing something different while leaving the real
 * // invocation unchanged — the only way to pass is to actually split the
 * // command into two genuinely single-runner invocations, which IS the fix,
 * // not a workaround around the check.
 *
 * @param input - same shape {@link findFilteredPassRefusal} accepts minus
 *   `outputTail` — this guard needs nothing from the runner's own output; the
 *   command string alone proves the shape
 * @returns a `VALIDATION_ERROR` (exit code 4 via `utils.ts::exitCode`) naming
 *   the cross-runner token(s) and the two-command repair, or `null` when the
 *   write may proceed
 *
 * @example
 * findMixedRunnerRefusal({
 *   oracle: "test", result: "pass",
 *   command: "bunx vitest run a.test.ts b.bun.test.ts",
 * })
 * // => VALIDATION_ERROR naming "b.bun.test.ts"
 */
export function findMixedRunnerRefusal(input: {
  oracle: string;
  result: string;
  command: string;
}): LoreError | null {
  if (!isSelfReportedPassInScope(input)) return null;

  const crossRunnerTokens = findCrossRunnerTokens(input.command);
  if (crossRunnerTokens.length === 0) return null;

  const invokedVitest = VITEST_RUN_INVOCATION_PATTERN.test(input.command);
  const invokedRunner = invokedVitest ? "vitest run" : "bun test";
  const droppedRunner = invokedVitest ? "bun test" : "vitest run";

  return {
    code: "VALIDATION_ERROR",
    field: "command",
    message:
      `Mixed-runner --command: this "${invokedRunner}" invocation also names ` +
      `${droppedRunner}-only file(s) (${crossRunnerTokens.join(", ")}). This repo splits test ` +
      'files across two runners (root CLAUDE.md "Test file convention"), and a single ' +
      "invocation only ever executes the files belonging to the runner it actually invoked — " +
      "the rest are silently excluded with NO warning and exit 0 (vitest's own \"no test files " +
      "found\" refusal is evaluated over the WHOLE invocation, not per named argument, so any " +
      "one matching file silences it for every other named file that gets dropped). " +
      MIXED_RUNNER_REPAIR_HINT,
    value: input.command,
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
    };
  }

  return null;
}
