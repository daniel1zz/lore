/**
 * Content-dimension admission checks + the SOLE composition entry for the
 * memory-file admission mechanism (spec-claude-md-governance-content-
 * dimension-checks-wire-the). Absorbs `checkReferenceExistence` and
 * `detectNarrativeSmells` verbatim from the pre-split `claude-md-check.ts`
 * (spec-context-verb-family-two-zone-claude-md-anatomy-lore, AC-CTX-2), and
 * adds the ONE seam every production call site must route through:
 * `runMemoryFileChecks`. Mirrors `claude-md-budget.ts`'s purity convention:
 * this module never touches a `StoreInterface`, the filesystem, or
 * wall-clock time — every fact it needs (a memory file's path/role/content,
 * the corpus-governed budget, whether a candidate path/slug exists) is
 * passed in by the caller (the CLI adapter reads files via
 * `real-memory-file-probe.ts`; existence via caller-owned `fileExists`/
 * `docExists` predicates — this module never calls `fs` or the store
 * itself).
 *
 * Public surface:
 *   - AdmissionDeps — `{ fileExists, docExists }`, the injected existence
 *     predicates every content check needs. `docExists` is accepted but NOT
 *     YET consumed by any check in this slice (`checkSlugPointers`, the
 *     first consumer, lands in Phase 2 — spec §Scope N2) — it is declared
 *     now so `runMemoryFileChecks`'s signature never needs to change shape
 *     when that check lands.
 *   - runMemoryFileChecks(files, budgets, deps) — the SOLE composition
 *     entry (spec §Module Boundary): folds `claude-md-budget.ts`'s
 *     `lintMemoryFiles` (deterministic) together with this module's
 *     `checkReferenceExistence` + `detectNarrativeSmells` (advisory) across
 *     every file. `status.ts` and `flows/context-flow.ts` call ONLY this —
 *     neither may reference an individual metric function directly (two
 *     independent call sites composing their own subset is the exact drift
 *     this mechanism shipped with: `checkReferenceExistence`/
 *     `detectNarrativeSmells` had ZERO production call sites despite full
 *     unit coverage). `computeHeadroom`/`computeHeadroomWarnings` are
 *     deliberately OUTSIDE this composition — they are a REPORTING layer,
 *     never a check (see `claude-md-budget.ts`'s header).
 *   - checkReferenceExistence(content, fileExists) — ADVISORY,
 *     `kind: "reference_missing"` (N13: migrated FROM
 *     `MemoryFileFindingKind` to `AdvisoryFindingKind` — see
 *     `claude-md-findings.ts`'s header. It was typed deterministic and had
 *     zero call sites; this retracts a false claim rather than removing
 *     enforcement). Extracts backtick-quoted, repo-relative-looking path
 *     candidates from `content` and reports the ones `fileExists` says are
 *     absent.
 *   - detectNarrativeSmells(content) — ADVISORY ONLY, NEVER exit-relevant:
 *     flags ISO-date density (at or above the exported
 *     `ISO_DATE_DENSITY_THRESHOLD`) and status wording ("not yet" /
 *     "pending" / TODO-style markers) that suggest transient status
 *     narrative leaking into a standing-discipline file.
 *
 * Invariants:
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
 *   - `detectNarrativeSmells` NEVER affects `checkReferenceExistence`'s
 *     output, `claude-md-budget.ts`'s `lintMemoryFiles` output, or any exit
 *     code (spec §D7: advisory findings are a structurally distinct type,
 *     never an extra `kind` on `MemoryFileFinding`).
 *   - `runMemoryFileChecks`'s `deterministic` array is `lintMemoryFiles`'s
 *     output UNCHANGED (same findings, same order) — this composition never
 *     re-derives or filters a deterministic verdict, only computes advisory
 *     findings alongside it.
 *
 * Side-effect class: pure
 *
 * Source: spec-claude-md-governance-content-dimension-checks-wire-the,
 * AC-WIRE-1/AC-WIRE-2/AC-COMPOSE-1/AC-PURE-1; spec-context-verb-family-two-
 * zone-claude-md-anatomy-lore, AC-CTX-2.
 */

import { normalizeFileAnchors, type MemoryFileBudgets } from "@lore/core";
import { lintMemoryFiles } from "./claude-md-budget.js";
import type { AdvisoryFinding, MemoryFileFinding, MemoryFileRecord } from "./claude-md-findings.js";

// ─── Reference existence (advisory, N13 / spec §D6) ─────────────────────────

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
 * grammar v1, ADVISORY, `kind: "reference_missing"` — N13 migrated this kind
 * off `MemoryFileFindingKind`; see this module's header).
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
 * @returns One `reference_missing` {@link AdvisoryFinding} per distinct absent reference.
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
): AdvisoryFinding[] {
  if (content.length === 0) return [];

  const findings: AdvisoryFinding[] = [];
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

/** ISO-8601 calendar date, e.g. `2026-07-27` — the status-narrative timestamp shape this check flags. */
const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/g;

/**
 * At or above this many ISO-date stamps in one file, dates read as a status
 * timeline (event log) rather than incidental references — an arbitrary but
 * documented threshold, not a config value (advisory-only, spec §D8: no
 * config-declared registry for this kind of heuristic). Exported so callers
 * (and tests) read the boundary rather than restating the number
 * (AC-WIRE-2).
 */
export const ISO_DATE_DENSITY_THRESHOLD = 3;

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

// ─── Composition (the SOLE entry — spec §Module Boundary, AC-COMPOSE-1) ────

/**
 * Injected existence predicates every content check needs — this module
 * never calls `fs` or the store itself (module header). `docExists` is
 * accepted but NOT YET consumed by any check in this slice; declared now so
 * {@link runMemoryFileChecks}'s signature does not change shape once
 * `checkSlugPointers` (Phase 2) lands.
 */
export interface AdmissionDeps {
  /** Caller-owned repo-relative-path existence predicate — backs `checkReferenceExistence`. */
  fileExists: (p: string) => boolean;
  /** Caller-owned corpus-slug existence predicate — NOT YET consumed (Phase 2: `checkSlugPointers`). */
  docExists: (slug: string) => boolean;
}

/**
 * The SOLE composition entry for the memory-file admission mechanism (spec
 * §Module Boundary) — folds `claude-md-budget.ts`'s `lintMemoryFiles`
 * (deterministic) together with this module's `checkReferenceExistence` +
 * `detectNarrativeSmells` (advisory) across every file in `files`.
 * `adapters/cli/commands/status.ts` and `flows/context-flow.ts` call ONLY
 * this (AC-COMPOSE-1) — see this module's header for why.
 *
 * @param files - Discovered memory files (see {@link MemoryFileRecord}).
 * @param budgets - Corpus-governed ceilings, resolved via
 *   `resolveMemoryFileBudgets` (`@lore/core`) — never hardcoded.
 * @param deps - `{ fileExists, docExists }` — see {@link AdmissionDeps}.
 * @returns `deterministic` — `lintMemoryFiles`'s output, unchanged, over
 *   `files`. `advisory` — every `checkReferenceExistence` +
 *   `detectNarrativeSmells` finding across all `files`, in file order.
 * @example
 * runMemoryFileChecks(
 *   [{ path: "CLAUDE.md", role: "root", content: "See `gone.ts`." }],
 *   resolveMemoryFileBudgets(config),
 *   { fileExists: () => false, docExists: () => true },
 * );
 * // => { deterministic: [], advisory: [{ kind: "reference_missing", ... }] }
 */
export function runMemoryFileChecks(
  files: MemoryFileRecord[],
  budgets: MemoryFileBudgets,
  deps: AdmissionDeps,
): { deterministic: MemoryFileFinding[]; advisory: AdvisoryFinding[] } {
  const deterministic = lintMemoryFiles(files, budgets);

  const advisory: AdvisoryFinding[] = [];
  for (const file of files) {
    advisory.push(...checkReferenceExistence(file.content, deps.fileExists));
    advisory.push(...detectNarrativeSmells(file.content));
  }

  return { deterministic, advisory };
}
