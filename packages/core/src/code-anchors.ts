/**
 * Code anchors — spec-declared `path[#Symbol]` bindings + the pure drift-detection
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
 *   - scanExportedSymbols(source) — lexical, line-anchored export scan (D3)
 *   - computeDrift(declared, probes) — classifies each declared anchor against
 *     already-collected probe results into one of six drift kinds (D2)
 *   - ParsedCodeAnchor / DriftKind / DriftRow / DriftInputEntry / AnchorProbe /
 *     ComputeDriftResult — the public shapes above operate on
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
 * @invariant Symbol grammar: `/^[A-Za-z_$][A-Za-z0-9_$]*$/`, ASCII-only — a
 *   Unicode-named export cannot be anchored (explicit Scope-Out; authoring rejects it
 *   LOUD). The regex deliberately admits reserved words (`default` is meaningful,
 *   D3's `export default` form; others simply never match a real export and surface
 *   as `symbol_missing` — the tolerated false-positive direction, review S9). A
 *   directory anchor (trailing `/`) MUST NOT carry a `#Symbol` — loud reject.
 * @invariant `scanExportedSymbols` is deliberately lexical, not a real parser — see
 *   the D3 form list in this module's JSDoc on the function itself. It does not
 *   understand `export * from`, `module.exports`, re-export chains, `export type
 *   { X }` (type-only brace lists), or destructured exports (`export const {a, b} =
 *   obj`) — all documented false-positive sources (the doc still exists, the symbol
 *   still exists, but the anchor reports `symbol_missing`). This trades false
 *   positives for a guaranteed absence of false negatives (G11) — a real export the
 *   scanner CAN parse is never missed.
 * @invariant `computeDrift`'s `consistent` is `true` ONLY when every declared anchor
 *   affirmatively verifies — any `probe_error`/`*_missing`/`node_type_mismatch`/
 *   `symbol_missing` row flips it `false`. A probe error is drift, never a silent
 *   scan abort (D4, G11's "including under probe IO errors" clause).
 *
 * Side-effect class: pure
 *
 * Source: SPEC-045 §Design Decisions D1, D2, D3, D4; §Acceptance Criteria AC-DR-1
 */

import { err, ok } from "./errors.js";
import type { Result, LoreError } from "./errors.js";
import { normalizeFileAnchors } from "./file-anchors.js";

// ─── Grammar (D1) ───────────────────────────────────────────────────────────

/** ASCII-only JS identifier grammar for a code anchor's `#Symbol` suffix (D1). */
const CODE_ANCHOR_SYMBOL_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

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
}

/**
 * Parses and grammar-validates ONE full raw code-anchor string (D1). Splits on the
 * LAST `#` (a path may legally contain earlier `#` characters); the path part is
 * validated + normalized via {@link normalizeFileAnchors} called with a ONE-ELEMENT
 * array (never batched — see this module's class @invariant).
 *
 * @param raw - One candidate anchor string, e.g. `"src/x.ts"`, `"src/x.ts#Exported"`,
 *   `"src/dir/"`.
 * @returns `ok(parsed)` or `err(VALIDATION_ERROR)` naming the offending raw string on
 *   the first grammar violation (bad path, dir+symbol, non-ASCII/malformed symbol).
 * @throws Never — always returns a Result.
 *
 * @example
 * parseCodeAnchor("src/a.ts#Foo");
 * // => ok({ raw: "src/a.ts#Foo", path: "src/a.ts", isDir: false, symbol: "Foo" })
 * @example
 * parseCodeAnchor("src/dir/#Foo");
 * // => err({ code: "VALIDATION_ERROR", field: "code_anchors", ... }) — dir + symbol
 * @example
 * parseCodeAnchor("src/a.ts#名前");
 * // => err(...) — non-ASCII symbol
 */
export function parseCodeAnchor(raw: string): Result<ParsedCodeAnchor, LoreError> {
  const hashIndex = raw.lastIndexOf("#");
  const pathPart = hashIndex === -1 ? raw : raw.slice(0, hashIndex);
  const symbolPart = hashIndex === -1 ? undefined : raw.slice(hashIndex + 1);

  const pathResult = normalizeFileAnchors([pathPart]);
  if (!pathResult.ok) {
    const underlying = pathResult.error;
    const underlyingMessage = underlying.code === "VALIDATION_ERROR" ? underlying.message : "invalid path";
    return err({
      code: "VALIDATION_ERROR",
      field: "code_anchors",
      message: `invalid code anchor "${raw}": ${underlyingMessage}`,
      value: raw,
    });
  }

  const normalizedPath = pathResult.value[0];
  if (normalizedPath === undefined) {
    return err({
      code: "VALIDATION_ERROR",
      field: "code_anchors",
      message: `code anchor normalizes to an empty path: "${raw}"`,
      value: raw,
    });
  }
  const isDir = normalizedPath.endsWith("/");
  const path = isDir ? normalizedPath.slice(0, -1) : normalizedPath;

  if (symbolPart === undefined) {
    return ok({ raw, path, isDir });
  }

  if (isDir) {
    return err({
      code: "VALIDATION_ERROR",
      field: "code_anchors",
      message: `directory anchor must not carry a #Symbol: "${raw}"`,
      value: raw,
    });
  }

  if (!CODE_ANCHOR_SYMBOL_RE.test(symbolPart)) {
    return err({
      code: "VALIDATION_ERROR",
      field: "code_anchors",
      message:
        `code anchor symbol must be an ASCII identifier matching ` +
        `/^[A-Za-z_$][A-Za-z0-9_$]*$/: "${raw}"`,
      value: raw,
    });
  }

  return ok({ raw, path, isDir: false, symbol: symbolPart });
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

// ─── Lexical Export Scan (D3) ───────────────────────────────────────────────

/**
 * Lexical, line-anchored export scan (D3) — NOT a real parser (no TS compiler
 * API/LSP, no comment/string-literal awareness beyond line anchoring). Matches, at
 * the START of a line (leading whitespace/tabs allowed — a `// export const X`
 * comment or a `foo(); export const X` mid-line occurrence does NOT match, since
 * neither has `export` as the first non-whitespace token on its line):
 *
 *   - `export (const|let|var|function|async function|class|abstract class|type|
 *     interface|enum) X` — single-identifier forms
 *   - `export { A, B as C }` — brace lists, MAY span multiple lines; `as` alias
 *     exports the ALIAS (`C`, not `B`)
 *   - `export default` — matches anchor symbol `"default"` regardless of what
 *     follows (`export default function foo() {}` still yields `"default"`)
 *
 * Deliberately NOT matched (documented false-positive sources — the export may be
 * real, but this scanner cannot see it): `export * from`, `module.exports`,
 * re-export chains, `export type { X }` (type-only brace lists — the `type` keyword
 * between `export` and `{` breaks the brace-list pattern by construction), and
 * destructured exports (`export const {a, b} = obj` — the identifier-class pattern
 * requires a bare identifier immediately after the keyword, not a `{`).
 *
 * @param source - Full file text of the ONE anchored file.
 * @returns Every exported symbol name this scanner recognizes (deduplicated).
 *
 * @example
 * scanExportedSymbols("export const Foo = 1;\nexport { Bar as Baz };\n// export const Hidden = 1;");
 * // => Set(["Foo", "Baz"]) — "Hidden" is commented out, never matched
 */
export function scanExportedSymbols(source: string): Set<string> {
  const symbols = new Set<string>();

  const singleRe =
    /^[ \t]*export\s+(?:const|let|var|function|async\s+function|abstract\s+class|class|type|interface|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm;
  for (const match of source.matchAll(singleRe)) {
    const name = match[1];
    if (name !== undefined) symbols.add(name);
  }

  const defaultRe = /^[ \t]*export\s+default\b/m;
  if (defaultRe.test(source)) symbols.add("default");

  const braceRe = /^[ \t]*export\s*\{([\s\S]*?)\}/gm;
  for (const match of source.matchAll(braceRe)) {
    const body = match[1] ?? "";
    for (const rawEntry of body.split(",")) {
      const entry = rawEntry.trim();
      if (entry.length === 0) continue;
      const aliasMatch = entry.match(
        /^([A-Za-z_$][A-Za-z0-9_$]*)\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)$/,
      );
      if (aliasMatch) {
        const alias = aliasMatch[2];
        if (alias !== undefined) symbols.add(alias);
      } else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(entry)) {
        symbols.add(entry);
      }
      // else: malformed/unsupported brace-list entry (e.g. `type X`) — silently
      // skipped, not this lexical scanner's job to validate syntax.
    }
  }

  return symbols;
}

// ─── Drift Classification (D2, D4) ──────────────────────────────────────────

/** The six drift kinds `computeDrift` classifies a declared anchor into (D2). */
export const DRIFT_KINDS = [
  "file_missing",
  "dir_missing",
  "dir_empty",
  "symbol_missing",
  "node_type_mismatch",
  "probe_error",
] as const;

/** Derived TypeScript type for a drift row's classification. */
export type DriftKind = (typeof DRIFT_KINDS)[number];

/** One declared anchor, labeled with its owning spec's identity (D2/D4 input shape). */
export interface DriftInputEntry {
  spec_id: string;
  spec_slug: string;
  spec_status: string;
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
  /** Set iff ANY probe call for this path threw or returned an unusable result (D4) — turns EVERY anchor on this path into a `probe_error` row. */
  error?: string;
}

/** One drift row — a declared anchor that failed to affirmatively verify (D2). */
export interface DriftRow {
  spec_id: string;
  spec_slug: string;
  spec_status: string;
  /** The anchor's original raw string (round-tripped from `ParsedCodeAnchor.raw`). */
  anchor: string;
  kind: DriftKind;
  /** Human-readable detail — populated for `probe_error` rows (the underlying error message). */
  detail?: string;
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
 *   8. `!isDir` and `stat === "file"`, `symbol` set, content collected: symbol not
 *      in `scanExportedSymbols(content)` → `symbol_missing`; else consistent
 *
 * @param declared - Every anchor declared across every scanned spec, spec-labeled.
 * @param probes - Probe results keyed by `ParsedCodeAnchor.path` (one entry per
 *   DISTINCT path — probe-level dedup is the caller's job, D4).
 * @returns `{consistent, drifts}` — `consistent` is `true` iff `drifts` is empty.
 *
 * @example
 * computeDrift(
 *   [{ spec_id: "s1", spec_slug: "spec-x", spec_status: "approved", anchor: { raw: "a.ts", path: "a.ts", isDir: false } }],
 *   new Map([["a.ts", { stat: "missing" }]]),
 * );
 * // => { consistent: false, drifts: [{ spec_id: "s1", spec_slug: "spec-x", spec_status: "approved", anchor: "a.ts", kind: "file_missing" }] }
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
        spec_id: entry.spec_id,
        spec_slug: entry.spec_slug,
        spec_status: entry.spec_status,
        anchor: anchor.raw,
        kind: "probe_error",
        detail: probe?.error ?? `no probe result recorded for path "${anchor.path}"`,
      });
      continue;
    }

    if (probe.stat === undefined || probe.stat === "missing") {
      drifts.push({
        spec_id: entry.spec_id,
        spec_slug: entry.spec_slug,
        spec_status: entry.spec_status,
        anchor: anchor.raw,
        kind: anchor.isDir ? "dir_missing" : "file_missing",
      });
      continue;
    }

    if (anchor.isDir) {
      if (probe.stat === "file") {
        drifts.push({
          spec_id: entry.spec_id,
          spec_slug: entry.spec_slug,
          spec_status: entry.spec_status,
          anchor: anchor.raw,
          kind: "node_type_mismatch",
        });
        continue;
      }
      // probe.stat === "dir"
      const nonDotChildren = (probe.children ?? []).filter((c) => !c.startsWith("."));
      if (nonDotChildren.length === 0) {
        drifts.push({
          spec_id: entry.spec_id,
          spec_slug: entry.spec_slug,
          spec_status: entry.spec_status,
          anchor: anchor.raw,
          kind: "dir_empty",
        });
      }
      continue;
    }

    // File (or file#Symbol) anchor.
    if (probe.stat === "dir") {
      drifts.push({
        spec_id: entry.spec_id,
        spec_slug: entry.spec_slug,
        spec_status: entry.spec_status,
        anchor: anchor.raw,
        kind: "node_type_mismatch",
      });
      continue;
    }

    // probe.stat === "file"
    if (anchor.symbol === undefined) {
      continue; // plain file anchor, exists — consistent.
    }

    if (probe.content === undefined) {
      drifts.push({
        spec_id: entry.spec_id,
        spec_slug: entry.spec_slug,
        spec_status: entry.spec_status,
        anchor: anchor.raw,
        kind: "probe_error",
        detail: `file content unavailable to verify symbol "${anchor.symbol}"`,
      });
      continue;
    }

    const exported = scanExportedSymbols(probe.content);
    if (!exported.has(anchor.symbol)) {
      drifts.push({
        spec_id: entry.spec_id,
        spec_slug: entry.spec_slug,
        spec_status: entry.spec_status,
        anchor: anchor.raw,
        kind: "symbol_missing",
      });
    }
  }

  return { consistent: drifts.length === 0, drifts };
}
