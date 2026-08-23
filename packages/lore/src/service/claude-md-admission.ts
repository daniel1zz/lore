/**
 * Content-dimension admission checks + the SOLE composition entry for the
 * memory-file admission mechanism (spec-claude-md-governance-content-
 * dimension-checks-wire-the). Absorbs `checkReferenceExistence` and
 * `detectNarrativeSmells` verbatim from the pre-split `claude-md-check.ts`
 * (spec-context-verb-family-two-zone-claude-md-anatomy-lore, AC-CTX-2), adds
 * Phase 2's two new DETERMINISTIC content metrics (`checkSlugPointers`,
 * N14; `measureEmphasis`, N5/N6), and folds
 * `claude-md-budget.ts`'s reporting layer (`computeHeadroom`/
 * `computeHeadroomWarnings`, N15) INTO the ONE seam every production call
 * site must route through: `runMemoryFileChecks`. Mirrors
 * `claude-md-budget.ts`'s purity convention: this module never touches a
 * `StoreInterface`, the filesystem, or wall-clock time — every fact it needs
 * (a memory file's path/role/content, the corpus-governed budget, whether a
 * candidate path/slug exists) is passed in by the caller (the CLI adapter
 * reads files via `real-memory-file-probe.ts`; existence via caller-owned
 * `fileExists`/`docExists` predicates — this module never calls `fs` or the
 * store itself).
 *
 * Public surface:
 *   - AdmissionDeps — `{ fileExists, docExists }`, the injected existence
 *     predicates every content check needs. `docExists` backs
 *     `checkSlugPointers` (Phase 2, first consumer) — the CLI's
 *     corpus-free `--check-claude-md` branch injects `() => true` (every
 *     slug "exists", so the check never fires there — N14's own gating
 *     mechanism, not a separate code path), while `--check-memory-pointers`
 *     (a NEW corpus-loading flag) injects a real corpus-backed lookup.
 *   - runMemoryFileChecks(files, budgets, deps) — the SOLE composition
 *     entry (spec §Module Boundary), returning `{ deterministic, advisory,
 *     headroom, warnings }`: folds `claude-md-budget.ts`'s `lintMemoryFiles`
 *     + `computeHeadroom` + `computeHeadroomWarnings` together with this
 *     module's `checkReferenceExistence` + `detectNarrativeSmells`
 *     (advisory) + `checkSlugPointers` + `measureEmphasis` (deterministic)
 *     across every file. `status.ts` and `flows/context-flow.ts` call ONLY
 *     this — neither may reference an individual metric function directly
 *     (two independent call sites composing their own subset is the exact
 *     drift this mechanism shipped with: `checkReferenceExistence`/
 *     `detectNarrativeSmells` had ZERO production call sites despite full
 *     unit coverage, and Phase 1 separately let `computeHeadroom`/
 *     `computeHeadroomWarnings` bypass this entry entirely — N15 closes
 *     both holes in the SAME return shape).
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
 *   - checkSlugPointers(content, docExists) — DETERMINISTIC,
 *     `kind: "slug_pointer_missing"` (Phase 2, N14). Extracts WHOLE
 *     backtick-quoted tokens shaped like a corpus slug
 *     (`{type}-{kebab-title}`) and reports the ones `docExists` says are
 *     absent. Closes the structural blindness where
 *     `checkReferenceExistence`'s `/`-requiring grammar skips every slug
 *     pointer outright (slugs contain no `/`).
 *   - measureEmphasis(content, maxPerKb) — DETERMINISTIC,
 *     `kind: "emphasis_saturated"` (Phase 2, N5/N6). Counts emphasis
 *     markers (⛔ / IMPORTANT / MUST / NEVER) per KB and fires ONCE per file
 *     when density exceeds `maxPerKb` — a SINGLE threshold, deliberately
 *     NOT `claude-md-budget.ts`'s three-band ceiling machinery (N5: marker
 *     density is not a capacity metric).
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
 *   - `checkSlugPointers`'s grammar requires the ENTIRE backtick span to be
 *     the slug-shaped token (reusing `BACKTICK_TOKEN_RE`'s own
 *     no-whitespace rule) — this is what keeps a multi-word backtick
 *     command like `` `lore gate plan-close --explain` `` from ever being
 *     examined: the whole span contains spaces, so it is never extracted as
 *     ONE candidate, and the `plan-close` GATE NAME embedded inside it is
 *     never isolated and mistaken for a `plan-*` document slug (measured
 *     false positive, spec Risks).
 *   - `runMemoryFileChecks`'s `deterministic` array starts from
 *     `lintMemoryFiles`'s output UNCHANGED (same findings, same order),
 *     then appends `checkSlugPointers`/`measureEmphasis` findings per file —
 *     this composition never re-derives or filters a deterministic verdict,
 *     only adds to it and computes advisory findings alongside it.
 *
 * Side-effect class: pure
 *
 * Source: spec-claude-md-governance-content-dimension-checks-wire-the,
 * AC-WIRE-1/AC-WIRE-2/AC-COMPOSE-1/AC-PURE-1/AC-SLUG-1/AC-SLUG-2/AC-EMPH-1/
 * AC-EMPH-2; spec-context-verb-family-two-zone-claude-md-anatomy-lore,
 * AC-CTX-2.
 */

import { docTypeSchema, normalizeFileAnchors, type MemoryFileBudgets } from "@lore/core";
import {
  computeHeadroom,
  computeHeadroomWarnings,
  lintMemoryFiles,
  type HeadroomReport,
} from "./claude-md-budget.js";
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

// ─── Slug pointers (deterministic, Phase 2 N14) ─────────────────────────────

/**
 * Matches a WHOLE backtick-quoted token shaped like a corpus slug
 * (`{type}-{kebab-title}`) — one of `@lore/core`'s `docTypeSchema` values,
 * read from that schema rather than a locally duplicated literal list (SSOT,
 * this project's anti-dual-write convention). Requires the token to be the
 * ENTIRE backtick span (inherited from {@link BACKTICK_TOKEN_RE}'s own
 * no-whitespace grammar) — this is what keeps a multi-word backtick command
 * like `` `lore gate plan-close --explain` `` from ever being extracted as
 * ONE candidate in the first place: the whole span contains spaces, so
 * `BACKTICK_TOKEN_RE` never matches it, and the `plan-close` GATE NAME
 * embedded inside it is never isolated and mistaken for a `plan-*` document
 * slug (measured false positive, spec Risks).
 *
 * Requires AT LEAST TWO kebab words after the type prefix (`{type}-{word}-
 * {word}...`, never a bare `{type}-{word}`) — measured empirically against
 * this repo's own memory files: `` `plan-close` ``, `` `plan-promote` ``,
 * `` `plan-terminality` ``, `` `task-start` ``, `` `phase-start` ``,
 * `` `phase-claim` `` all appear standalone (no surrounding whitespace, so
 * the whitespace exclusion above does NOT catch them) — every one of them a
 * GATE/FEED CHECKPOINT name or a `TreeCheckService` drift-kind name, never a
 * document slug. A real corpus slug is `slugify(type, title)` over an actual
 * document TITLE (this project's own slugs run 3–10+ kebab words); a bare
 * `{type}-{oneWord}` overwhelmingly names a small, fixed vocabulary token
 * instead. Misses a hypothetical genuine one-word-titled document — this
 * module's own established risk posture is "misses acceptable, false alarms
 * are not" (spec Risks), same rule `checkReferenceExistence` already applies.
 */
const SLUG_SHAPE_RE = new RegExp(`^(?:${docTypeSchema.options.join("|")})-[a-z0-9]+-[a-z0-9]+(?:-[a-z0-9]+)*$`);

/**
 * Extracts WHOLE backtick-quoted, corpus-slug-shaped tokens from `content`
 * and reports the ones `docExists` says are absent (Phase 2, N14,
 * `kind: "slug_pointer_missing"`, DETERMINISTIC). Closes the structural
 * blindness `checkReferenceExistence` has for slug pointers: that check's
 * grammar requires a `/` in the candidate (spec §D6), and a bare corpus slug
 * never contains one, so not a single one of them was ever checked.
 *
 * Returned findings carry NO `path`/`role` (this function sees only
 * `content`, never the containing {@link MemoryFileRecord}) —
 * {@link runMemoryFileChecks} fills both in from the file being linted.
 * Duplicate dangling slugs (same token) report once, first occurrence order
 * preserved — mirrors `checkReferenceExistence`'s same dedup rule.
 *
 * @param content - Raw file text to scan (e.g. a CLAUDE.md body).
 * @param docExists - Caller-owned corpus-slug existence predicate — the SOLE
 *   source of truth for "does this slug exist"; this module never touches
 *   the store itself. The corpus-free `--check-claude-md` CLI branch injects
 *   `() => true` so this check structurally never fires there (N14) without
 *   a separate code path; `--check-memory-pointers` injects a real lookup.
 * @returns One `slug_pointer_missing` {@link MemoryFileFinding} per distinct
 *   dangling slug. Empty array on empty `content`, when no candidate matches
 *   the slug grammar, or when every candidate exists.
 * @example
 * checkSlugPointers(
 *   "See `spec-this-corpus-lacks-this-doc` for the mechanism.",
 *   (slug) => slug !== "spec-this-corpus-lacks-this-doc",
 * );
 * // => [{ kind: "slug_pointer_missing", path: "", reference: "spec-this-corpus-lacks-this-doc", ... }]
 */
export function checkSlugPointers(
  content: string,
  docExists: (slug: string) => boolean,
): MemoryFileFinding[] {
  if (content.length === 0) return [];

  const findings: MemoryFileFinding[] = [];
  const alreadyReported = new Set<string>();

  for (const match of content.matchAll(BACKTICK_TOKEN_RE)) {
    const token = match[1];
    if (token === undefined || !SLUG_SHAPE_RE.test(token)) continue;
    if (alreadyReported.has(token)) continue;
    if (docExists(token)) continue;

    alreadyReported.add(token);
    findings.push({
      path: "",
      kind: "slug_pointer_missing",
      reference: token,
      message: `\`${token}\` looks like a corpus-doc slug but does not exist in this corpus`,
    });
  }

  return findings;
}

// ─── Emphasis saturation (deterministic, single threshold — Phase 2 N5/N6) ─

/**
 * One emphasis marker's match pattern — the SAME four markers Anthropic's
 * own emphasis guidance and this project's CLAUDE.md convention both use.
 * `⛔` needs no word-boundary reasoning (a single glyph, never a substring of
 * an ordinary English word); the three ASCII words are matched
 * case-sensitive ALL-CAPS + word-boundary, which is how this codebase's own
 * memory files actually write them for emphasis (never lowercase incidental
 * prose like "you must configure...").
 */
const EMPHASIS_MARKER_PATTERNS: readonly RegExp[] = [
  /⛔/g,
  /\bIMPORTANT\b/g,
  /\bMUST\b/g,
  /\bNEVER\b/g,
];

/** Total emphasis-marker occurrences across all four patterns in `content`. */
function countEmphasisMarkers(content: string): number {
  let total = 0;
  for (const pattern of EMPHASIS_MARKER_PATTERNS) {
    total += content.match(pattern)?.length ?? 0;
  }
  return total;
}

/**
 * Measures emphasis-marker density (⛔/IMPORTANT/MUST/NEVER per KB, UTF-8
 * bytes — mirrors `claude-md-budget.ts`'s "never `.length`" byte-measurement
 * convention) and fires ONCE when it exceeds `maxPerKb` (Phase 2, N5/N6,
 * `kind: "emphasis_saturated"`, DETERMINISTIC). A SINGLE threshold,
 * deliberately NOT `claude-md-budget.ts`'s three-band ceiling machinery
 * (N5): marker density is not a capacity metric, so this finding carries no
 * warn/evict fraction field — `measured` is the observed density,
 * `ceiling` is `maxPerKb` itself, nothing else.
 *
 * Anthropic's own guidance motivates the check: if you emphasize many
 * lines, none of them stands out.
 *
 * @param content - Raw file text to scan.
 * @param maxPerKb - The resolved `memory_files.emphasis.max_per_kb` ceiling
 *   (`@lore/core`'s `contextConfigSchema`) — never hardcoded here.
 * @returns A single-element array when density strictly exceeds `maxPerKb`
 *   (density AT the ceiling stays silent — the ceiling is a saturation
 *   point, not a floor). Empty array on empty `content`, when no marker is
 *   present, or when density is at or below `maxPerKb`.
 * @example
 * measureEmphasis("⛔ ".repeat(10), 1);
 * // => [{ kind: "emphasis_saturated", path: "", measured: 3.33, ceiling: 1, ... }]
 */
export function measureEmphasis(content: string, maxPerKb: number): MemoryFileFinding[] {
  if (content.length === 0) return [];

  const totalMarkers = countEmphasisMarkers(content);
  if (totalMarkers === 0) return [];

  // reason: floor the KB denominator at 1 — "density per KB" has no
  // meaningful resolution below one KB, and without this floor a single
  // marker in a tiny file (a short fixture, a near-empty stub module doc)
  // produces an inflated density that saturates on nothing (measured: a
  // 72-byte, one-marker fixture computed 14.2/KB against a default ceiling
  // of 3). Every AC-EMPH-1/2 fixture is already built at >= 1 KB
  // (`findFixtureScale`'s own range starts at 1), so this floor changes
  // nothing for them — it only protects small, unrelated files from a
  // meaningless spike.
  const kb = Math.max(Buffer.byteLength(content, "utf8") / 1024, 1);
  const density = totalMarkers / kb;
  if (density <= maxPerKb) return [];

  return [
    {
      path: "",
      kind: "emphasis_saturated",
      measured: density,
      ceiling: maxPerKb,
      message:
        `content carries ${totalMarkers} emphasis marker(s) (⛔/IMPORTANT/MUST/NEVER) at ` +
        `${density.toFixed(2)}/KB, exceeding the max_per_kb ceiling of ${maxPerKb} — heavy emphasis reduces ` +
        `signal: if everything is marked urgent, nothing stands out`,
    },
  ];
}

// ─── Composition (the SOLE entry — spec §Module Boundary, AC-COMPOSE-1) ────

/**
 * Injected existence predicates every content check needs — this module
 * never calls `fs` or the store itself (module header). `docExists` backs
 * {@link checkSlugPointers} (Phase 2).
 */
export interface AdmissionDeps {
  /** Caller-owned repo-relative-path existence predicate — backs `checkReferenceExistence`. */
  fileExists: (p: string) => boolean;
  /** Caller-owned corpus-slug existence predicate — backs `checkSlugPointers` (Phase 2). */
  docExists: (slug: string) => boolean;
}

/**
 * The SOLE composition entry for the memory-file admission mechanism (spec
 * §Module Boundary, N15) — folds `claude-md-budget.ts`'s `lintMemoryFiles` +
 * `computeHeadroom` + `computeHeadroomWarnings` together with this module's
 * `checkReferenceExistence` + `detectNarrativeSmells` (advisory) +
 * `checkSlugPointers` + `measureEmphasis` (deterministic) across every file
 * in `files`. `adapters/cli/commands/status.ts` and `flows/context-flow.ts`
 * call ONLY this (AC-COMPOSE-1) — see this module's header for why.
 * `checkSlugPointers`/`measureEmphasis` return findings with no `path`/
 * `role` (they see only `content`) — this function fills both in from the
 * file being linted before appending to `deterministic`.
 *
 * @param files - Discovered memory files (see {@link MemoryFileRecord}).
 * @param budgets - Corpus-governed ceilings + `emphasis.max_per_kb`,
 *   resolved via `resolveMemoryFileBudgets` (`@lore/core`) — never
 *   hardcoded.
 * @param deps - `{ fileExists, docExists }` — see {@link AdmissionDeps}.
 * @returns `deterministic` — `lintMemoryFiles`'s output, followed by every
 *   `checkSlugPointers`/`measureEmphasis` finding, in file order. `advisory`
 *   — every `checkReferenceExistence` + `detectNarrativeSmells` finding
 *   across all `files`, in file order. `headroom` — `computeHeadroom`'s
 *   output. `warnings` — `computeHeadroomWarnings(headroom)`.
 * @example
 * runMemoryFileChecks(
 *   [{ path: "CLAUDE.md", role: "root", content: "See `gone.ts`." }],
 *   resolveMemoryFileBudgets(config),
 *   { fileExists: () => false, docExists: () => true },
 * );
 * // => { deterministic: [], advisory: [{ kind: "reference_missing", ... }], headroom: [...], warnings: [] }
 */
export function runMemoryFileChecks(
  files: MemoryFileRecord[],
  budgets: MemoryFileBudgets,
  deps: AdmissionDeps,
): {
  deterministic: MemoryFileFinding[];
  advisory: AdvisoryFinding[];
  headroom: HeadroomReport[];
  warnings: AdvisoryFinding[];
} {
  const deterministic = lintMemoryFiles(files, budgets);

  const advisory: AdvisoryFinding[] = [];
  for (const file of files) {
    advisory.push(...checkReferenceExistence(file.content, deps.fileExists));
    advisory.push(...detectNarrativeSmells(file.content));

    for (const finding of checkSlugPointers(file.content, deps.docExists)) {
      deterministic.push({ ...finding, path: file.path, role: file.role });
    }
    for (const finding of measureEmphasis(file.content, budgets.emphasis.max_per_kb)) {
      deterministic.push({ ...finding, path: file.path, role: file.role });
    }
  }

  const headroom = computeHeadroom(files, budgets);
  const warnings = computeHeadroomWarnings(headroom);

  return { deterministic, advisory, headroom, warnings };
}
