#!/usr/bin/env bun
/**
 * Structural test-budget oracle (`bun run check:test-budgets`) —
 * `spec-a-test-case-s-timeout-budget-must-be-declared-when-its`.
 *
 * Purpose: a test case that spawns the compiled `lore` binary (or any real
 * subprocess) many times while relying on the runner's DEFAULT timeout
 * budget converts machine load into a phantom regression (measured incident:
 * `cli-plan-promote-advisory.bun.test.ts`'s AC-VRW-5b case timed out at the
 * bun:test default 5000ms under load, 3/3 green in isolation). This script
 * scans test SOURCE (never runs anything) and fails loud whenever a single
 * `it(...)`/`test(...)` body calls a "spawn helper" (see below) at or above
 * `SPAWN_THRESHOLD` times without declaring an explicit third-argument
 * timeout (`it(name, fn, 10000)` or `it(name, fn, { timeout: 10000 })`).
 *
 * Public surface: `scanFile` (pure — given a repo-relative path and its
 * source text, returns the violations found in THAT file), `scanRepoTree`
 * (IO — walks `packages/**` for `.test.ts` / `.bun.test.ts` files and
 * `scanFile`s each one; the SAME computation `main` uses internally, exposed
 * so a caller other than the CLI entrypoint — e.g. the ledger migration
 * script, `scripts/migrate-test-budget-ledger-to-title-fingerprint.ts` — can
 * derive a violation's CURRENT title/spawnCount by actually running this
 * oracle, never by hand-transcribing it), `checkLedger` (pure — cross-checks
 * a scan's violations against the exemption ledger), `parseLedgerFile` (pure
 * — validates ledger JSON against its Zod schema), and `main` (IO — calls
 * `scanRepoTree`, loads the ledger from disk, and reports). `TestBudgetParseError`
 * is the typed failure for source this script cannot lexically parse —
 * thrown, never swallowed (D5: parse failure is loud). `TestBudgetLedgerError`
 * is the typed failure for a ledger file this script cannot load or validate.
 * `TestBudgetFingerprintCollisionError` is the typed failure for two
 * violations in one file sharing an identical title+spawnCount fingerprint
 * (see "Why the key is a title fingerprint, not a line" below).
 *
 * Side-effect class: `scanFile`, `checkLedger`, and `parseLedgerFile` are
 * pure (no IO). `scanRepoTree` and `main` read files from disk (test
 * sources + the ledger); `main` also writes to stdout/stderr. The
 * `import.meta.main` guard below is the CLI entrypoint; nothing at module
 * scope has a side effect, so this file is safe to `import` from a test for
 * direct, subprocess-free unit coverage (see
 * `scripts/tests/check-test-budgets.test.ts`).
 *
 * ## Baseline + exemption ledger (`adr-a-newly-armed-structural-oracle-enforces-from-a-baseline`)
 *
 * This oracle armed with **58 pre-existing violations already in the tree**
 * (measured at ledger-landing time, task
 * `task-land-the-baseline-ledger-policy-for-check-test-budgets-55` — the
 * task's own title cites an earlier, now-stale count of 55; the ADR's three
 * criteria apply regardless of the exact number). Requiring a tree-wide
 * exit 0 as this oracle's landing bar would have meant either fabricating
 * 58 timeout values nobody measured, or leaving the check permanently red
 * (both rejected by the ADR — see its Alternatives table). Instead:
 *
 *   1. **Baseline-scoped enforcement**: every violation present at
 *      ledger-landing time is recorded in `scripts/test-budget-ledger.json`
 *      (`LEDGER_RELATIVE_PATH`) with its measured `path`/`titleFingerprint`/
 *      `spawnCount` plus a `reason` (and `line`, kept only as a
 *      non-authoritative diagnostic hint — see "Why the key is a title
 *      fingerprint, not a line" below). `checkLedger` partitions each scan's
 *      violations into `newViolations` (NOT in the ledger — new debt, always
 *      fails) and the ledger-covered rest (exempted). A violation is "in the
 *      ledger" iff a ledger entry's `(path, titleFingerprint)` matches AND
 *      its recorded `spawnCount` equals the violation's CURRENT spawn count
 *      — an exact match on BOTH, not a fuzzy one and not path-alone, so a
 *      test whose body genuinely changed (a different spawn count) forces a
 *      ledger update rather than silently continuing to exempt a
 *      since-drifted violation.
 *   2. **The ledger is DATA the oracle reads** (JSON, Zod-validated via
 *      `parseLedgerFile`), never a `--exclude` glob buried in this script —
 *      auditable, diffable, and impossible to silently widen.
 *   3. **Ledger completeness is asserted**: a ledger row whose `(path,
 *      titleFingerprint, spawnCount)` no longer matches any current
 *      violation (`orphanedEntries`) or whose `path` no longer exists on
 *      disk (`missingPathEntries`) makes this oracle exit non-zero, NAMING
 *      the offending row — the fail-loud control that stops the ledger from
 *      quietly outliving the debt it describes and becoming an unaudited
 *      suppression list. Retiring a violation (adding an explicit timeout)
 *      therefore REQUIRES removing its ledger row in the same commit; this
 *      is the ADR's documented, deliberate consequence, not a defect.
 *
 * The historical baseline commit is `48d3dbc` (recorded as `baseline_commit`
 * in the ledger file, for provenance only — the oracle itself never computes
 * a git diff against it; the ledger's CONTENT, not a git ref, is what defines
 * "already accounted for").
 *
 * ## Why the key is a title fingerprint, not a line
 * (`task-key-test-budget-ledger-rows-on-a-test-title-fingerprint`,
 * `knowledge-file-level-anchor-mutex-does-not-prevent-one-agent-s`)
 *
 * The ledger originally keyed each row on `(path, line, spawnCount)`. A
 * ledger's OWNER declares `file_anchors` on the files it EDITS, never on the
 * files its DATA merely cites — so a pure line-insertion by an unrelated,
 * fully-disjoint concurrent session anywhere ABOVE a ledgered test shifted
 * that test's line and broke the row, with zero git conflict and zero
 * anchor overlap. This happened three times in ~24 hours (see the task and
 * knowledge doc above for the incident log) and is mechanical, not
 * accidental: a `line` is an accident of file layout, not the test's
 * identity. The test's TITLE is its identity — `scanFile` already extracts
 * it (`Violation.title`) as a human-readable string for every violation it
 * reports, so no new extraction machinery was needed, only a different key.
 *
 * The fingerprint is the **raw, verbatim title string** — no hash, no
 * normalization. A hash would make `git diff` on the ledger opaque (an
 * auditor sees a 64-hex-char change with no way to tell what test it
 * describes); the raw title is already an exact, stable key precisely
 * because both the ledger-writer and the ledger-reader derive it via the
 * SAME `scanFile` extraction path (masked-source, quote-stripped), so there
 * is no whitespace/casing drift to normalize away. `spawnCount` remains part
 * of the compound key (never dropped to "path + title only, any count") —
 * criterion 3 above still requires an exact match, and the credit the
 * knowledge doc gives this oracle for refusing to re-exempt by path alone
 * stays true of the title-keyed form too, now doubly so: title alone would
 * already usually disambiguate, but `spawnCount` still gates a same-titled
 * test whose BODY changed shape.
 *
 * `line` is retained in the schema purely as a diagnostic hint for humans
 * skimming the ledger (kept fresh at migration time) — it is NEVER read by
 * `checkLedger`'s matching logic. Two test cases with the byte-identical
 * title string in the same file are legal in both runners and would make a
 * bare `(path, title)` key ambiguous; `checkLedger` therefore requires
 * `(path, title, spawnCount)` to be collision-free across the CURRENT scan
 * and throws `TestBudgetFingerprintCollisionError` (loud, deterministic —
 * never "first match wins") the moment two violations in the same file
 * share both title AND spawn count, before any ledger matching is
 * attempted. See `findFirstFingerprintCollision` and its tests.
 *
 * ## D1 — declaration, never the number
 *
 * At or above the threshold, this oracle only requires an explicit timeout
 * ARGUMENT to be present — it never inspects or judges the value. Fixing a
 * violation means adding a third argument of ANY value; raising the value
 * later is a separate, un-gated decision.
 *
 * ## Algorithm (lexical, not a real AST — deliberate, see D1/Option 1 in the
 * governing spec: "lexical counting cannot see a spawn hidden behind an
 * indirection; accepted, because the threshold only needs to catch the
 * DIRECT multi-spawn shape that actually caused this")
 *
 *   1. `maskCommentsAndStrings` replaces every comment body, every
 *      string/template-literal body, AND every regex-literal body with
 *      spaces (same length, newlines preserved) so downstream
 *      bracket-matching and identifier regexes never trip on a stray `)`
 *      inside a comment/string, or a stray `(`/`)`/`{`/`}` inside a regex
 *      pattern (measured incident: `expect(source).not.toMatch(/\.generate\(/)`
 *      in `oracle-coverage-gate.test.ts` — the escaped `\(` was originally
 *      miscounted as a real unmatched open-paren before regex-literal
 *      masking was added). Regex-vs-division disambiguation is a heuristic
 *      (`isRegexContextBefore` — the preceding significant token, not a
 *      real parser) and a regex spanning a raw newline (illegal in JS/TS
 *      anyway) falls back to treating its `/` as an ordinary character
 *      rather than a mis-scan; either way, a genuinely ambiguous file
 *      surfaces as a loud parse failure (never a silent miscount) via the
 *      balance check below.
 *   2. `assertBalancedBrackets` walks the masked text once per bracket type
 *      ('()', '{}', '[]') tracking depth; a premature close (depth goes
 *      negative) or a nonzero depth at EOF means the file is NOT valid
 *      JS/TS — thrown immediately, naming the file, before any per-test
 *      parsing is attempted. This is what makes AC-TB-5 loud: a locally
 *      mismatched bracket that "coincidentally" totals even (e.g. a missing
 *      close compensated for by a missing corresponding open elsewhere)
 *      would NOT be caught by a naive global-count check, so the guard
 *      trips on true structural imbalance, not merely "same totals".
 *   3. `findSpawnHelperNames` finds every top-level-ish `function name(...)`
 *      / `const name = (...) => {...}` / `const name = function (...) {...}`
 *      declaration in the file (bracket-matched, TS-return-type-aware via a
 *      "double brace" peek: if the first `{...}` found after the parameter
 *      list is immediately followed by another `{`, the first was an
 *      object-type return annotation, not the body) and adds its name to the
 *      helper set iff its OWN body directly calls `Bun.spawnSync`/`Bun.spawn`
 *      or a name imported from `node:child_process`/`child_process`
 *      (`spawnSync`, `execFileSync`, `execSync`, `spawn`, `fork`, aliased or
 *      not). This is intentionally ONE level deep — a helper that wraps
 *      another helper (e.g. `createPrd` wrapping `runLore`) is NOT chased,
 *      matching the spec's accepted indirection blind spot. The reported
 *      incident is still caught because the offending test body calls the
 *      level-1 helper (`runLore`) directly >= 3 times.
 *   4. For every `it(...)`/`test(...)`/`it.only(...)`/`test.skip(...)`/...
 *      call (`.each` chains are OUT OF SCOPE — `it.each(table)(...)` doesn't
 *      textually start with `it(`/`test(` immediately followed by `(`, so it
 *      never matches; documented gap, not a silent one, since it simply
 *      contributes zero violations rather than a wrong count), the ENTIRE
 *      argument list is isolated via paren-depth matching from the call's
 *      own opening paren, then split into top-level arguments (comma at
 *      paren/brace/bracket depth 0 relative to the arg list). Because
 *      splitting runs over the MASKED text, a comma embedded in the test
 *      title string can never be mistaken for an argument separator.
 *        - args[0] is the title — read from the ORIGINAL (unmasked) source
 *          so the reported title is human-readable; a non-string-literal
 *          title (computed name) is skipped, not a fatal parse error.
 *        - args[1] is the callback — its masked text is scanned for direct
 *          call-sites of any spawn-helper/primitive name.
 *        - args[2], if present (and non-blank — a bare trailing comma is
 *          not a real argument) IS the explicit timeout declaration. Its
 *          CONTENT is never inspected (D1): presence alone satisfies the
 *          oracle.
 *
 * Exit codes:
 *   0 — no violations, no parse failures, and the ledger itself is clean
 *       (every row still matches a real violation at an existing path).
 *   2 — >=1 test case spawns >= SPAWN_THRESHOLD times without an explicit
 *       timeout argument AND is not covered by the exemption ledger (new
 *       debt introduced beyond the recorded baseline).
 *   3 — >=1 test file could not be parsed (takes priority over everything
 *       else — an unparseable file must never read as merely "no violations
 *       found", and a partial scan is never cross-checked against the ledger).
 *   4 — the scan itself failed outside a single file's parse (e.g. the
 *       `packages/` directory is unreadable, the ledger file is missing /
 *       malformed / fails Zod validation — `TestBudgetLedgerError` — or two
 *       violations in the same file share an identical `(title, spawnCount)`
 *       fingerprint, making title-keyed ledger matching ambiguous —
 *       `TestBudgetFingerprintCollisionError`, see "Why the key is a title
 *       fingerprint, not a line" above).
 *   5 — the exemption ledger itself is unsound: >=1 row no longer matches a
 *       real violation (`orphanedEntries` — since rows now key on the
 *       test's TITLE rather than its line, this means the test case was
 *       actually renamed, removed, or fixed — never merely that an
 *       unrelated insertion shifted its line) or names a path that no
 *       longer exists (`missingPathEntries`). This is criterion 3's
 *       fail-loud control — see the module header's "Baseline + exemption
 *       ledger" section.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** Threshold is 3 direct spawn-helper calls in one test body (spec D2 — two spawns fit the default budget comfortably; three is where the observed failure lives). */
export const SPAWN_THRESHOLD = 3;

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = join(__filename, "..", "..");

/**
 * Thrown when a test file's source cannot be lexically parsed by this
 * oracle (unbalanced brackets, or a bracket-matching scan running off the
 * end of the file). Carries the offending file's repo-relative path so
 * callers can report it — never a silent skip (spec D5).
 */
export class TestBudgetParseError extends Error {
  constructor(
    public readonly file: string,
    reason: string,
  ) {
    super(`cannot parse ${file}: ${reason}`);
    this.name = "TestBudgetParseError";
  }
}

/** One offending test case: spawns >= SPAWN_THRESHOLD times, no explicit timeout argument. */
export interface Violation {
  readonly file: string;
  readonly title: string;
  readonly line: number;
  readonly spawnCount: number;
}

// ─────────────────────────────────────────────────────────────────────────
// Baseline exemption ledger (adr-a-newly-armed-structural-oracle-enforces-from-a-baseline)
// ─────────────────────────────────────────────────────────────────────────

/** Repo-relative path to the exemption ledger — DATA the oracle reads (module header §Baseline + exemption ledger), never a suppression list embedded in this script. */
export const LEDGER_RELATIVE_PATH = "scripts/test-budget-ledger.json";

/**
 * One recorded exemption: a violation present at ledger-landing time, with
 * its measured identity/quantity and why it is exempt.
 *
 * `titleFingerprint` + `spawnCount` are the ONLY fields `checkLedger` uses to
 * match a row against a current violation (see the module header's "Why the
 * key is a title fingerprint, not a line"). `line` is REQUIRED so every row
 * stays human-auditable at write time, but it is a non-authoritative
 * diagnostic hint only — matching never reads it, so an unrelated insertion
 * shifting it can never break this row. A row missing `titleFingerprint`
 * fails this schema loudly (Zod `min(1)`), never silently matching nothing.
 */
const TestBudgetLedgerEntrySchema = z.object({
  path: z.string().min(1),
  titleFingerprint: z.string().min(1),
  spawnCount: z.number().int().positive(),
  /** Diagnostic hint only — see the field-level note above. Never read by `checkLedger`. */
  line: z.number().int().positive(),
  reason: z.string().min(1),
});

/** Derived TypeScript type for one ledger row — see `TestBudgetLedgerEntrySchema` (Zod is the SSOT, this is inferred, never hand-duplicated). */
export type TestBudgetLedgerEntry = z.infer<typeof TestBudgetLedgerEntrySchema>;

/** The whole ledger file's shape: provenance metadata (`baseline_commit`, informational only — see module header) plus the entry list `checkLedger` actually reads. */
const TestBudgetLedgerFileSchema = z.object({
  baseline_commit: z.string().min(1),
  entries: z.array(TestBudgetLedgerEntrySchema),
});

/** Derived TypeScript type for the whole ledger file. */
export type TestBudgetLedgerFile = z.infer<typeof TestBudgetLedgerFileSchema>;

/**
 * Thrown when the exemption ledger cannot be loaded or fails Zod validation
 * — a config-level failure, distinct from a per-file `TestBudgetParseError`
 * and from a per-row `orphanedEntries`/`missingPathEntries` finding (those
 * are reported by `checkLedger`, not thrown; the ledger file ITSELF being
 * absent, unreadable, invalid JSON, or schema-invalid is a harder failure
 * that blocks the scan entirely — see exit code 4 in the module header).
 */
export class TestBudgetLedgerError extends Error {
  constructor(
    public readonly code: "not_found" | "invalid_json" | "schema",
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "TestBudgetLedgerError";
  }
}

/**
 * Thrown by `checkLedger` when two or more scanned violations in the SAME
 * file share an identical `(titleFingerprint, spawnCount)` pair — a
 * title-keyed ledger cannot tell them apart, and this oracle refuses to
 * resolve the ambiguity implicitly ("first match wins" would be a silent,
 * nondeterministic fallback, exactly what D5/AC-5 forbid). Two `it()`/
 * `test()` cases with the byte-identical title ARE legal in both runners —
 * this is not a parse error — but they must be given distinct titles (or a
 * different spawn-call count) before this oracle can key a ledger row to
 * either one specifically.
 */
export class TestBudgetFingerprintCollisionError extends Error {
  constructor(
    public readonly file: string,
    public readonly titleFingerprint: string,
    public readonly spawnCount: number,
    public readonly occurrences: number,
  ) {
    super(
      `${file}: ${occurrences} test cases share the identical title "${titleFingerprint}" and spawnCount ${spawnCount} — ` +
        `a ledger keyed on (path, titleFingerprint, spawnCount) cannot disambiguate them. Rename one of the it()/test() ` +
        `titles (or change one case's spawn-call count) so each has a distinct (title, spawnCount) pair within this file.`,
    );
    this.name = "TestBudgetFingerprintCollisionError";
  }
}

/**
 * Parses and Zod-validates raw ledger file content. Pure (no IO) — the IO
 * shell is `loadLedgerFromDisk`, below.
 *
 * @throws {TestBudgetLedgerError} `code: "invalid_json"` if `raw` is not
 *   valid JSON; `code: "schema"` if it parses but fails
 *   `TestBudgetLedgerFileSchema` (e.g. a row missing `titleFingerprint` or
 *   `reason`, or a non-positive `line`/`spawnCount`).
 */
export function parseLedgerFile(raw: string): TestBudgetLedgerFile {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new TestBudgetLedgerError("invalid_json", `ledger file is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const parsed = TestBudgetLedgerFileSchema.safeParse(json);
  if (!parsed.success) {
    throw new TestBudgetLedgerError("schema", `ledger file failed schema validation: ${parsed.error.message}`, {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

/**
 * Reads and validates the ledger file at `<repoRoot>/${LEDGER_RELATIVE_PATH}`.
 * The only IO wrapper around `parseLedgerFile`.
 *
 * @throws {TestBudgetLedgerError} `code: "not_found"` if the file cannot be
 *   read (missing, permissions); otherwise propagates `parseLedgerFile`'s errors.
 */
export function loadLedgerFromDisk(repoRoot: string): TestBudgetLedgerFile {
  const ledgerPath = join(repoRoot, LEDGER_RELATIVE_PATH);
  let raw: string;
  try {
    raw = readFileSync(ledgerPath, "utf8");
  } catch (e) {
    throw new TestBudgetLedgerError(
      "not_found",
      `ledger file not found at ${LEDGER_RELATIVE_PATH}: ${e instanceof Error ? e.message : String(e)}`,
      { path: ledgerPath },
    );
  }
  return parseLedgerFile(raw);
}

/** Result of cross-checking a scan's `Violation[]` against the ledger's entries — the three buckets `main` reports and exits on. */
export interface LedgerCheckResult {
  /** Scanned violations with NO matching ledger entry — new debt, always fails (exit 2). */
  readonly newViolations: readonly Violation[];
  /** Ledger rows whose path exists but no longer match a real violation at that exact `(path, titleFingerprint, spawnCount)` — renamed, removed, or fixed (exit 5). */
  readonly orphanedEntries: readonly TestBudgetLedgerEntry[];
  /** Ledger rows whose `path` does not exist at all (exit 5). */
  readonly missingPathEntries: readonly TestBudgetLedgerEntry[];
}

/**
 * Composite matching key: `path` + `titleFingerprint` + `spawnCount` — see
 * the module header's "Why the key is a title fingerprint, not a line".
 * `line` deliberately never participates. Joined with ` ` (a byte that
 * cannot appear in a JS/TS test title or a repo-relative path) rather than a
 * printable delimiter like `:`, because a title is free text and could
 * legitimately contain a colon (e.g. `"handles path a:b:3"`) — a printable
 * delimiter risks a coincidental cross-field collision that ` ` cannot.
 */
const ledgerKey = (path: string, titleFingerprint: string, spawnCount: number): string => `${path} ${titleFingerprint} ${spawnCount}`;

/**
 * Scans `violations` for two or more entries in the SAME file sharing an
 * identical `(titleFingerprint, spawnCount)` pair — the one shape a
 * title-keyed ledger cannot disambiguate (AC-5: duplicate `it()`/`test()`
 * titles are legal source, not a parse error, but they break exact-match
 * ledger keying). Returns the FIRST such collision found, in scan order
 * (deterministic — never "first match wins" silently, this is surfaced as a
 * loud, named failure instead by the caller).
 */
function findFirstFingerprintCollision(
  violations: readonly Violation[],
): { file: string; titleFingerprint: string; spawnCount: number; occurrences: number } | undefined {
  const seen = new Map<string, { file: string; titleFingerprint: string; spawnCount: number; occurrences: number }>();
  for (const v of violations) {
    const key = ledgerKey(v.file, v.title, v.spawnCount);
    const existing = seen.get(key);
    if (existing) {
      existing.occurrences += 1;
    } else {
      seen.set(key, { file: v.file, titleFingerprint: v.title, spawnCount: v.spawnCount, occurrences: 1 });
    }
  }
  for (const group of seen.values()) {
    if (group.occurrences > 1) return group;
  }
  return undefined;
}

/**
 * Cross-checks `violations` (a full repo-tree scan) against the ledger's
 * `entries`. Pure — `pathExists` is injected so this stays unit-testable
 * without touching disk (the IO caller in `main` passes
 * `(p) => existsSync(join(repoRoot, p))`).
 *
 * A ledger entry EXEMPTS a violation iff `(entry.path, entry.titleFingerprint,
 * entry.spawnCount)` matches `(violation.file, violation.title,
 * violation.spawnCount)` exactly — an exact match on both title AND spawn
 * count, never path-alone and never "same title, any count": see the module
 * header's "Why the key is a title fingerprint, not a line" for why a
 * drifted spawn count must re-open the row rather than silently keep
 * exempting it, and why `line` never participates in this match.
 *
 * @param violations the full current scan result (ALL files, not pre-filtered).
 * @param entries the ledger's entry list (already Zod-validated).
 * @param pathExists injected existence check, keyed by the entry's repo-relative path.
 * @throws {TestBudgetFingerprintCollisionError} if two `violations` in the
 *   same file share an identical `(titleFingerprint, spawnCount)` — see
 *   `findFirstFingerprintCollision`. Thrown BEFORE any ledger matching is
 *   attempted, so an ambiguous scan never silently produces a one-sided
 *   result.
 */
export function checkLedger(
  violations: readonly Violation[],
  entries: readonly TestBudgetLedgerEntry[],
  pathExists: (path: string) => boolean,
): LedgerCheckResult {
  const collision = findFirstFingerprintCollision(violations);
  if (collision) {
    throw new TestBudgetFingerprintCollisionError(collision.file, collision.titleFingerprint, collision.spawnCount, collision.occurrences);
  }

  const missingPathEntries: TestBudgetLedgerEntry[] = [];
  const checkableEntries: TestBudgetLedgerEntry[] = [];
  for (const entry of entries) {
    if (pathExists(entry.path)) {
      checkableEntries.push(entry);
    } else {
      missingPathEntries.push(entry);
    }
  }

  const violationByKey = new Map<string, Violation>();
  for (const v of violations) violationByKey.set(ledgerKey(v.file, v.title, v.spawnCount), v);

  const exemptedKeys = new Set<string>();
  const orphanedEntries: TestBudgetLedgerEntry[] = [];
  for (const entry of checkableEntries) {
    const key = ledgerKey(entry.path, entry.titleFingerprint, entry.spawnCount);
    const match = violationByKey.get(key);
    if (match !== undefined) {
      exemptedKeys.add(key);
    } else {
      orphanedEntries.push(entry);
    }
  }

  const newViolations = violations.filter((v) => !exemptedKeys.has(ledgerKey(v.file, v.title, v.spawnCount)));

  return { newViolations, orphanedEntries, missingPathEntries };
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Keywords after which a `/` is unambiguously a regex-literal opener, never division (`return /foo/`, `typeof /foo/`, etc.). */
const REGEX_ALLOWED_KEYWORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await", "extends", "default",
]);

/**
 * Decides whether a `/` at `index` in `source` starts a regex literal
 * (true) or is a division/compound-assignment operator (false), by
 * inspecting the nearest preceding non-whitespace token: a punctuation
 * character other than a value-closing `)`/`]` implies an operand is
 * expected next (regex allowed); a value-closer, or an identifier/keyword
 * that ISN'T in `REGEX_ALLOWED_KEYWORDS`, implies division. Start-of-file
 * (nothing precedes) also allows a regex. This is a heuristic, not a real
 * parser — this oracle already accepts lexical blind spots by design (see
 * module header) — but it resolves the two shapes this repo's own test
 * sources actually contain (`.replace(/…/g, "")`, `const X = /…/`,
 * `toMatch(/…/)`), each preceded by `(` or `=`.
 */
function isRegexContextBefore(source: string, index: number): boolean {
  let j = index - 1;
  while (j >= 0 && /\s/.test(source[j]!)) j--;
  if (j < 0) return true;
  const ch = source[j]!;
  if (/[A-Za-z0-9_$]/.test(ch)) {
    let start = j;
    while (start >= 0 && /[A-Za-z0-9_$]/.test(source[start]!)) start--;
    const word = source.slice(start + 1, j + 1);
    return REGEX_ALLOWED_KEYWORDS.has(word);
  }
  const VALUE_CLOSERS = new Set([")", "]"]);
  return !VALUE_CLOSERS.has(ch);
}

/**
 * Attempts to mask a regex literal starting at `source[start]` (`start`
 * MUST hold `/`), given `isRegexContextBefore` already judged this position
 * regex-eligible. Masks the pattern body (respecting `\`-escapes and
 * `[...]` character classes, where an unescaped `/` does NOT close the
 * regex) plus trailing flag letters, writing spaces into `out` for
 * everything except the two `/` delimiters. Returns the index just past the
 * literal (and its flags) on success, or `null` if no unescaped closing `/`
 * is found before a raw newline or EOF — in which case the CALLER must
 * treat the opening `/` as an ordinary character instead (regex literals
 * cannot legally span a raw newline in JS/TS, so this is conclusive proof
 * the initial regex guess was wrong, not a parse failure).
 */
function tryMaskRegexLiteral(source: string, out: string[], start: number): number | null {
  const n = source.length;
  let j = start + 1;
  let inClass = false;
  while (j < n) {
    const rc = source[j]!;
    if (rc === "\n") return null;
    if (rc === "\\") {
      out[j] = " ";
      if (j + 1 < n) out[j + 1] = " ";
      j += 2;
      continue;
    }
    if (rc === "[") {
      inClass = true;
      out[j] = " ";
      j += 1;
      continue;
    }
    if (rc === "]") {
      inClass = false;
      out[j] = " ";
      j += 1;
      continue;
    }
    if (rc === "/" && !inClass) {
      out[start] = "/";
      out[j] = "/";
      let k = j + 1;
      while (k < n && /[a-zA-Z]/.test(source[k]!)) {
        out[k] = " ";
        k += 1;
      }
      return k;
    }
    out[j] = " ";
    j += 1;
  }
  return null;
}

/**
 * Replaces every comment body and every string/template-literal body in
 * `source` with spaces of the same length (newlines preserved), keeping
 * delimiters (`//`, `/*`, quote characters) intact so callers can still
 * locate where a masked span began. The output has IDENTICAL length and
 * newline positions to `source`, so offsets computed against the masked
 * text are valid indices into the original source too (used to recover a
 * test's real, unmasked title text).
 *
 * @throws {TestBudgetParseError} if a string or block comment is never
 *   closed before EOF (an unterminated literal is itself a parse failure).
 */
export function maskCommentsAndStrings(source: string, file: string): string {
  const out: string[] = new Array(source.length);
  type Mode = "code" | "line" | "block" | "sq" | "dq" | "tpl";
  let mode: Mode = "code";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i]!;
    const c2 = i + 1 < n ? source[i + 1]! : "";
    if (mode === "code") {
      if (c === "/" && c2 === "/") {
        out[i] = "/";
        out[i + 1] = "/";
        mode = "line";
        i += 2;
        continue;
      }
      if (c === "/" && c2 === "*") {
        out[i] = "/";
        out[i + 1] = "*";
        mode = "block";
        i += 2;
        continue;
      }
      if (c === "'") {
        out[i] = "'";
        mode = "sq";
        i += 1;
        continue;
      }
      if (c === '"') {
        out[i] = '"';
        mode = "dq";
        i += 1;
        continue;
      }
      if (c === "`") {
        out[i] = "`";
        mode = "tpl";
        i += 1;
        continue;
      }
      if (c === "/" && c2 !== "/" && c2 !== "*" && isRegexContextBefore(source, i)) {
        const after = tryMaskRegexLiteral(source, out, i);
        if (after !== null) {
          i = after;
          continue;
        }
        // reason: guessed regex-context but found no closing '/' before a
        // raw newline — conclusive proof this '/' was actually division;
        // fall through and treat it as a normal code character below.
      }
      out[i] = c;
      i += 1;
      continue;
    }
    if (mode === "line") {
      if (c === "\n") {
        out[i] = "\n";
        mode = "code";
        i += 1;
        continue;
      }
      out[i] = " ";
      i += 1;
      continue;
    }
    if (mode === "block") {
      if (c === "*" && c2 === "/") {
        out[i] = " ";
        out[i + 1] = " ";
        mode = "code";
        i += 2;
        continue;
      }
      out[i] = c === "\n" ? "\n" : " ";
      i += 1;
      continue;
    }
    // mode is "sq" | "dq" | "tpl" — inside a string/template literal.
    // reason: template `${...}` interpolation is deliberately masked as
    // plain string content too (not re-entered as code) — the offending
    // shape this oracle targets is direct statement-level spawn-helper
    // calls, never one hidden inside a template interpolation; see the
    // module header's Option 1 discussion of accepted indirection blind
    // spots.
    const closing = mode === "sq" ? "'" : mode === "dq" ? '"' : "`";
    if (c === "\\") {
      out[i] = " ";
      if (i + 1 < n) out[i + 1] = " ";
      i += 2;
      continue;
    }
    if (c === closing) {
      out[i] = closing;
      mode = "code";
      i += 1;
      continue;
    }
    out[i] = c === "\n" ? "\n" : " ";
    i += 1;
  }
  if (mode !== "code") {
    throw new TestBudgetParseError(file, `unterminated ${mode === "block" ? "block comment" : "string/template literal"} — reached EOF while still inside it`);
  }
  return out.join("");
}

const BRACKET_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["(", ")"],
  ["{", "}"],
  ["[", "]"],
];

/**
 * Validates that `masked` (the comment/string-masked source) has balanced
 * '()' / '{}' / '[]' brackets — an independent, cheap, whole-file sanity
 * gate that runs BEFORE any per-test-case parsing. A file that totals
 * correctly per bracket type but goes negative-depth at some point (a close
 * with no corresponding open reachable before it) is still rejected: the
 * depth-never-negative check is what makes this a true balanced-brackets
 * proof, not just a coincidental same-totals check.
 *
 * @throws {TestBudgetParseError} naming the exact bracket type and offset
 *   of the first structural break found.
 */
export function assertBalancedBrackets(masked: string, file: string): void {
  for (const [open, close] of BRACKET_PAIRS) {
    let depth = 0;
    for (let i = 0; i < masked.length; i++) {
      const c = masked[i];
      if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth < 0) {
          throw new TestBudgetParseError(file, `unexpected '${close}' with no matching '${open}' before offset ${i}`);
        }
      }
    }
    if (depth !== 0) {
      throw new TestBudgetParseError(file, `${depth} unmatched '${open}' bracket(s) — file ends without a closing '${close}'`);
    }
  }
}

/**
 * Scans forward from `openIndex` (which MUST hold `openChar`) counting only
 * `openChar`/`closeChar` occurrences (all other characters, including the
 * OTHER bracket type, are ignored) until depth returns to 0, returning that
 * closing index. Safe against `masked` text because comment/string bodies
 * already contain no stray brackets.
 *
 * @throws {TestBudgetParseError} if depth never returns to 0 before EOF —
 *   should not happen once `assertBalancedBrackets` has passed for the
 *   whole file, but kept as a defensive, still-loud fallback.
 */
function findMatchingClose(masked: string, openIndex: number, openChar: string, closeChar: string, file: string): number {
  let depth = 0;
  for (let i = openIndex; i < masked.length; i++) {
    const c = masked[i];
    if (c === openChar) depth++;
    else if (c === closeChar) {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new TestBudgetParseError(file, `unbalanced '${openChar}${closeChar}' starting at offset ${openIndex}`);
}

/** Repo-relative 1-based line number of a character offset (counts `\n` in `source[0..index)`). */
function lineNumberAt(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source[i] === "\n") line++;
  }
  return line;
}

const IMPORT_CHILD_PROCESS_RE = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["'](?:node:)?child_process["']/g;

/**
 * Collects the local binding names a file imports from `node:child_process`
 * (or bare `child_process`), honouring `as` aliases — e.g.
 * `import { spawnSync as sps } from "node:child_process"` adds `"sps"`, not
 * `"spawnSync"`. These names, called directly (`name(...)`, never as a
 * member expression — see the negative lookbehind in `countSpawnCalls`),
 * count as spawn-primitive call sites even with no wrapper function.
 */
function collectImportedProcessSpawnNames(source: string): Set<string> {
  const names = new Set<string>();
  IMPORT_CHILD_PROCESS_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMPORT_CHILD_PROCESS_RE.exec(source)) !== null) {
    for (const raw of m[1]!.split(",")) {
      const spec = raw.trim();
      if (!spec) continue;
      const aliased = spec.match(/^(\w+)\s+as\s+(\w+)$/);
      if (aliased) {
        names.add(aliased[2]!);
        continue;
      }
      const simple = spec.match(/^(\w+)$/);
      if (simple) names.add(simple[1]!);
    }
  }
  return names;
}

/**
 * Scans forward from `fromIndex` (just past a parameter list's closing
 * paren) for the function's body-opening `{`, skipping over a `: ReturnType`
 * annotation. Disambiguates an object-type-literal return annotation
 * (`(): { a: number } { ... }`) from the real body by peeking: if the first
 * `{...}` found closes and is IMMEDIATELY followed by another `{`, the first
 * was the return type — use the second. Returns -1 if a statement-ending
 * `;` is reached first (an ambient/overload declaration with no body — not
 * a candidate spawn helper) or EOF is reached with neither found.
 */
function findBraceBodyAfterParams(masked: string, fromIndex: number, file: string): number {
  let i = fromIndex;
  while (i < masked.length && masked[i] !== "{" && masked[i] !== ";") i++;
  if (i >= masked.length || masked[i] === ";") return -1;
  const firstClose = findMatchingClose(masked, i, "{", "}", file);
  let j = firstClose + 1;
  while (j < masked.length && /\s/.test(masked[j]!)) j++;
  if (masked[j] === "{") return j;
  return i;
}

const FUNCTION_DECL_RE = /\bfunction\s+(\w+)\s*\(/g;
// reason: matches BOTH `const name = (params) => {...}` (arrow, params
// parenthesised — a bare single-param `x => {...}` arrow is NOT matched,
// documented gap: this codebase's spawn helpers all take >=1 explicit
// parameter with parens) and `const name = function (...) {...}` (function
// expression), while explicitly rejecting `const name = someCall(...)` —
// the optional `(?:async\s+)?(?:function\b[^(]*)?` group only ever consumes
// the literal keywords `async`/`function`, so a call like `new URL(...)` or
// `parseSlug(...)` right after `=` fails to match (the required `\(` isn't
// adjacent to `=` once a non-keyword identifier appears first).
const CONST_ARROW_OR_FUNCEXPR_RE = /\bconst\s+(\w+)\s*(?::[^=]+?)?=\s*(?:async\s+)?(?:function\b[^(]*)?\(/g;

/**
 * Finds every `function name(...)` / `const name = (...) =>` / `const name =
 * function (...)` declaration in `masked` and returns the subset whose OWN
 * body directly calls `Bun.spawnSync`/`Bun.spawn` or one of `importedNames`
 * (from `node:child_process`). Deliberately ONE level deep — see module
 * header §3.
 */
export function findSpawnHelperNames(masked: string, importedNames: ReadonlySet<string>, file: string): Set<string> {
  const helperNames = new Set<string>();
  for (const re of [FUNCTION_DECL_RE, CONST_ARROW_OR_FUNCEXPR_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked)) !== null) {
      const name = m[1]!;
      const paramsOpenIndex = m.index + m[0].length - 1;
      const paramsCloseIndex = findMatchingClose(masked, paramsOpenIndex, "(", ")", file);
      const bodyStart = findBraceBodyAfterParams(masked, paramsCloseIndex + 1, file);
      if (bodyStart === -1) continue;
      const bodyEnd = findMatchingClose(masked, bodyStart, "{", "}", file);
      const body = masked.slice(bodyStart, bodyEnd + 1);
      const usesPrimitive =
        /\bBun\.spawnSync\s*\(/.test(body) ||
        /\bBun\.spawn\s*\(/.test(body) ||
        [...importedNames].some((n) => new RegExp(`(?<!\\.)\\b${escapeRegExp(n)}\\s*\\(`).test(body));
      if (usesPrimitive) helperNames.add(name);
    }
  }
  return helperNames;
}

/**
 * Counts direct call-sites of `Bun.spawnSync`/`Bun.spawn` plus any name in
 * `names` (imported child_process bindings ∪ locally-detected spawn
 * helpers) within `text`. The `(?<!\.)` lookbehind on bare names excludes a
 * member-expression call on an unrelated receiver (e.g. `foo.spawn(...)`)
 * from being miscounted as the imported/declared `spawn` binding.
 */
function countSpawnCalls(text: string, names: ReadonlySet<string>): number {
  let count = 0;
  for (const re of [/\bBun\.spawnSync\s*\(/g, /\bBun\.spawn\s*\(/g]) {
    const matches = text.match(re);
    if (matches) count += matches.length;
  }
  for (const name of names) {
    const re = new RegExp(`(?<!\\.)\\b${escapeRegExp(name)}\\s*\\(`, "g");
    const matches = text.match(re);
    if (matches) count += matches.length;
  }
  return count;
}

interface Span {
  readonly start: number;
  readonly end: number;
}

/**
 * Splits `text` (an `it(...)`/`test(...)` call's full argument-list text)
 * into top-level argument spans — a comma counts as a separator only at
 * paren/brace/bracket depth 0 relative to the start of `text`. Operating on
 * MASKED text means a comma embedded in a string (e.g. inside the test
 * title) is already blanked to a space and can never be mistaken for an
 * argument separator.
 */
function splitTopLevelArgs(text: string): Span[] {
  const spans: Span[] = [];
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(") depthParen++;
    else if (c === ")") depthParen--;
    else if (c === "{") depthBrace++;
    else if (c === "}") depthBrace--;
    else if (c === "[") depthBracket++;
    else if (c === "]") depthBracket--;
    else if (c === "," && depthParen === 0 && depthBrace === 0 && depthBracket === 0) {
      spans.push({ start, end: i });
      start = i + 1;
    }
  }
  spans.push({ start, end: text.length });
  return spans;
}

const TEST_CALL_RE = /\b(?:it|test)\b(?:\.(?:only|skip|todo|concurrent))?\s*\(/g;

/**
 * Scans one test file's source for spawn-budget violations: an
 * `it(...)`/`test(...)` case whose callback directly calls a spawn
 * helper/primitive `>= SPAWN_THRESHOLD` times with no explicit third-argument
 * timeout declaration.
 *
 * @param relPath repo-relative path, used only for error/violation messages.
 * @param source the file's raw text.
 * @throws {TestBudgetParseError} if `source` is not lexically parseable —
 *   never returns a partial/silent result for a broken file (spec D5).
 */
export function scanFile(relPath: string, source: string): Violation[] {
  const masked = maskCommentsAndStrings(source, relPath);
  assertBalancedBrackets(masked, relPath);

  const importedNames = collectImportedProcessSpawnNames(source);
  const helperNames = findSpawnHelperNames(masked, importedNames, relPath);
  const countableNames = new Set<string>([...importedNames, ...helperNames]);

  const violations: Violation[] = [];
  TEST_CALL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TEST_CALL_RE.exec(masked)) !== null) {
    const callParenStart = m.index + m[0].length - 1;
    const callParenEnd = findMatchingClose(masked, callParenStart, "(", ")", relPath);
    const argListMasked = masked.slice(callParenStart + 1, callParenEnd);
    const argSpans = splitTopLevelArgs(argListMasked);

    if (argSpans.length < 2) {
      TEST_CALL_RE.lastIndex = callParenEnd + 1;
      continue;
    }

    const titleSpan = argSpans[0]!;
    const titleAbsStart = callParenStart + 1 + titleSpan.start;
    const titleAbsEnd = callParenStart + 1 + titleSpan.end;
    const titleRaw = source.slice(titleAbsStart, titleAbsEnd).trim();
    const titleMatch = titleRaw.match(/^(['"`])([\s\S]*)\1$/);
    if (!titleMatch) {
      // reason: a computed/dynamic test title (not a string literal) — this
      // oracle can't produce a human-readable title for it. Skipping the
      // ONE call (not the file) is not the D5 "silent file skip" this
      // oracle guards against; it's a documented, narrow reporting gap.
      TEST_CALL_RE.lastIndex = callParenEnd + 1;
      continue;
    }
    const title = titleMatch[2]!;

    const fnSpan = argSpans[1]!;
    const fnText = argListMasked.slice(fnSpan.start, fnSpan.end);
    const spawnCount = countSpawnCalls(fnText, countableNames);

    // D1: presence of a 3rd top-level argument IS the explicit declaration —
    // its value/shape (bare ms number vs `{ timeout }`) is never inspected.
    // A bare trailing comma (`it(name, fn,)`) produces an empty 3rd span,
    // which must NOT count as a declaration.
    const thirdSpan = argSpans[2];
    const hasExplicitTimeout = thirdSpan !== undefined && argListMasked.slice(thirdSpan.start, thirdSpan.end).trim().length > 0;

    if (spawnCount >= SPAWN_THRESHOLD && !hasExplicitTimeout) {
      violations.push({ file: relPath, title, line: lineNumberAt(source, m.index), spawnCount });
    }

    TEST_CALL_RE.lastIndex = callParenEnd + 1;
  }
  return violations;
}

function isScannableTestFile(name: string): boolean {
  return name.endsWith(".test.ts") || name.endsWith(".bun.test.ts");
}

/**
 * Recursively collects repo-relative, POSIX-style paths of every
 * `.test.ts`/`.bun.test.ts` file under `dir` (skipping `node_modules`,
 * `dist`, `.git`). Scan root is `<repoRoot>/packages` ONLY — this oracle's
 * own fixtures under `scripts/tests/` (deliberately containing violations
 * and unparseable source, for AC-TB-2/3/5) are never in scope for the real
 * repo-tree scan, matching D3 (this is a repo-structure check, hosted
 * outside the corpus-facing `lore` binary, not a `lore status --check-*`).
 */
function readDirEntries(dir: string, repoRoot: string) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    throw new TestBudgetParseError(relative(repoRoot, dir), `cannot read directory: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function walkTestFiles(dir: string, repoRoot: string, out: string[]): void {
  const entries = readDirEntries(dir, repoRoot);
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTestFiles(abs, repoRoot, out);
    } else if (entry.isFile() && isScannableTestFile(entry.name)) {
      out.push(relative(repoRoot, abs).split(sep).join("/"));
    }
  }
}

/** The raw scan result of `scanRepoTree`, before any ledger cross-check. */
export interface RepoScanResult {
  /** Every repo-relative `.test.ts`/`.bun.test.ts` path scanned. */
  readonly files: readonly string[];
  /** All violations found across every file that DID parse. */
  readonly violations: readonly Violation[];
  /** `"<file>: <message>"` for every file `scanFile` could not lexically parse. */
  readonly parseFailures: readonly string[];
}

/**
 * Walks `<repoRoot>/packages` for every `.test.ts`/`.bun.test.ts` file and
 * `scanFile`s each one — the exact scan `main` performs internally, exposed
 * as its own function so a caller OTHER than the CLI entrypoint can derive a
 * violation's CURRENT title/spawnCount by actually running this oracle
 * against the tree. The canonical such caller is the ledger migration
 * script (`scripts/migrate-test-budget-ledger-to-title-fingerprint.ts`,
 * task `task-key-test-budget-ledger-rows-on-a-test-title-fingerprint`) —
 * AC-2 there forbids hand-transcribing a title, which would reintroduce the
 * contiguous-substring failure this repo has measured repeatedly.
 *
 * IO (reads every scanned file from disk); pure in the sense that it never
 * writes anything and never calls `process.exit`.
 */
export function scanRepoTree(repoRoot: string = REPO_ROOT): RepoScanResult {
  const files: string[] = [];
  walkTestFiles(join(repoRoot, "packages"), repoRoot, files);

  const violations: Violation[] = [];
  const parseFailures: string[] = [];

  for (const relPath of files) {
    const source = readFileSync(join(repoRoot, relPath), "utf8");
    try {
      violations.push(...scanFile(relPath, source));
    } catch (e) {
      if (e instanceof TestBudgetParseError) {
        parseFailures.push(`${e.file}: ${e.message}`);
      } else {
        throw e;
      }
    }
  }

  return { files, violations, parseFailures };
}

/**
 * CLI entrypoint: runs `scanRepoTree`, cross-checks the result against the
 * baseline exemption ledger (`loadLedgerFromDisk` + `checkLedger` — see the
 * module header's Baseline + exemption ledger section), and prints a
 * report. Returns the process exit code (never calls `process.exit` itself,
 * so it stays testable).
 */
export function main(repoRoot: string = REPO_ROOT): number {
  const { files, violations, parseFailures } = scanRepoTree(repoRoot);

  if (parseFailures.length > 0) {
    console.error(`check-test-budgets: ${parseFailures.length} file(s) could not be parsed:\n`);
    for (const f of parseFailures) console.error(`  ${f}`);
    console.error(`\nAn unparseable test file is never silently skipped — fix its syntax so this oracle can scan it.`);
    if (violations.length > 0) {
      // reason: still surface what WAS found in the files that DID parse, but
      // never cross-check a partial scan against the ledger — a violation
      // hidden inside the unparseable file itself would be silently absent
      // from `violations`, which could misreport its ledger row as orphaned
      // even though the violation is still there, just unscanned.
      console.error(`\ncheck-test-budgets: ${violations.length} test case(s) also spawn >= ${SPAWN_THRESHOLD} times without declaring an explicit timeout (ledger cross-check skipped — fix the parse failure(s) above first):\n`);
      for (const v of violations) {
        console.error(`  ${v.file}:${v.line}: "${v.title}" — ${v.spawnCount} spawn-helper call(s), no explicit timeout argument`);
      }
    }
    return 3;
  }

  const ledger = loadLedgerFromDisk(repoRoot);
  const ledgerCheck = checkLedger(violations, ledger.entries, (p) => existsSync(join(repoRoot, p)));

  if (ledgerCheck.missingPathEntries.length > 0) {
    console.error(`\ncheck-test-budgets: ${ledgerCheck.missingPathEntries.length} ledger entry(ies) in ${LEDGER_RELATIVE_PATH} reference a path that does not exist:\n`);
    for (const e of ledgerCheck.missingPathEntries) {
      console.error(`  ${e.path} — "${e.titleFingerprint}" (recorded ${e.spawnCount} spawn(s), last seen near line ${e.line}) — ${e.reason}`);
    }
    console.error(`\nRemove this row from ${LEDGER_RELATIVE_PATH} — a ledger entry must point at a file that still exists.`);
  }

  if (ledgerCheck.orphanedEntries.length > 0) {
    console.error(
      `\ncheck-test-budgets: ${ledgerCheck.orphanedEntries.length} ledger entry(ies) in ${LEDGER_RELATIVE_PATH} no longer match a real violation:\n`,
    );
    for (const e of ledgerCheck.orphanedEntries) {
      console.error(`  ${e.path} — "${e.titleFingerprint}" (recorded ${e.spawnCount} spawn(s), last seen near line ${e.line}) — ${e.reason}`);
    }
    console.error(
      `\nAn exempt ledger entry must keep matching a REAL violation ` +
        `(adr-a-newly-armed-structural-oracle-enforces-from-a-baseline criterion 3). Rows now key on the test's TITLE, not its ` +
        `line, so this orphan means the test case itself was renamed, removed, or actually fixed — never merely that an unrelated ` +
        `insertion elsewhere in the file shifted its line (that class of false break is exactly what this key change eliminates). ` +
        `Retire this row from ${LEDGER_RELATIVE_PATH} in the SAME commit that renamed/removed/fixed it.`,
    );
  }

  if (ledgerCheck.newViolations.length > 0) {
    console.error(
      `\ncheck-test-budgets: ${ledgerCheck.newViolations.length} test case(s) spawn >= ${SPAWN_THRESHOLD} times without declaring an explicit timeout, and are NOT covered by ${LEDGER_RELATIVE_PATH}:\n`,
    );
    for (const v of ledgerCheck.newViolations) {
      console.error(`  ${v.file}:${v.line}: "${v.title}" — ${v.spawnCount} spawn-helper call(s), no explicit timeout argument`);
    }
    console.error(
      `\nDeclare an explicit timeout as the it()/test() third argument — a number in ms, or { timeout: <ms> }.` +
        ` This oracle judges DECLARATION, never the number (spec-a-test-case-s-timeout-budget-must-be-declared-when-its D1).` +
        ` New debt is never exempt — this is not pre-existing baseline debt (adr-a-newly-armed-structural-oracle-enforces-from-a-baseline).`,
    );
  }

  const clean = ledgerCheck.missingPathEntries.length === 0 && ledgerCheck.orphanedEntries.length === 0 && ledgerCheck.newViolations.length === 0;
  if (clean) {
    console.log(
      `check-test-budgets: OK — scanned ${files.length} test file(s); ${violations.length} pre-existing violation(s) exempted via ${LEDGER_RELATIVE_PATH}; 0 new violations.`,
    );
    return 0;
  }
  if (ledgerCheck.missingPathEntries.length > 0 || ledgerCheck.orphanedEntries.length > 0) return 5;
  return 2;
}

if (import.meta.main) {
  try {
    process.exit(main());
  } catch (e) {
    console.error(`check-test-budgets: scan failed — ${e instanceof Error ? e.message : String(e)}`);
    if (e instanceof TestBudgetLedgerError && e.context) {
      console.error(JSON.stringify(e.context));
    }
    process.exit(4);
  }
}
