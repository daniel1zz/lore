/**
 * Code anchors — `path[#Symbol]` bindings declared by a spec OR a knowledge doc +
 * the pure drift-detection
 * core (SPEC-045 §Design Decisions D1, D2, D3 — memory hygiene part 3, doc-code drift
 * oracle H3). Pure, browser-safe module: no IO, no wall-clock reads. Filesystem
 * probing lives entirely in `packages/lore/src/service/drift-check-service.ts`
 * (SPEC-045 D4) — this module only classifies ALREADY-PROBED results.
 *
 * Public surface:
 *   - parseCodeAnchor(raw) — per-entry grammar parse of ONE full raw anchor string
 *     (never batched — see @invariant below)
 *   - serializeCodeAnchor(parsed) — reconstructs the canonical `path[#Symbol]` string
 *   - normalizeCodeAnchorEntries(raw[]) — parse + serialize + dedupe a candidate list,
 *     preserving first-occurrence order (the RMW authoring transform, D6)
 *   - computeDrift(declared, probes) — classifies each declared anchor against
 *     already-collected probe results into one of the drift kinds (D2)
 *   - ParsedCodeAnchor / DriftKind / DriftRow / DriftInputEntry / AnchorProbe /
 *     ExportedNames / ComputeDriftResult — the public shapes above operate on
 *
 * @invariant `parseCodeAnchor` runs on the FULL RAW anchor string, split on the LAST
 *   `#` — NEVER a batched `normalizeFileAnchors` call over a list of extracted path
 *   parts. Batching would silently collapse `"a.ts#Foo"` and `"a.ts#Bar"` into a
 *   single deduplicated path entry (`normalizeFileAnchors`'s internal `Set` dedup is
 *   keyed on the path alone), losing one of the two symbol bindings (SPEC-045 review
 *   S3). Each entry calls `normalizeFileAnchors` with a ONE-ELEMENT array — reusing
 *   its path-validation rules (POSIX, repo-relative, no `..`, trailing `/` = dir
 *   scope, ≤512 chars) without re-deriving them, while keeping per-entry symbol
 *   association intact.
 * @invariant Test-title grammar (issue #178): `path#"title"` — a double-quoted title,
 *   `\"` and `\\` the only escapes, valid ONLY on a test file (`*.test.ts`, which
 *   covers `*.bun.test.ts`). The leading `#"` cannot collide with the identifier form
 *   (an identifier never starts with `"`), so detection is the FIRST `#"` in the raw
 *   string and a title may itself contain `#`. It resolves when the exact title is a
 *   `describe`/`it`/`test` title in the file ({@link scanTestTitles}); otherwise
 *   `symbol_missing`. A quoted title on a non-test file is refused LOUD (a title has
 *   no meaning outside a test file). Parsed into `ParsedCodeAnchor.title`, never
 *   `.symbol`.
 * @invariant Symbol grammar: `/^[A-Za-z_$][A-Za-z0-9_$]*$/`, ASCII-only — a
 *   Unicode-named export cannot be anchored (explicit Scope-Out; authoring rejects it
 *   LOUD). The regex deliberately admits reserved words (`default` is meaningful,
 *   D3's `export default` form; others simply never match a real export and surface
 *   as `symbol_missing` — the tolerated false-positive direction, review S9). A
 *   directory anchor (trailing `/`) MUST NOT carry a `#Symbol` — loud reject.
 * @invariant Exported names are DECIDED BY A PARSE, never by a text scan (BR-417):
 *   the reader that fills `AnchorProbe.exported` (`packages/lore/src/service/
 *   export-reader.ts`, TypeScript compiler API) lives outside this browser-safe
 *   package and arrives through the `FsProbe.readExportedNames` port. A symbol
 *   missing from a file whose names the reader could not fully see (unparseable
 *   language, syntax error, unresolvable star re-export) is `probe_error` "not
 *   measured" — `symbol_missing` only when the list is complete. ⛔ Do not add a
 *   regex export scan back here: a text scan reports valid exports as missing.
 * @invariant `computeDrift`'s `consistent` is `true` ONLY when every declared anchor
 *   affirmatively verifies — any `probe_error`/`*_missing`/`node_type_mismatch`/
 *   `symbol_missing` row flips it `false`. A probe error is drift, never a silent
 *   scan abort (D4, G11's "including under probe IO errors" clause).
 * @invariant Every `DriftInputEntry`/`DriftRow` carries a REQUIRED `doc_type`
 *   alongside `doc_slug`, because more than one doc type may declare `code_anchors`
 *   (`spec` and `knowledge`). A row is therefore self-attributing: a knowledge
 *   breach can never be read as a spec breach. ⛔ Never reintroduce a
 *   spec-flavoured slug field name here — the retired spelling and its successor
 *   coexisting is the SSOT failure mode this repo has already paid for three times;
 *   the census oracle is
 *   `packages/lore/tests/unit/service/drift-population-reporting.test.ts`.
 *
 * Side-effect class: pure
 *
 * Source: SPEC-045 §Design Decisions D1, D2, D3, D4; §Acceptance Criteria AC-DR-1
 */

import { err, ok } from "./errors.js";
import type { Result, LoreError } from "./errors.js";
import { FILE_ANCHOR_SYMBOL_RE, normalizeFileAnchors } from "./file-anchors.js";
import type { DocType } from "./types.js";

// ─── Grammar (D1) ───────────────────────────────────────────────────────────

/**
 * ASCII-only JS identifier grammar for a code anchor's `#Symbol` suffix (D1). The ONE definition lives in
 * `file-anchors.ts` (`FILE_ANCHOR_SYMBOL_RE`): a task's `path#Symbol` file anchor and a spec's code anchor must
 * accept exactly the same symbol spellings.
 */
const CODE_ANCHOR_SYMBOL_RE = FILE_ANCHOR_SYMBOL_RE;

/** A title anchor is legal only on a test file: `*.test.ts` (includes `*.bun.test.ts`). */
const TEST_FILE_PATH_RE = /\.test\.ts$/;

/** `describe`/`it`/`test` call (optionally `.only`/`.skip`/`.each`-style member) with a string-literal first argument. */
const TEST_TITLE_CALL_RE = /\b(?:describe|it|test)(?:\.\w+)*\(\s*(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g;

/** One code anchor, parsed and grammar-validated (D1). */
export interface ParsedCodeAnchor {
  /** The original raw anchor string, verbatim (round-trips into drift rows). */
  raw: string;
  /** Normalized POSIX path, WITHOUT a trailing slash — dir-ness is `isDir` (D1). */
  path: string;
  /** `true` iff the anchor declared a directory scope (`raw`'s path part ended in `/`). */
  isDir: boolean;
  /** ASCII identifier, present iff a `#Symbol` suffix was declared (never on a dir anchor). */
  symbol?: string;
  /** Exact test title, present iff the anchor used the `#"title"` form (test files only). Mutually exclusive with `symbol`. */
  title?: string;
  /**
   * Script name, present iff this reference names a package.json script (prose
   * references only; `parseCodeAnchor` never sets it). `path` is then the
   * governing package.json and `symbol`/`title` are unset.
   */
  script?: string;
}

/** Outcome of grammar-checking ONE raw code-anchor string: a valid anchor, or why it is not one. */
export type CodeAnchorClassification =
  | { kind: "valid"; anchor: ParsedCodeAnchor }
  | { kind: "invalid"; /** The exact refusal text `parseCodeAnchor` surfaces for this input. */ message: string };

const invalidAnchor = (message: string): CodeAnchorClassification => ({ kind: "invalid", message });

/**
 * The ONE code-anchor grammar (D1), as a pure total function: classifies ONE full raw
 * string as a valid anchor or as invalid with the reason. Splits on the LAST `#` (a path may
 * legally contain earlier `#` characters); the path part is validated + normalized via
 * {@link normalizeFileAnchors} called with a ONE-ELEMENT array (never batched — see this
 * module's class @invariant). It never refuses: callers decide what an invalid string means.
 * `parseCodeAnchor` (anchor writes) turns invalid into a VALIDATION_ERROR; prose extraction
 * (memory files, fragments) treats it as "not a reference".
 *
 * @param raw - One candidate anchor string, e.g. `"src/x.ts"`, `"src/x.ts#Exported"`, `"src/dir/"`.
 * @returns `{kind: "valid", anchor}` or `{kind: "invalid", message}`.
 *
 * @example
 * classifyCodeAnchor("src/a.ts#Foo");
 * // => { kind: "valid", anchor: { raw: "src/a.ts#Foo", path: "src/a.ts", isDir: false, symbol: "Foo" } }
 * @example
 * classifyCodeAnchor("src/dir/#Foo");
 * // => { kind: "invalid", message: 'directory anchor must not carry a #Symbol: "src/dir/#Foo"' }
 */
export function classifyCodeAnchor(raw: string): CodeAnchorClassification {
  const titleIndex = raw.indexOf('#"');
  const hashIndex = titleIndex !== -1 ? titleIndex : raw.lastIndexOf("#");
  const pathPart = hashIndex === -1 ? raw : raw.slice(0, hashIndex);
  const symbolPart = hashIndex === -1 ? undefined : raw.slice(hashIndex + 1);

  const pathResult = normalizeFileAnchors([pathPart]);
  if (!pathResult.ok) {
    const underlying = pathResult.error;
    const underlyingMessage = underlying.code === "VALIDATION_ERROR" ? underlying.message : "invalid path";
    return invalidAnchor(`invalid code anchor "${raw}": ${underlyingMessage}`);
  }

  const normalizedPath = pathResult.value[0];
  if (normalizedPath === undefined) {
    return invalidAnchor(`code anchor normalizes to an empty path: "${raw}"`);
  }
  const isDir = normalizedPath.endsWith("/");
  const path = isDir ? normalizedPath.slice(0, -1) : normalizedPath;

  if (symbolPart === undefined) {
    return { kind: "valid", anchor: { raw, path, isDir } };
  }

  if (isDir) {
    return invalidAnchor(`directory anchor must not carry a #Symbol: "${raw}"`);
  }

  if (symbolPart.startsWith('"')) {
    return classifyTitleAnchor(raw, path, symbolPart);
  }

  if (!CODE_ANCHOR_SYMBOL_RE.test(symbolPart)) {
    return invalidAnchor(
      `code anchor symbol must be an ASCII identifier matching ` +
        `/^[A-Za-z_$][A-Za-z0-9_$]*$/ (or a quoted "test title" on a test file): "${raw}"`,
    );
  }

  return { kind: "valid", anchor: { raw, path, isDir: false, symbol: symbolPart } };
}

/**
 * Parses and grammar-validates ONE full raw code-anchor string for the anchor WRITE paths:
 * {@link classifyCodeAnchor} with an invalid result turned into the refusal.
 *
 * @param raw - One candidate anchor string, e.g. `"src/x.ts"`, `"src/x.ts#Exported"`, `"src/dir/"`.
 * @returns `ok(parsed)` or `err(VALIDATION_ERROR)` naming the offending raw string on
 *   the first grammar violation (bad path, dir+symbol, non-ASCII/malformed symbol).
 * @throws Never — always returns a Result.
 *
 * @example
 * parseCodeAnchor("src/a.ts#Foo");
 * // => ok({ raw: "src/a.ts#Foo", path: "src/a.ts", isDir: false, symbol: "Foo" })
 * @example
 * parseCodeAnchor("src/a.ts#名前");
 * // => err({ code: "VALIDATION_ERROR", field: "code_anchors", ... }) — non-ASCII symbol
 */
export function parseCodeAnchor(raw: string): Result<ParsedCodeAnchor, LoreError> {
  const classified = classifyCodeAnchor(raw);
  if (classified.kind === "valid") return ok(classified.anchor);
  return err({ code: "VALIDATION_ERROR", field: "code_anchors", message: classified.message, value: raw });
}

/**
 * Validates the quoted-title suffix of one anchor (issue #178). `quoted` is the text
 * after `#`, starting with `"`.
 *
 * @returns `valid` with `title` set, or `invalid` for a non-test file, an
 *   unterminated/empty quote, or a stray unescaped quote inside the title.
 */
function classifyTitleAnchor(raw: string, path: string, quoted: string): CodeAnchorClassification {
  const fail = (reason: string): CodeAnchorClassification => invalidAnchor(`${reason}: "${raw}"`);

  if (!TEST_FILE_PATH_RE.test(path)) {
    return fail(
      `a quoted test-title anchor is only valid on a test file (*.test.ts / *.bun.test.ts) — ` +
        `"${path}" is not one; anchor a non-test file by exported identifier (path#Symbol)`,
    );
  }
  if (quoted.length < 3 || !quoted.endsWith('"')) {
    return fail('a test-title anchor must be a non-empty, terminated double-quoted string (path#"title")');
  }
  const body = quoted.slice(1, -1);
  let title = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "\\") {
      const next = body[i + 1];
      if (next !== '"' && next !== "\\") return fail('a test-title anchor only supports the escapes \\" and \\\\');
      title += next;
      i++;
    } else if (ch === '"') {
      return fail('an unescaped " inside a test-title anchor (write \\")');
    } else {
      title += ch;
    }
  }
  return { kind: "valid", anchor: { raw, path, isDir: false, title } };
}

/** Inverse of the title escape in {@link classifyTitleAnchor}. */
function quoteTitle(title: string): string {
  return `"${title.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Reconstructs the canonical `path[#Symbol]` string from a parsed anchor — the
 * inverse of {@link parseCodeAnchor} (modulo path normalization, which is
 * one-directional). Used by the authoring RMW transform ({@link
 * normalizeCodeAnchorEntries}) to persist normalized entries.
 *
 * @example
 * serializeCodeAnchor({ raw: "./src/a.ts#Foo", path: "src/a.ts", isDir: false, symbol: "Foo" });
 * // => "src/a.ts#Foo"
 * @example
 * serializeCodeAnchor({ raw: "src/dir/", path: "src/dir", isDir: true });
 * // => "src/dir/"
 */
export function serializeCodeAnchor(parsed: ParsedCodeAnchor): string {
  const base = parsed.isDir ? `${parsed.path}/` : parsed.path;
  if (parsed.title !== undefined) return `${base}#${quoteTitle(parsed.title)}`;
  return parsed.symbol !== undefined ? `${base}#${parsed.symbol}` : base;
}

/**
 * Parses, normalizes, and deduplicates a candidate `code_anchors` list — the
 * authoring RMW transform shared by `DriftCheckService.addCodeAnchors`/
 * `removeCodeAnchors`/`setCodeAnchors` (D6). Each entry is parsed INDIVIDUALLY via
 * {@link parseCodeAnchor} (never batched — class @invariant); the first grammar
 * failure aborts the whole call (no partial write). Post-normalization EXACT-STRING
 * duplicates are dropped, first occurrence wins, order otherwise preserved — mirrors
 * `normalizeFileAnchors`'s dedup contract without reusing its (path-only) dedup key.
 *
 * @param raw - Candidate raw anchor strings.
 * @returns `ok(normalized)` or `err(VALIDATION_ERROR)` naming the offending entry.
 *
 * @example
 * normalizeCodeAnchorEntries(["./src/a.ts#Foo", "src/a.ts#Bar", "src/a.ts#Foo"]);
 * // => ok(["src/a.ts#Foo", "src/a.ts#Bar"]) — both symbols survive, exact dup dropped
 */
export function normalizeCodeAnchorEntries(raw: string[]): Result<string[], LoreError> {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const parsedResult = parseCodeAnchor(entry);
    if (!parsedResult.ok) return parsedResult;
    const serialized = serializeCodeAnchor(parsedResult.value);
    if (!seen.has(serialized)) {
      seen.add(serialized);
      normalized.push(serialized);
    }
  }
  return ok(normalized);
}

// ─── Exported Names (BR-417) ────────────────────────────────────────────────

/**
 * What an export reader found in ONE file: the exported names, plus — when it could not see
 * everything — why. `notMeasured` set means the name list may be INCOMPLETE (an unparseable
 * language, a syntax error, a star re-export it could not follow): a name in `names` is still
 * a verified export, but a name missing from `names` is NOT proven absent, so
 * {@link computeDrift} reports it as a `probe_error` "not measured", never `symbol_missing`.
 * The reader itself lives beside the filesystem port (`packages/lore`), because parsing needs
 * the TypeScript compiler, which this browser-safe package never imports.
 */
export interface ExportedNames {
  /** Every export name the reader positively found (`default` for a default export). */
  names: ReadonlySet<string>;
  /** Why the list may be incomplete; absent when the file was fully measured. */
  notMeasured?: string;
}

/**
 * Lexical scan of the `describe`/`it`/`test` titles in a test file's source (issue
 * #178) — a text scan, not a parser (titles are string data, not exports). A `describe`/
 * `it`/`test` call (member forms such as `it.skip(` included) whose first argument is
 * a string literal (`"`, `'` or backtick) yields that literal, backslash escapes
 * collapsed. Computed titles and `${}` interpolations are not evaluated (documented
 * false-positive source: the anchor reports `symbol_missing`).
 *
 * @param source - Full file text of the ONE anchored test file.
 * @returns Every title recognized (deduplicated).
 *
 * @example
 * scanTestTitles('describe("A: b (c)", () => { it(\'d\', () => {}); });');
 * // => Set(["A: b (c)", "d"])
 */
export function scanTestTitles(source: string): Set<string> {
  const titles = new Set<string>();
  for (const match of source.matchAll(TEST_TITLE_CALL_RE)) {
    const literal = match[2];
    if (literal !== undefined) titles.add(literal.replace(/\\(.)/g, "$1"));
  }
  return titles;
}

/**
 * Names of the `scripts` entries in a package.json text. `undefined` when the text
 * is not a JSON object or has no object-valued `scripts`; the caller reports that
 * as a `probe_error`, never as "no scripts".
 *
 * @param source - Full text of one package.json.
 * @returns The script names, or `undefined` when the shape is unusable.
 * @example
 * scanPackageScripts('{"scripts":{"build":"tsc"}}'); // => Set(["build"])
 */
export function scanPackageScripts(source: string): Set<string> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const scripts = (parsed as Record<string, unknown>)["scripts"];
  if (typeof scripts !== "object" || scripts === null || Array.isArray(scripts)) return undefined;
  return new Set(Object.keys(scripts));
}

// ─── Drift Classification (D2, D4) ──────────────────────────────────────────

/** The drift kinds a declared anchor is classified into (D2); `anchor_unreadable` is raised by the scan itself. */
export const DRIFT_KINDS = [
  "file_missing",
  "dir_missing",
  "dir_empty",
  "symbol_missing",
  "node_type_mismatch",
  "probe_error",
  // A prose reference `bun run <name>` whose <name> is not in the governing
  // package.json `scripts` (spec-prose-about-code-is-bound-to-what-it-describes-one D1).
  "script_missing",
  // A STORED anchor string the grammar rejects (hand-edited / imported / legacy row): never skipped, reported
  // (baseline-detect-code-anchor-drift BR-416). Raised by the drift scan itself, not by `computeDrift`.
  "anchor_unreadable",
] as const;

/** Derived TypeScript type for a drift row's classification. */
export type DriftKind = (typeof DRIFT_KINDS)[number];

/**
 * One declared anchor, labeled with its owning document's identity (D2/D4 input
 * shape). The owning doc is a `spec` OR a `knowledge` document — `doc_type` says
 * which, and is REQUIRED so the classification output can never be misattributed.
 *
 * reason: every identity field is doc-flavoured (`doc_id`/`doc_slug`/`doc_status`) —
 * the governing spec's Declared field contract (M2 of
 * spec-a-write-side-fact-with-no-read-side-address-counts-with-no) retired the
 * legacy spec-flavoured spellings this interface used to carry, so no consumer can
 * key on a spec-shaped field name and silently misread a knowledge doc's breach as
 * a spec's.
 */
export interface DriftInputEntry {
  doc_id: string;
  doc_slug: string;
  /** The owning document's type — `"spec"` or `"knowledge"` today. */
  doc_type: DocType;
  doc_status: string;
  anchor: ParsedCodeAnchor;
}

/**
 * Already-collected probe result for ONE distinct filesystem path (D4) — the
 * filesystem IO itself happens in `DriftCheckService`, never here. Every field is
 * optional because a probe may fail at any stage; `computeDrift` degrades gracefully
 * (never throws) on any combination.
 */
export interface AnchorProbe {
  /** `FsProbe.stat(path)` result, when the call succeeded. */
  stat?: "file" | "dir" | "missing";
  /** `FsProbe.listDir(path)` RAW (unfiltered) immediate children, when collected. */
  children?: string[];
  /** `FsProbe.readFile(path)` content, when collected (only meaningful for a file anchor with a symbol). */
  content?: string;
  /** The export reader's answer for this file, when a symbol anchor needed it (BR-417); absent means no reader ran. */
  exported?: ExportedNames;
  /** Set iff ANY probe call for this path threw or returned an unusable result (D4) — turns EVERY anchor on this path into a `probe_error` row. */
  error?: string;
}

/**
 * One drift row — a declared anchor that failed to affirmatively verify (D2).
 * `doc_type` is REQUIRED (see {@link DriftInputEntry}): a reader of a mixed report
 * must never have to guess whether a breach belongs to a spec or to a knowledge doc.
 */
export interface DriftRow {
  doc_id: string;
  doc_slug: string;
  /** The breaching document's type — `"spec"` or `"knowledge"` today. */
  doc_type: DocType;
  doc_status: string;
  /** The anchor's original raw string (round-tripped from `ParsedCodeAnchor.raw`). */
  anchor: string;
  kind: DriftKind;
  /** Human-readable detail — populated for `probe_error` rows (the underlying error message). */
  detail?: string;
}

/**
 * Projects one declared entry's owning-document identity onto a drift row — the ONE
 * composition site for those fields, so a future doc type cannot be added to the scan
 * while eight hand-written row literals silently keep labeling rows as before.
 *
 * @param entry - The declared anchor whose owning doc identity to copy
 * @returns The identity half of a {@link DriftRow} (never the anchor/kind half)
 */
function docIdentityOf(entry: DriftInputEntry): Pick<DriftRow, "doc_id" | "doc_slug" | "doc_type" | "doc_status"> {
  return {
    doc_id: entry.doc_id,
    doc_slug: entry.doc_slug,
    doc_type: entry.doc_type,
    doc_status: entry.doc_status,
  };
}

/** Result of {@link computeDrift}. */
export interface ComputeDriftResult {
  /** `true` ONLY when every declared anchor affirmatively verified (G11 — see class @invariant). */
  consistent: boolean;
  /** Every anchor that failed to verify, in input order. */
  drifts: DriftRow[];
}

/**
 * Classifies every declared anchor against its (already-collected) probe result
 * (D2). Pure — no filesystem access, unit-testable with hand-built `probes` maps.
 * Dotfile exclusion for the `dir_empty` classification (D4 — a dir containing only
 * `.gitkeep` reports `dir_empty`) is applied HERE, over the RAW `children` list a
 * probe collected, so the rule is exercised without any real filesystem.
 *
 * Classification order per anchor (first match wins):
 *   1. `probes.get(anchor.path)` absent, or its `error` set → `probe_error`
 *   2. `stat === "missing"` → `dir_missing` (isDir) or `file_missing` (else)
 *   3. `isDir` and `stat === "file"` → `node_type_mismatch`
 *   4. `isDir` and `stat === "dir"`: non-dotfile children count is 0 → `dir_empty`;
 *      else consistent (no row)
 *   5. `!isDir` and `stat === "dir"` → `node_type_mismatch`
 *   6. `!isDir` and `stat === "file"`, no `symbol` → consistent (no row)
 *   7. `!isDir` and `stat === "file"`, `symbol` set, no `content` collected →
 *      `probe_error` (can't verify without content)
 *   8. `!isDir` and `stat === "file"`, `symbol` set, export names collected
 *      (`probe.exported`): symbol in the names → consistent; not in the names and the
 *      reader marked them incomplete → `probe_error` "not measured"; not in the
 *      names and complete → `symbol_missing`. No export names collected at all →
 *      `probe_error` "not measured" (never a guess).
 *
 * @param declared - Every anchor declared across every scanned document (spec AND
 *   knowledge), each labeled with its owning doc's identity + type.
 * @param probes - Probe results keyed by `ParsedCodeAnchor.path` (one entry per
 *   DISTINCT path — probe-level dedup is the caller's job, D4).
 * @returns `{consistent, drifts}` — `consistent` is `true` iff `drifts` is empty.
 *
 * @example
 * computeDrift(
 *   [{ doc_id: "s1", doc_slug: "spec-x", doc_type: "spec", doc_status: "approved", anchor: { raw: "a.ts", path: "a.ts", isDir: false } }],
 *   new Map([["a.ts", { stat: "missing" }]]),
 * );
 * // => { consistent: false, drifts: [{ doc_id: "s1", doc_slug: "spec-x", doc_type: "spec", doc_status: "approved", anchor: "a.ts", kind: "file_missing" }] }
 */
export function computeDrift(
  declared: DriftInputEntry[],
  probes: Map<string, AnchorProbe>,
): ComputeDriftResult {
  const drifts: DriftRow[] = [];

  for (const entry of declared) {
    const { anchor } = entry;
    const probe = probes.get(anchor.path);

    if (probe === undefined || probe.error !== undefined) {
      drifts.push({
        ...docIdentityOf(entry),
        anchor: anchor.raw,
        kind: "probe_error",
        detail: probe?.error ?? `no probe result recorded for path "${anchor.path}"`,
      });
      continue;
    }

    if (probe.stat === undefined || probe.stat === "missing") {
      drifts.push({
        ...docIdentityOf(entry),
        anchor: anchor.raw,
        kind: anchor.isDir ? "dir_missing" : "file_missing",
      });
      continue;
    }

    if (anchor.isDir) {
      if (probe.stat === "file") {
        drifts.push({
          ...docIdentityOf(entry),
          anchor: anchor.raw,
          kind: "node_type_mismatch",
        });
        continue;
      }
      // probe.stat === "dir"
      const nonDotChildren = (probe.children ?? []).filter((c) => !c.startsWith("."));
      if (nonDotChildren.length === 0) {
        drifts.push({
          ...docIdentityOf(entry),
          anchor: anchor.raw,
          kind: "dir_empty",
        });
      }
      continue;
    }

    // File (or file#Symbol) anchor.
    if (probe.stat === "dir") {
      drifts.push({
        ...docIdentityOf(entry),
        anchor: anchor.raw,
        kind: "node_type_mismatch",
      });
      continue;
    }

    // probe.stat === "file"
    if (anchor.script !== undefined) {
      const scripts = probe.content === undefined ? undefined : scanPackageScripts(probe.content);
      if (scripts === undefined) {
        drifts.push({
          ...docIdentityOf(entry),
          anchor: anchor.raw,
          kind: "probe_error",
          detail: `"${anchor.path}" is unreadable or has no scripts object; cannot verify script "${anchor.script}"`,
        });
      } else if (!scripts.has(anchor.script)) {
        drifts.push({ ...docIdentityOf(entry), anchor: anchor.raw, kind: "script_missing" });
      }
      continue;
    }

    if (anchor.title !== undefined) {
      if (probe.content === undefined) {
        drifts.push({
          ...docIdentityOf(entry),
          anchor: anchor.raw,
          kind: "probe_error",
          detail: `file content unavailable to verify test title "${anchor.title}"`,
        });
      } else if (!scanTestTitles(probe.content).has(anchor.title)) {
        drifts.push({ ...docIdentityOf(entry), anchor: anchor.raw, kind: "symbol_missing" });
      }
      continue;
    }

    if (anchor.symbol === undefined) {
      continue; // plain file anchor, exists — consistent.
    }

    if (probe.content === undefined || probe.exported === undefined) {
      drifts.push({
        ...docIdentityOf(entry),
        anchor: anchor.raw,
        kind: "probe_error",
        detail: `not measured: exported names unavailable to verify symbol "${anchor.symbol}"`,
      });
      continue;
    }

    if (probe.exported.names.has(anchor.symbol)) continue;
    if (probe.exported.notMeasured !== undefined) {
      // reason: BR-417 — a name missing from an INCOMPLETE list is not proven absent; reporting it
      // `symbol_missing` would be a guess in the false-alarm direction.
      drifts.push({
        ...docIdentityOf(entry),
        anchor: anchor.raw,
        kind: "probe_error",
        detail: `not measured: symbol "${anchor.symbol}" not found, and the file's exports are incomplete (${probe.exported.notMeasured})`,
      });
      continue;
    }
    drifts.push({
      ...docIdentityOf(entry),
      anchor: anchor.raw,
      kind: "symbol_missing",
    });
  }

  return { consistent: drifts.length === 0, drifts };
}
