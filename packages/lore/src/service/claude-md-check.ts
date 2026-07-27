/**
 * SPEC-project-claude-md-content-contract-governance-injected /
 * spec-context-verb-family-two-zone-claude-md-anatomy-lore — pure admission
 * checks backing `lore status --check-claude-md`. Mirrors
 * `prd-budget-check.ts`'s purity convention: this module never touches a
 * `StoreInterface`, the filesystem, or wall-clock time; every fact it needs
 * (a memory file's path/role/content, the corpus-governed budget, whether a
 * candidate path exists) is passed in by the caller (the CLI adapter reads
 * files via `real-memory-file-probe.ts`, config via
 * `resolveMemoryFileBudgets`, and existence via a caller-owned `fileExists`
 * predicate — this module never calls `fs` itself).
 *
 * Public surface:
 *   - lintMemoryFiles(files, budgets) — the full ceiling oracle: for every
 *     file, measures line count AND `Buffer.byteLength` and reports every
 *     ceiling breach (never short-circuits after the first). DETERMINISTIC,
 *     exit-relevant (`kind: "max_lines" | "max_bytes"`).
 *   - checkReferenceExistence(content, fileExists) — DETERMINISTIC,
 *     exit-relevant (`kind: "reference_missing"`): extracts backtick-quoted,
 *     repo-relative-looking path candidates from `content` and reports the
 *     ones `fileExists` says are absent.
 *   - detectNarrativeSmells(content) — ADVISORY ONLY, NEVER exit-relevant:
 *     flags ISO-date density and status wording ("not yet" / "pending" /
 *     TODO-style markers) that suggest transient status narrative leaking
 *     into a standing-discipline file. Returns a wholly separate
 *     `AdvisoryFinding[]` type — never mixed into `MemoryFileFinding[]`.
 *
 * Invariants:
 *   - `budgets.enabled === false` short-circuits `lintMemoryFiles` to zero
 *     findings for every input, regardless of content (spec §D1: the check
 *     is a global opt-out, never a per-file one).
 *   - Both `lintMemoryFiles` metrics are ALWAYS measured for every file,
 *     independently — a file over both ceilings produces two findings
 *     (`max_lines` AND `max_bytes`), never just the first one hit (spec §D2:
 *     each metric catches a bloat class the other misses).
 *   - Line count is `content.split("\n").length`, minus 1 when content ends
 *     with `"\n"` (the trailing empty element after a final-newline split is
 *     not itself a line) — mirrors `receipt-log.ts`'s established convention
 *     for this exact ambiguity.
 *   - Byte count is `Buffer.byteLength(content, "utf8")`, never
 *     `content.length` (UTF-16 code units) — a CJK-heavy file can sit well
 *     under a `.length`-based ceiling while its real UTF-8 byte size is
 *     multiples over it (the false-oracle class this module exists to
 *     catch).
 *   - Each role (`"root"` | `"module"`) is checked against its OWN ceiling
 *     pair from `budgets` — never a single shared ceiling.
 *   - `checkReferenceExistence`'s reference grammar (v1, spec §D6) is
 *     deliberately conservative: a candidate is a backtick-quoted token that
 *     contains `/`, has no whitespace, and does not start with a URL scheme
 *     (`https://` etc.). A `path#Symbol` suffix is a fragment on a file
 *     path — only the file part is existence-checked. Candidate paths are
 *     normalized via `@lore/core`'s `normalizeFileAnchors` — the SAME
 *     normalizer `task.extra.file_anchors` (SPEC-042) uses — rather than
 *     re-deriving segment/leading-slash/`..` rules locally; a candidate that
 *     fails that normalization (e.g. contains `..`) is silently skipped, not
 *     reported (misses are acceptable, false alarms are not — spec Risks).
 *     Existence is decided EXCLUSIVELY via the injected `fileExists`
 *     predicate, never real `fs` access — keeps this module store-free and
 *     fs-free (spec §Module Boundary: "No store/DB dependency anywhere").
 *   - `detectNarrativeSmells` NEVER affects `checkReferenceExistence` or
 *     `lintMemoryFiles`'s output and NEVER affects exit-relevant shape (spec
 *     §D7: "narrative smells NEVER exit-affecting" — advisory findings are a
 *     structurally distinct type, not an extra `kind` on `MemoryFileFinding`).
 *
 * Side-effect class: pure
 *
 * Source: spec-project-claude-md-content-contract-governance-injected,
 * AC-CMC-1; spec-context-verb-family-two-zone-claude-md-anatomy-lore, AC-CTX-2
 */

import { normalizeFileAnchors, type MemoryFileBudgets } from "@lore/core";

// ─── Memory File Record (caller-assembled, e.g. by real-memory-file-probe.ts) ─

/** A discovered project memory file's role — governs which ceiling pair applies. */
export type MemoryFileRole = "root" | "module";

/**
 * One memory file's facts as measured by the caller (typically
 * `real-memory-file-probe.ts`'s filesystem discovery walk). `content` is the
 * file's raw text — `lintMemoryFiles` does all line/byte measurement itself
 * from this single value (module header's single-measurement-point
 * invariant), never from caller-precomputed counts.
 */
export interface MemoryFileRecord {
  /** Repo-relative path, used verbatim in finding messages. */
  path: string;
  role: MemoryFileRole;
  content: string;
}

// ─── Finding ────────────────────────────────────────────────────────────────

/**
 * Which check a {@link MemoryFileFinding} reports a breach of. `max_lines`
 * and `max_bytes` come from `lintMemoryFiles`; `reference_missing` comes from
 * `checkReferenceExistence` (spec §D6/D7) — all three are DETERMINISTIC and
 * exit-relevant. Narrative smells are NOT a `MemoryFileFindingKind` — they
 * are a wholly separate `AdvisoryFinding`/`AdvisoryFindingKind` family
 * (spec §D7: advisory never shares a shape with deterministic findings).
 */
export type MemoryFileFindingKind = "max_lines" | "max_bytes" | "reference_missing";

/**
 * One deterministic, exit-relevant admission-check finding — flat and
 * serializable (CLI rendering is the caller's job, this module never
 * formats output beyond the `message` field). A single flat shape rather
 * than a `kind`-discriminated union ON PURPOSE: `lintMemoryFiles`'s existing
 * finding construction (`role`/`measured`/`ceiling`, always present) is
 * intentionally UNCHANGED by this extension, and callers that read those
 * fields off a `max_lines`/`max_bytes` finding do so without first
 * narrowing on `kind` (see `claude-md-admission.test.ts`'s REGRESSION case —
 * this shape is the pinned contract). `checkReferenceExistence` findings
 * instead populate `reference` and leave `role`/`measured`/`ceiling` absent
 * (there is no "ceiling" concept for a missing reference).
 *
 * @remark A `kind`-keyed discriminated union (`BudgetFinding |
 *   ReferenceMissingFinding`) was the first design tried here — rejected
 *   because the RED test suite reads `.measured`/`.role`/`.ceiling` off a
 *   `lintMemoryFiles` result WITHOUT a `kind` narrowing check first (direct
 *   `findings[0]?.measured` after only asserting `findings[0]?.kind`, which
 *   does not narrow for `expect()` calls) — a union makes those fields
 *   inaccessible without narrowing and fails `tsc --noEmit` against the
 *   test file, which this task must not edit. Test shape wins over the
 *   union pattern this codebase otherwise prefers for state (see
 *   `references/state-as-data.md`).
 */
export interface MemoryFileFinding {
  /** For `max_lines`/`max_bytes`: the linted memory file's path. For `reference_missing`: the missing (normalized) reference target's path. */
  path: string;
  kind: MemoryFileFindingKind;
  /** Present only for `max_lines`/`max_bytes` — the linted file's declared role. */
  role?: MemoryFileRole;
  /** Present only for `max_lines`/`max_bytes` — the measured line count or byte count. */
  measured?: number;
  /** Present only for `max_lines`/`max_bytes` — the ceiling that was exceeded. */
  ceiling?: number;
  /** Present only for `reference_missing` — the raw backtick-quoted token as it appeared in content, fragment included. */
  reference?: string;
  /** Human-readable summary — always names `path`. */
  message: string;
}

// ─── Measurement ────────────────────────────────────────────────────────────

/**
 * Counts lines the same way this module's fixtures/spec define "a line":
 * `content.split("\n").length`, minus 1 when content ends with `"\n"` (the
 * trailing empty element after a final-newline split is not itself a line).
 */
function countLines(content: string): number {
  const parts = content.split("\n");
  return content.endsWith("\n") ? parts.length - 1 : parts.length;
}

// ─── Lint ───────────────────────────────────────────────────────────────────

/**
 * Lints every memory file's line count and UTF-8 byte size against its
 * role's ceiling pair.
 *
 * @param files - Discovered memory files (see {@link MemoryFileRecord}).
 * @param budgets - Corpus-governed ceilings, resolved via
 *   `resolveMemoryFileBudgets` (`@lore/core`) — never hardcoded here.
 * @returns One {@link MemoryFileFinding} per breached ceiling. Empty array
 *   when `budgets.enabled` is `false`, `files` is empty, or every file is
 *   within both ceilings for its role.
 * @example
 * lintMemoryFiles(
 *   [{ path: "CLAUDE.md", role: "root", content: "..." }],
 *   resolveMemoryFileBudgets(config),
 * );
 * // => [{ path: "CLAUDE.md", role: "root", kind: "max_lines", measured: 301, ceiling: 300, message: "..." }]
 */
export function lintMemoryFiles(
  files: MemoryFileRecord[],
  budgets: MemoryFileBudgets,
): MemoryFileFinding[] {
  if (!budgets.enabled) return [];

  const findings: MemoryFileFinding[] = [];

  for (const file of files) {
    const ceilings = budgets[file.role];

    const lineCount = countLines(file.content);
    if (lineCount > ceilings.max_lines) {
      findings.push({
        path: file.path,
        role: file.role,
        kind: "max_lines",
        measured: lineCount,
        ceiling: ceilings.max_lines,
        message: `${file.path} is ${lineCount} lines, exceeding the ${file.role} max_lines ceiling of ${ceilings.max_lines}`,
      });
    }

    const byteCount = Buffer.byteLength(file.content, "utf8");
    if (byteCount > ceilings.max_bytes) {
      findings.push({
        path: file.path,
        role: file.role,
        kind: "max_bytes",
        measured: byteCount,
        ceiling: ceilings.max_bytes,
        message: `${file.path} is ${byteCount} bytes, exceeding the ${file.role} max_bytes ceiling of ${ceilings.max_bytes}`,
      });
    }
  }

  return findings;
}

// ─── Reference existence (deterministic, AC-CTX-2 / spec §D6) ──────────────

/**
 * Matches a backtick-quoted token with no backtick/whitespace inside — this
 * ALSO naturally excludes shell-command-with-args tokens like `` `bun
 * install` `` (the space breaks the match before a closing backtick is
 * found), so the "no whitespace" grammar rule needs no separate check.
 */
const BACKTICK_TOKEN_RE = /`([^`\s]+)`/g;

/** Matches a leading URI scheme (`https://`, `ftp://`, ...) — RFC 3986 §3.1 scheme grammar. */
const URL_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

/**
 * Extracts backtick-quoted, repo-relative-looking path candidates from
 * `content` and reports the ones `fileExists` says are absent (spec §D6
 * grammar v1, deterministic, exit-relevant `kind: "reference_missing"`).
 *
 * Candidate grammar: a backtick-quoted token that contains `/`, has no
 * whitespace, and does not start with a URL scheme. A `path#Symbol` suffix
 * is a fragment on top of a file path — only the file part (text before the
 * first `#`) is existence-checked. Candidates are normalized through
 * `@lore/core`'s `normalizeFileAnchors` (the SAME normalizer
 * `task.extra.file_anchors` uses, SPEC-042) — a candidate that fails that
 * normalization (e.g. an escaping `..` segment) is silently skipped rather
 * than reported, matching the module's "misses acceptable, false alarms
 * not" risk posture. Duplicate missing references (same normalized path)
 * report once, first occurrence order preserved.
 *
 * @param content - Raw file text to scan (e.g. a CLAUDE.md body).
 * @param fileExists - Caller-owned existence predicate — the SOLE source of
 *   truth for "does this path exist"; this module never touches `fs`.
 * @returns One `reference_missing` {@link MemoryFileFinding} per distinct absent reference.
 *   Empty array on empty `content`, when no candidate matches the grammar,
 *   or when every candidate exists.
 * @example
 * checkReferenceExistence(
 *   "See `packages/lore/src/gone.ts` for details.",
 *   (p) => p !== "packages/lore/src/gone.ts",
 * );
 * // => [{ kind: "reference_missing", path: "packages/lore/src/gone.ts", ... }]
 */
export function checkReferenceExistence(
  content: string,
  fileExists: (p: string) => boolean,
): MemoryFileFinding[] {
  if (content.length === 0) return [];

  const findings: MemoryFileFinding[] = [];
  const alreadyReported = new Set<string>();

  for (const match of content.matchAll(BACKTICK_TOKEN_RE)) {
    const token = match[1];
    if (token === undefined || !token.includes("/")) continue;
    if (URL_SCHEME_RE.test(token)) continue;

    const hashIndex = token.indexOf("#");
    const filePart = hashIndex === -1 ? token : token.slice(0, hashIndex);
    if (filePart.length === 0) continue;

    const normalized = normalizeFileAnchors([filePart]);
    if (!normalized.ok) continue; // not a valid repo-relative path (SPEC-042 grammar) — noise, not a finding

    const normalizedPath = normalized.value[0];
    if (normalizedPath === undefined || alreadyReported.has(normalizedPath)) continue;

    if (!fileExists(normalizedPath)) {
      alreadyReported.add(normalizedPath);
      findings.push({
        kind: "reference_missing",
        path: normalizedPath,
        reference: token,
        message: `\`${normalizedPath}\` is referenced but does not exist`,
      });
    }
  }

  return findings;
}

// ─── Narrative smells (advisory, AC-CTX-2 / spec §D7) ───────────────────────

/** Which smell an {@link AdvisoryFinding} flags — NEVER a {@link MemoryFileFindingKind}. */
export type AdvisoryFindingKind = "iso_date_density" | "status_word";

/**
 * One narrative-smell observation — structurally SEPARATE from
 * {@link MemoryFileFinding} on purpose (spec §D7: advisory findings must
 * never be mistakable for, or merged into, a deterministic exit-relevant
 * finding).
 */
export interface AdvisoryFinding {
  kind: AdvisoryFindingKind;
  /** Occurrence count backing `message`. */
  measured: number;
  /** Human-readable summary. */
  message: string;
}

/** ISO-8601 calendar date, e.g. `2026-07-27` — the status-narrative timestamp shape this check flags. */
const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/g;

/**
 * At or above this many ISO-date stamps in one file, dates read as a status
 * timeline (event log) rather than incidental references — an arbitrary but
 * documented threshold, not a config value (advisory-only, spec §D8: no
 * config-declared registry for this kind of heuristic).
 */
const ISO_DATE_DENSITY_THRESHOLD = 3;

/** Status-narrative wording this check flags, each independently counted. */
const STATUS_WORD_PATTERNS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: "not yet", re: /\bnot yet\b/gi },
  { label: "pending", re: /\bpending\b/gi },
  { label: "TODO-style marker (TODO/FIXME/XXX/HACK)", re: /\b(?:TODO|FIXME|XXX|HACK)\b/g },
];

/**
 * Flags ISO-date density and status wording that suggest transient status
 * narrative (events, timelines, "not yet done") has leaked into a
 * standing-discipline memory file. ADVISORY ONLY — never affects
 * `checkReferenceExistence`/`lintMemoryFiles` output or any exit code (spec
 * §D7); callers surface these as suggestions, never gate on them.
 *
 * @param content - Raw file text to scan.
 * @returns Zero or more {@link AdvisoryFinding}s. Empty array on empty
 *   `content` or when no smell threshold is met.
 * @example
 * detectNarrativeSmells("Shipped on 2026-07-20, fixed 2026-07-22, closed 2026-07-27.");
 * // => [{ kind: "iso_date_density", measured: 3, message: "..." }]
 */
export function detectNarrativeSmells(content: string): AdvisoryFinding[] {
  if (content.length === 0) return [];

  const findings: AdvisoryFinding[] = [];

  const isoMatches = content.match(ISO_DATE_RE) ?? [];
  if (isoMatches.length >= ISO_DATE_DENSITY_THRESHOLD) {
    findings.push({
      kind: "iso_date_density",
      measured: isoMatches.length,
      message: `content contains ${isoMatches.length} ISO-date stamps — reads as a status timeline; dated events belong in the lore corpus, not standing discipline`,
    });
  }

  for (const { label, re } of STATUS_WORD_PATTERNS) {
    const matches = content.match(re) ?? [];
    if (matches.length > 0) {
      findings.push({
        kind: "status_word",
        measured: matches.length,
        message: `content contains ${matches.length} occurrence(s) of status wording (${label}) — consider whether this belongs in the corpus instead`,
      });
    }
  }

  return findings;
}
