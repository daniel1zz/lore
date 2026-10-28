#!/usr/bin/env bun
/**
 * Unclaimed-oracle detector (M3, `spec-oracle-tier-falsifiability-a-criterion-never-observed-red`,
 * AC-FALS-8) — `task-report-a-test-name-pattern-value-that-no-declared` ships the CHECK
 * only; wiring it into `lore status` is the surfacing task's job (⛔ do not edit any
 * `commands/*.ts` from here).
 *
 * A `-t` / `--testNamePattern` / `--test-name-pattern` VALUE present in a repo test
 * file (a `describe`/`it`/`test` name shaped as a bare kebab-case token, or the
 * kebab-case suffix after the LAST " — " em-dash in a longer describe title — the
 * convention this repo's own AC-bound test files already use, e.g.
 * `describe("lintAcQuantifiability — false-positive-bound", ...)`) that NO declared
 * script-mode acceptance criterion's `verify.command` binds (via that SAME flag +
 * value + test file, token-for-token) is reported. This is how a silently WITHDRAWN
 * AC binding becomes visible: the test keeps passing, and nothing else says the
 * criterion that used to own it is gone — live instance this task was filed from:
 * AC-ACQ-7's oracle command was restated from `-t false-positive-bound` to
 * `-t hyphen-adjacency-bound`, and the `false-positive-bound` describe block was
 * left in place, orphaned, still green.
 *
 * ## Why this is ONE file, not a pure/IO split
 *
 * The established shape for a corpus-reading script (`check-ac-ref-integrity.ts` +
 * `check-ac-ref-integrity-core.ts`) splits into a pure algorithm module (no
 * `bun:sqlite` in its import graph, safe for a `vitest`-run test to import
 * directly) and an IO shell that imports `createApp` from `packages/lore/src/app.ts`
 * (which top-level-imports `bun:sqlite` — empirically confirmed elsewhere in this
 * repo to break vitest's module resolution EVEN behind a lazy `await import(...)`,
 * because vite-node's transform pipeline still tries to resolve the specifier).
 * This task's file anchors are exactly TWO files — this script and its test — with
 * no third `-core.ts` file permitted. So corpus reads here go through the `lore`
 * CLI itself as a subprocess (`node:child_process.spawnSync("bun", ["run",
 * <INDEX_TS>, ...])`, the SAME "source-entry" spawn shape
 * `packages/lore/tests/integration/cli/*.test.ts` already use) rather than
 * `createApp` in-process. That keeps this ONE file's import graph
 * (`node:fs`/`node:path`/`node:child_process`/`node:url` only) fully
 * vitest-resolvable, so the pure functions below are directly importable by
 * `packages/lore/tests/unit/service/unclaimed-oracle.test.ts` with zero fixture
 * corpus/subprocess involved.
 *
 * ## Algorithm
 *
 * 1. **Declared bindings** (`collectDeclaredAcCommands`, IO): enumerate every spec
 *    slug (`lore list --type spec --json`), then every spec's declared criteria
 *    (`lore ac list <slug> --json`) — the SAME accessor `lore ac list` humans use,
 *    never a raw `extra.acceptance_criteria` reach-in. For each `mode: "script"`
 *    criterion's `verify.command`, extract EVERY `(file, value)` pair: `value` is
 *    the whitespace-delimited TOKEN immediately following a bare `-t` /
 *    `--testNamePattern` / `--test-name-pattern` flag (or its `--flag=value` form),
 *    `file` is every token in the SAME command ending in `.test.ts(x)` /
 *    `.bun.test.ts`. Token-based, never `String.includes()` — see "Contiguous-substring
 *    guard" below.
 * 2. **Candidate universe** (`collectRepoTestFiles` + `extractTestNameValues`, IO +
 *    pure): every `packages/*\/tests/**\/*.test.ts(x)` and `scripts/**\/*.test.ts`
 *    file (mirrors `scripts/changed-tests.ts`'s own test-file universe) is scanned
 *    for `describe(...)`/`it(...)`/`test(...)` (optionally `.only`/`.skip`/`.todo`/
 *    `.concurrent`) string-literal names. A name is a CANDIDATE test-name-pattern
 *    value only if it is a bare kebab-case token (`^[a-z][a-z0-9]*(-[a-z0-9]+)+$`,
 *    i.e. >=1 hyphen) or ends in one after the LAST " — " (U+2014 em dash) — prose
 *    names are not candidates (see "Opt-in" below).
 * 3. **Cross-reference** (`findUnclaimedOracleValues`, pure): a candidate
 *    `(file, value)` pair reported unless it is present, EXACTLY, in the declared
 *    bindings set from step 1.
 *
 * ## Contiguous-substring guard
 *
 * Matching is exact-token equality on values extracted by SPLITTING each command
 * string on whitespace — never `command.includes(value)`. A naive substring check
 * would let a declared command carrying `-t orphan-token-extended` "launder" an
 * unrelated, narrower, genuinely-unclaimed `orphan-token` into looking bound, since
 * `"orphan-token-extended".includes("orphan-token")` is `true`. The test file for
 * this script asserts exactly this decoy does NOT suppress the finding.
 *
 * ## Three questions this mechanism must answer before it counts as built
 * (`adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the`)
 *
 * 1. **Proxy** — this checks whether a `(file, value)` pair extracted from a test
 *    file is ECHOED VERBATIM inside some declared command, never whether that
 *    command's OWN test suite actually resolves the flag to exactly (or even
 *    partially) that test. A concrete input that satisfies the proxy while
 *    violating the property: an AC's command still carries a stale token+file pair
 *    that once meant a specific test but was never updated when that test was
 *    renamed to something else entirely, while an UNRELATED test elsewhere in the
 *    same file coincidentally reuses the old token — this check reads it as
 *    "claimed" with no live intent connecting the two. Accepted: this mirrors M1's
 *    own accepted residual (falsified proves an oracle CAN fail, never that it
 *    fails on the RIGHT input) — this check proves "some declared command names
 *    this exact token+file pair", never that the command's test selection actually
 *    reaches that specific test.
 * 2. **Silence** — a corpus read failure, a failed `lore` subprocess invocation, or
 *    an unparseable JSON payload THROWS (`LoreInvocationError`, carrying the argv,
 *    exit code, and BOTH stdout and stderr — never discarded) rather than
 *    degrading to an empty finding set: "0 findings because verified clean" and "0
 *    findings because the scan never ran" must never be the same value. The report
 *    additionally always carries `scannedTestFiles` / `scannedCandidateValues` /
 *    `scannedDeclaredCommands` / `scannedClaimedBindings` alongside `findings`, so
 *    a caller can tell "this scanned nothing" from "this scanned everything and
 *    found nothing" — mirrors `check-ac-ref-integrity.ts`'s `scannedTasks` /
 *    `scannedAcRefRows` sanity floor.
 * 3. **Opt-in** — every repo test file under the established
 *    `packages/*\/tests/**` + `scripts/**` universe is scanned UNCONDITIONALLY, no
 *    per-file opt-in. But the token-EXTRACTION rule itself is a real Opt-in-shaped
 *    gap, named rather than hidden: only a bare kebab-case literal or an
 *    em-dash-suffixed kebab-case literal is treated as a candidate value. A test
 *    file naming its `-t`-selectable tests any other way (snake_case, a single
 *    plain word, camelCase) is INVISIBLE to this check. Accepted for this slice —
 *    it is exactly this repo's own established convention (every `-t`-bound AC
 *    command observed corpus-wide today names a kebab token).
 *
 * ## No exemption ledger
 *
 * `scripts/ac-ref-exemption-ledger.json`'s shape (audited, typed exemption rows
 * converting a detector failure into a justified pass) does not apply here: this
 * check never fails a build — it is REPORT-ONLY, no exit-code gating in this
 * slice (mirrors M1's own report-only non-goal: "Blocking on pass_unfalsified" was
 * explicitly rejected corpus-wide for the identical reason — an instant
 * back-catalogue violation with no written baseline). There is nothing to exempt
 * FROM; a written baseline for M3 findings, if wanted, is the surfacing task's
 * decision, not this check's.
 *
 * Public surface:
 *   - `extractTestNameValues` (pure) — candidate values from one test file's source.
 *   - `extractTestNamePatternValues` / `extractTestFilePaths` (pure) — flag-value /
 *     test-file-path tokens from one AC oracle command string.
 *   - `findUnclaimedOracleValues` (pure) — the full cross-reference, given an
 *     already-collected test-file list and an already-collected command list.
 *   - `collectRepoTestFiles` (IO) — reads every repo test file from disk.
 *   - `collectDeclaredAcCommands` (IO) — spawns the `lore` CLI (source-entry, never
 *     the compiled binary — no staleness risk) to enumerate every spec's declared
 *     script-mode oracle commands.
 *   - `runCheck` (IO) — collects both and cross-references; `main` (IO) — runs
 *     `runCheck`, prints a human report, returns the process exit code. Never calls
 *     `process.exit` itself.
 *
 * Exit codes:
 *   0 — the scan completed (regardless of how many unclaimed values it found —
 *       report-only, per the module header above).
 *   1 — the scan itself failed (corpus unreadable, `lore` subprocess failed, or its
 *       JSON payload did not parse).
 *
 * Usage:
 *   bun scripts/check-unclaimed-oracle.ts
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = join(__filename, "..", "..");

// ─── Pure: candidate test-name-pattern values present in a test file ───────

/**
 * Matches a `describe(...)`/`it(...)`/`test(...)` call (optionally
 * `.only`/`.skip`/`.todo`/`.concurrent`) whose first argument is a single quoted
 * string literal, capturing the literal's content (group 2; group 1 is the quote
 * character, so a literal may use `"`, `'`, or a backtick without needing to know
 * which up front). `describe.each(...)`/`it.each(...)` template calls are NOT
 * matched by design — their first argument is usually a table, not a name — a
 * named Opt-in residual (see module header).
 */
const TEST_NAME_LITERAL_RE =
  /\b(?:describe|it|test)(?:\.(?:only|skip|todo|concurrent))?\s*\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*)\1/g;

/** This repo's established describe-title separator (e.g. `"lintAcQuantifiability — false-positive-bound"`) — U+2014 EM DASH padded by plain spaces. */
const EM_DASH_SEPARATOR = " — ";

/** A bare kebab-case token: lowercase alnum segments joined by >=1 hyphen (e.g. `false-positive-bound`, `json-surfacing`, `unclaimed-oracle`). */
const KEBAB_TOKEN_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;

/**
 * Derives a candidate test-name-pattern value from one `describe`/`it`/`test`
 * literal, or `undefined` if the literal is prose (no candidate). See module
 * header step 2 for the extraction rule.
 */
function deriveCandidateValue(literal: string): string | undefined {
  const lastEmDash = literal.lastIndexOf(EM_DASH_SEPARATOR);
  if (lastEmDash !== -1) {
    const trailing = literal.slice(lastEmDash + EM_DASH_SEPARATOR.length).trim();
    return KEBAB_TOKEN_RE.test(trailing) ? trailing : undefined;
  }
  const trimmed = literal.trim();
  return KEBAB_TOKEN_RE.test(trimmed) ? trimmed : undefined;
}

/**
 * Every distinct candidate test-name-pattern value found in one test file's
 * source text (order of first appearance; deduplicated WITHIN this file — a
 * value repeated across `describe`/`it` blocks in the SAME file is one
 * candidate, not N).
 */
export function extractTestNameValues(content: string): string[] {
  const values: string[] = [];
  const seen = new Set<string>();
  for (const match of content.matchAll(TEST_NAME_LITERAL_RE)) {
    const literal = match[2] ?? "";
    const candidate = deriveCandidateValue(literal);
    if (candidate !== undefined && !seen.has(candidate)) {
      seen.add(candidate);
      values.push(candidate);
    }
  }
  return values;
}

// ─── Pure: flag/value/file-path token extraction from an AC oracle command ─

const TEST_NAME_PATTERN_FLAGS = new Set(["-t", "--testNamePattern", "--test-name-pattern"]);
const TEST_NAME_PATTERN_EQ_RE = /^(--testNamePattern|--test-name-pattern)=(.+)$/;
/** Matches a token ending in this repo's test-file naming convention — `.test.ts`, `.test.tsx`, or `.bun.test.ts` (a suffix of `.test.ts`, matched by the same regex). */
const TEST_FILE_TOKEN_RE = /\.(?:bun\.)?test\.tsx?$/;

function stripQuotes(token: string): string {
  if (
    token.length >= 2 &&
    ((token[0] === '"' && token[token.length - 1] === '"') ||
      (token[0] === "'" && token[token.length - 1] === "'"))
  ) {
    return token.slice(1, -1);
  }
  return token;
}

/**
 * Every `-t` / `--testNamePattern` / `--test-name-pattern` VALUE in `command`,
 * matched by splitting on whitespace and checking EXACT token equality against
 * the three flag spellings (never `command.includes(flag)`) — see module header
 * "Contiguous-substring guard".
 */
export function extractTestNamePatternValues(command: string): string[] {
  const tokens = command.trim().split(/\s+/);
  const values: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i] ?? "";
    if (TEST_NAME_PATTERN_FLAGS.has(raw)) {
      const next = tokens[i + 1];
      if (next !== undefined) values.push(stripQuotes(next));
      continue;
    }
    const eq = TEST_NAME_PATTERN_EQ_RE.exec(raw);
    if (eq) values.push(stripQuotes(eq[2] ?? ""));
  }
  return values;
}

/** A git pathspec-magic prefix (`:!`, `:^`, `:(`): the path after it is EXCLUDED, so it is never an oracle's owner file. */
const GIT_PATHSPEC_MAGIC_RE = /^:[!^(]/;

/** Every whitespace-delimited token in `command` that names a test file under this repo's `.test.ts(x)` / `.bun.test.ts` convention. */
export function extractTestFilePaths(command: string): string[] {
  return command
    .trim()
    .split(/\s+/)
    .map(stripQuotes)
    .filter((t) => !GIT_PATHSPEC_MAGIC_RE.test(t) && TEST_FILE_TOKEN_RE.test(t));
}

// ─── Pure: cross-reference ──────────────────────────────────────────────────

/** One repo test file's source, as fed to {@link findUnclaimedOracleValues} — `collectRepoTestFiles` produces these from disk; a test fixture builds them in-memory instead. */
export interface TestFileContent {
  /** Repo-relative posix path (e.g. `packages/core/tests/unit/ac-quality.test.ts`). */
  readonly path: string;
  readonly content: string;
}

/** One test-name-pattern value that is present in `file`'s source but bound by NO declared acceptance criterion's `verify.command`. */
export interface UnclaimedOracleFinding {
  readonly file: string;
  readonly value: string;
}

/** One `findUnclaimedOracleValues` run's full result — scan counts (the Silence-loud sanity floor, module header Q2) plus the findings themselves. */
export interface UnclaimedOracleReport {
  readonly scannedTestFiles: number;
  readonly scannedCandidateValues: number;
  readonly scannedDeclaredCommands: number;
  readonly scannedClaimedBindings: number;
  readonly findings: readonly UnclaimedOracleFinding[];
}

/** Composes a Set key from a `(file, value)` pair, joined by a literal newline — neither a repo-relative posix path nor a kebab-case candidate value can contain one, so this can never collide two distinct pairs into the same key. */
function claimKey(file: string, value: string): string {
  return `${file}\n${value}`;
}

/**
 * Cross-references every candidate test-name-pattern value found in `testFiles`
 * against every `(file, value)` binding declared by `declaredCommands` (each a
 * raw `verify.command` string from a script-mode acceptance criterion). A
 * candidate is reported unless its EXACT `(file, value)` pair is present in the
 * declared set — see module header for the full algorithm and the
 * contiguous-substring guard.
 */
export function findUnclaimedOracleValues(
  testFiles: readonly TestFileContent[],
  declaredCommands: readonly string[],
): UnclaimedOracleReport {
  const claimed = new Set<string>();
  for (const command of declaredCommands) {
    const files = extractTestFilePaths(command);
    const values = extractTestNamePatternValues(command);
    if (files.length === 0 || values.length === 0) continue;
    for (const f of files) {
      for (const v of values) claimed.add(claimKey(f, v));
    }
  }

  let scannedCandidateValues = 0;
  const findings: UnclaimedOracleFinding[] = [];
  for (const tf of testFiles) {
    for (const value of extractTestNameValues(tf.content)) {
      scannedCandidateValues += 1;
      if (!claimed.has(claimKey(tf.path, value))) {
        findings.push({ file: tf.path, value });
      }
    }
  }

  return {
    scannedTestFiles: testFiles.length,
    scannedCandidateValues,
    scannedDeclaredCommands: declaredCommands.length,
    scannedClaimedBindings: claimed.size,
    findings,
  };
}

// ─── IO: repo test-file collection ──────────────────────────────────────────

/** Recursively collects repo-relative posix paths under `dir` (relative to `repoRoot`) whose basename matches `matches`. Skips `node_modules` and dotfile directories — mirrors `scripts/changed-tests.ts`'s own `walkDir`. */
function walkDir(repoRoot: string, dir: string, matches: (relPath: string) => boolean, out: string[]): void {
  const entries = readdirSync(join(repoRoot, dir), { withFileTypes: true });
  for (const entry of entries) {
    const relPath = posix.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      walkDir(repoRoot, relPath, matches, out);
      continue;
    }
    if (entry.isFile() && matches(relPath)) out.push(relPath);
  }
}

const IS_TEST_FILE_RE = /\.test\.tsx?$/;

/**
 * Reads every `packages/*\/tests/**\/*.test.ts(x)` file and every
 * `scripts/**\/*.test.ts` file under `repoRoot` (mirrors
 * `scripts/changed-tests.ts`'s own test-file universe) into a `TestFileContent`
 * list, keyed by repo-relative posix path.
 */
export function collectRepoTestFiles(repoRoot: string): TestFileContent[] {
  const paths: string[] = [];
  const packagesDir = join(repoRoot, "packages");
  if (existsSync(packagesDir)) {
    for (const pkg of readdirSync(packagesDir, { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue;
      const testsDir = posix.join("packages", pkg.name, "tests");
      if (existsSync(join(repoRoot, testsDir))) {
        walkDir(repoRoot, testsDir, (p) => IS_TEST_FILE_RE.test(p), paths);
      }
    }
  }
  const scriptsDir = "scripts";
  if (existsSync(join(repoRoot, scriptsDir))) {
    walkDir(repoRoot, scriptsDir, (p) => IS_TEST_FILE_RE.test(p), paths);
  }

  return paths.map((path) => ({ path, content: readFileSync(join(repoRoot, path), "utf8") }));
}

// ─── IO: declared-AC-command collection (subprocess — see module header) ───

/**
 * Thrown when a `lore` subprocess invocation fails to run, exits non-zero, or
 * returns unparseable/unexpectedly-shaped JSON — a scan-level failure, LOUD by
 * construction (module header Q2, Silence): never degrades to an empty result.
 * Carries the full argv, exit code, and BOTH stdout and stderr — never discarded.
 */
export class LoreInvocationError extends Error {
  constructor(
    public readonly argv: readonly string[],
    public readonly exitCode: number,
    public readonly stdout: string,
    public readonly stderr: string,
  ) {
    super(
      `check-unclaimed-oracle: \`bun run ${argv.join(" ")}\` failed (exit ${exitCode}): ${stderr || stdout || "(no output)"}`,
    );
    this.name = "LoreInvocationError";
  }
}

/**
 * The two `lore` JSON response shapes this script depends on, narrowed to
 * exactly the fields read (never the full corpus doc shape — those live in
 * `@lore/core`, which this file deliberately never imports, see module
 * header). Boundary data crossing the subprocess pipe is parsed through
 * these, never duck-typed inline — a shape drift in either command fails
 * loud (`LoreInvocationError`, naming the zod issue) instead of silently
 * reading `undefined` fields as "no bindings".
 */
const LoreListSpecResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    docs: z.array(z.object({ slug: z.string() })),
  }),
});

const LoreAcListResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    criteria: z.array(
      z.object({
        verify: z
          .object({
            mode: z.string().optional(),
            command: z.string().optional(),
          })
          .optional(),
      }),
    ),
  }),
});

/**
 * Spawns `bun run <indexTsPath> ...args` in `repoRoot`, parses its stdout as
 * JSON, and validates it against `schema` — the SAME "source-entry" spawn
 * shape `packages/lore/tests/integration/cli/*.test.ts` already establish
 * (never the compiled `dist/lore` binary — no staleness risk, no pre-build
 * step needed). `maxBuffer` is set explicitly (64 MiB) per this task's own
 * context digest: the default 1 MiB `spawnSync` buffer silently truncates a
 * growing `--json` payload. `stderr` is always folded into a thrown
 * `LoreInvocationError` on failure — never discarded.
 */
function runLoreJson<T extends z.ZodTypeAny>(
  repoRoot: string,
  indexTsPath: string,
  args: readonly string[],
  schema: T,
): z.infer<T> {
  const argv = [indexTsPath, ...args];
  const result = spawnSync("bun", ["run", ...argv], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    throw new LoreInvocationError(argv, -1, "", result.error.message);
  }
  const status = result.status ?? -1;
  if (status !== 0) {
    throw new LoreInvocationError(argv, status, result.stdout ?? "", result.stderr ?? "");
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(result.stdout);
  } catch (e) {
    throw new LoreInvocationError(
      argv,
      status,
      result.stdout ?? "",
      `JSON parse failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const validated = schema.safeParse(parsedJson);
  if (!validated.success) {
    throw new LoreInvocationError(
      argv,
      status,
      result.stdout ?? "",
      `unexpected response shape: ${validated.error.message}`,
    );
  }
  return validated.data;
}

/**
 * Enumerates every spec's declared script-mode oracle commands via the `lore`
 * CLI: `lore list --type spec --json` for slugs, then `lore ac list <slug>
 * --json` per spec — the SAME accessor humans use (`lore ac list`), never a raw
 * `extra.acceptance_criteria` reach-in. A spec with zero declared criteria
 * returns `{ criteria: [] }` (exit 0, not an error — `commands/ac.ts`'s own
 * `listCriteria` contract), contributing nothing; this is the expected common
 * case, not a scan failure.
 */
export function collectDeclaredAcCommands(repoRoot: string, indexTsPath: string): string[] {
  const listOut = runLoreJson(
    repoRoot,
    indexTsPath,
    ["list", "--type", "spec", "--json"],
    LoreListSpecResponseSchema,
  );

  const commands: string[] = [];
  for (const doc of listOut.data.docs) {
    const acOut = runLoreJson(
      repoRoot,
      indexTsPath,
      ["ac", "list", doc.slug, "--json"],
      LoreAcListResponseSchema,
    );
    for (const criterion of acOut.data.criteria) {
      if (criterion.verify?.mode === "script" && typeof criterion.verify.command === "string") {
        commands.push(criterion.verify.command);
      }
    }
  }
  return commands;
}

// ─── IO: orchestration + CLI entrypoint ─────────────────────────────────────

/** Collects both inputs and cross-references them — the seam tests could inject fixtures through, mirroring `check-ac-ref-integrity.ts::runCheck`'s pattern (not exercised by this task's own test, which calls {@link findUnclaimedOracleValues} directly with in-memory fixtures per this task's ⛔ no-live-corpus-in-tests rule). */
export function runCheck(repoRoot: string, indexTsPath: string): UnclaimedOracleReport {
  const testFiles = collectRepoTestFiles(repoRoot);
  const declaredCommands = collectDeclaredAcCommands(repoRoot, indexTsPath);
  return findUnclaimedOracleValues(testFiles, declaredCommands);
}

/**
 * Resolves `repoRoot`/`indexTsPath` (unless overridden — tests would pass a
 * throwaway fixture tree, never this repo's own live corpus), runs
 * {@link runCheck}, prints a human-readable report, and returns the process
 * exit code. Never calls `process.exit` itself — the `import.meta.main` block
 * below is the only place that does.
 */
export function main(repoRootOverride?: string, indexTsPathOverride?: string): number {
  const repoRoot = repoRootOverride ?? REPO_ROOT;
  const indexTsPath = indexTsPathOverride ?? join(repoRoot, "packages", "lore", "src", "index.ts");

  const report = runCheck(repoRoot, indexTsPath);

  console.log(
    `check-unclaimed-oracle: scanned ${report.scannedTestFiles} test file(s), ${report.scannedCandidateValues} candidate test-name-pattern value(s), ${report.scannedDeclaredCommands} declared script-mode AC command(s) (${report.scannedClaimedBindings} claimed binding(s)).`,
  );

  if (report.findings.length === 0) {
    console.log("check-unclaimed-oracle: OK — 0 unclaimed test-name-pattern value(s).");
    return 0;
  }

  console.log(
    `\ncheck-unclaimed-oracle: ${report.findings.length} unclaimed test-name-pattern value(s) — present in a test file, bound by NO declared acceptance criterion:\n`,
  );
  for (const f of report.findings) {
    console.log(`  file="${f.file}" value="${f.value}"`);
  }
  console.log(
    "\nThis is how a silently WITHDRAWN AC binding becomes visible: the test still passes, and " +
      "nothing else says the criterion that used to own it is gone. Report-only — nothing blocks " +
      "(M3, adr-falsifiability-moves-from-the-task-tier-to-the-oracle-tier). Either re-bind the " +
      "value under a live AC's `verify.command`, or leave it — a report-only finding never gates.",
  );
  return 0;
}

if (import.meta.main) {
  try {
    process.exit(main());
  } catch (e) {
    console.error(`check-unclaimed-oracle: scan failed — ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
