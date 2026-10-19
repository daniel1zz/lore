/**
 * Shared finding/record types for the memory-file admission mechanism
 * (spec-claude-md-governance-content-dimension-checks-wire-the) — the ONE
 * place both `claude-md-budget.ts` (capacity checks: line/byte ceilings) and
 * `claude-md-admission.ts` (content checks: reference existence, narrative
 * smells) import their finding/record shapes from, so neither module forks
 * its own copy. Extracted from the pre-split `claude-md-check.ts` (N12: the
 * split precedes the new Phase 2+ metrics).
 *
 * Public surface:
 *   - MemoryFileRole / MemoryFileRecord — a discovered memory file's role and
 *     raw facts (path/role/content), assembled by the caller (typically
 *     `adapters/real-memory-file-probe.ts`).
 *   - MemoryFileFindingKind / MemoryFileFinding — DETERMINISTIC, exit-relevant
 *     findings (`claude-md-budget.ts`'s `lintMemoryFiles` ceiling/eviction
 *     verdicts).
 *   - AdvisoryFindingKind / AdvisoryFinding — ADVISORY, NEVER exit-relevant
 *     findings (`claude-md-admission.ts`'s narrative smells + dangling
 *     references, `claude-md-budget.ts`'s near-ceiling warnings).
 *
 * Invariants:
 *   - `MemoryFileFinding` is a single FLAT interface, never a `kind`-keyed
 *     discriminated union — pinned test suites
 *     (`claude-md-headroom.test.ts`/`claude-md-eviction-floor.test.ts`/
 *     `claude-md-admission.test.ts`) read `.measured`/`.role`/`.ceiling` off
 *     a `lintMemoryFiles` result WITHOUT a `kind` narrowing check first (see
 *     `MemoryFileFinding`'s own `@remark`) — a union makes those fields
 *     inaccessible without narrowing and fails `tsc --noEmit` against those
 *     files.
 *   - `reference_unresolved` is a DETERMINISTIC `MemoryFileFindingKind`
 *     (spec-prose-about-code-is-bound-to-what-it-describes-one D1). It
 *     replaces the retired advisory `reference_missing`: a missing path, a
 *     missing exported symbol and a missing script are one kind, told apart
 *     by `drift_kind`.
 *   - `line_length`/`target_distance` (N9, spec-claude-md-governance-content-
 *     dimension-checks-wire-the) are the two ALWAYS-ON advisory metrics —
 *     one pair emitted per discovered file by
 *     `claude-md-admission.ts`'s `measureLineLengths`/
 *     `measureTargetDistances`, computed independent of
 *     `budgets.enabled` (unlike `headroom_warning`) so they never depend on
 *     the capacity ceiling being switched on. Both carry `measured` AND
 *     `path` (the CONTAINER file's path — a different semantic use of
 *     `path` than a finding that points at a target, see
 *     below). Neither ever affects the exit code, at any value, forever —
 *     Anthropic defines the 200-line figure as a target, not a limit.
 *   - `AdvisoryFinding.measured` is OPTIONAL: present for
 *     `iso_date_density`/`status_word` (an occurrence count), `headroom_warning`
 *     (remaining headroom), `line_length` (the file's longest line, in UTF-8
 *     bytes), and `target_distance` (line count minus
 *     `claude-md-admission.ts`'s `OFFICIAL_LINE_TARGET`, negative/zero/
 *     positive).
 *   - The three `section_*` deterministic kinds come from `claude-md-structure.ts`. Every
 *     deterministic kind is always exit-relevant: the adoption mode that once moved them to an
 *     advisory `downgraded` kind was retired (task-memory-file-limits-are-always-enforced-the-warn-adoption).
 *
 * Side-effect class: pure (types only — zero imports, zero logic)
 *
 * Source: spec-claude-md-governance-content-dimension-checks-wire-the,
 * AC-WIRE-1/AC-WIRE-2/AC-COMPOSE-1/AC-PURE-1/AC-ADV-1; spec-project-claude-md-
 * content-contract-governance-injected, AC-CMC-1; spec-context-verb-family-
 * two-zone-claude-md-anatomy-lore, AC-CTX-2.
 */

// ─── Memory File Record (caller-assembled, e.g. by real-memory-file-probe.ts) ─

/**
 * A discovered project memory file's role — governs which ceiling pair
 * applies. `"rules"` (N7, spec-claude-md-governance-content-dimension-checks-
 * wire-the) is a THIRD, separate role from `"module"` — a
 * `.claude/rules/**\/*.md` path-scoped snippet, never a whole module's
 * standing discipline — so its ceiling breach messages never misreport
 * "module ceiling" against a file that isn't one.
 */
export type MemoryFileRole = "root" | "module" | "rules";

/**
 * One memory file's facts as measured by the caller (typically
 * `adapters/real-memory-file-probe.ts`'s filesystem discovery walk).
 * `content` is the file's raw text — every check in this mechanism performs
 * its own line/byte/pattern measurement from this single value, never from a
 * caller-precomputed count.
 */
export interface MemoryFileRecord {
  /** Repo-relative path, used verbatim in finding messages. */
  path: string;
  role: MemoryFileRole;
  content: string;
}

// ─── Deterministic finding (capacity — claude-md-budget.ts) ─────────────────

/**
 * Which check a {@link MemoryFileFinding} reports a breach of. `max_lines`/
 * `max_bytes`/`eviction_required` come from `claude-md-budget.ts`'s
 * `lintMemoryFiles` — `eviction_required` is the only one of the three that
 * fires while the file is still WITHIN its ceiling (see that module's
 * three-band table). `slug_pointer_missing` (Phase 2, N14) and
 * `emphasis_saturated` (Phase 2, N5/N6) come from `claude-md-admission.ts`'s
 * `checkSlugPointers`/`measureEmphasis` — both DETERMINISTIC like the
 * capacity kinds, but neither is a capacity breach: `slug_pointer_missing`
 * fires on a dangling corpus-slug reference (gated on the caller's injected
 * `docExists`, never a line/byte measurement); `emphasis_saturated` fires on
 * a SINGLE marker-density threshold, deliberately NOT the three-band ceiling
 * machinery (N5 — density is not a capacity metric, so its finding carries
 * no warn/evict fraction field). `reference_unresolved` comes from the same
 * admission module: a backticked path, `path#Symbol` or `bun run <script>`
 * that the ONE core resolver (`resolveCodeReferences`) could not verify; it
 * carries `reference`, `line` and `drift_kind`.
 */
export type MemoryFileFindingKind =
  | "max_lines"
  | "max_bytes"
  | "eviction_required"
  | "slug_pointer_missing"
  | "emphasis_saturated"
  | "reference_unresolved"
  | "section_missing"
  | "section_order"
  | "section_duplicate";

/**
 * One deterministic, exit-relevant admission-check finding — flat and
 * serializable (CLI/JSON rendering is the caller's job — see
 * `adapters/cli/claude-md-render.ts` — this module never formats output
 * beyond the `message` field). A single flat shape rather than a
 * `kind`-discriminated union ON PURPOSE: callers that read `.measured`/
 * `.role`/`.ceiling` off a `max_lines`/`max_bytes`/`eviction_required`
 * finding do so without first narrowing on `kind`.
 *
 * @remark A `kind`-keyed discriminated union was the first design tried here
 *   — rejected because pinned test suites read `.measured`/`.role`/
 *   `.ceiling` off a `lintMemoryFiles` result WITHOUT a `kind` narrowing
 *   check first (direct `findings[0]?.measured` after only asserting
 *   `findings[0]?.kind`, which does not narrow for `expect()` calls) — a
 *   union makes those fields inaccessible without narrowing and fails `tsc
 *   --noEmit` against those test files. Test shape wins over the union
 *   pattern this codebase otherwise prefers for state (see
 *   `references/state-as-data.md`).
 */
export interface MemoryFileFinding {
  /** The linted memory file's path. */
  path: string;
  kind: MemoryFileFindingKind;
  /** The linted file's declared role. */
  role?: MemoryFileRole;
  /**
   * The measured line count or byte count (`max_lines`/`max_bytes`/
   * `eviction_required`), or the measured emphasis-marker density in
   * markers-per-KB (`emphasis_saturated`). ABSENT for `slug_pointer_missing`
   * (one finding per distinct dangling slug, not a count — mirrors
   * `AdvisoryFinding.measured`'s absence rule for per-target findings; also
   * ABSENT for `reference_unresolved`).
   */
  measured?: number;
  /** 1-based line of the unresolved reference in `path` (`reference_unresolved` only). */
  line?: number;
  /** Why the core resolver rejected the reference, a `DriftKind` such as `symbol_missing` or `script_missing` (`reference_unresolved` only). */
  drift_kind?: string;
  /**
   * The ceiling that was exceeded (or, for `eviction_required`, crossed) —
   * line/byte ceiling for the capacity kinds, or the resolved
   * `memory_files.emphasis.max_per_kb` for `emphasis_saturated`. ⛔ Never a
   * warn/evict FRACTION — those stay exclusive to the three-band capacity
   * kinds (N5: density is not a capacity metric).
   */
  ceiling?: number;
  /**
   * Present for `slug_pointer_missing` (the dangling backtick-quoted corpus-slug
   * token as it appeared in content), `reference_unresolved` (the raw reference,
   * `#Symbol` or `bun run` form included) and for the structure kinds
   * `section_missing`/`section_order`/`section_duplicate` (the H2 section NAME).
   */
  reference?: string;
  /** Human-readable summary — always names `path`. */
  message: string;
}

// ─── Advisory finding (content — claude-md-admission.ts — and headroom
// warnings — claude-md-budget.ts) ────────────────────────────────────────

/**
 * Which smell/condition an {@link AdvisoryFinding} flags — NEVER a
 * {@link MemoryFileFindingKind} (advisory findings are a structurally
 * SEPARATE family, never merged into or mistaken for a deterministic,
 * exit-relevant one). `headroom_warning` is emitted by
 * `claude-md-budget.ts`'s `computeHeadroomWarnings`;
 * `iso_date_density`/`status_word` by
 * `claude-md-admission.ts`'s `detectNarrativeSmells`. `line_length`/`target_distance` (N9, same spec) are the
 * two ALWAYS-ON advisories emitted by `claude-md-admission.ts`'s
 * `measureLineLengths`/`measureTargetDistances` — one pair per discovered
 * file, on every run, never exit-relevant.
 */
export type AdvisoryFindingKind =
  | "iso_date_density"
  | "status_word"
  | "headroom_warning"
  | "line_length"
  | "target_distance"
  | "section_extra"
  | "section_empty"
  | "module_section_missing";

/**
 * One advisory observation — structurally SEPARATE from
 * {@link MemoryFileFinding} on purpose: advisory findings must never be
 * mistakable for, or merged into, a deterministic exit-relevant finding.
 */
export interface AdvisoryFinding {
  kind: AdvisoryFindingKind;
  /**
   * Occurrence count for `iso_date_density`/`status_word`; remaining
   * headroom (`ceiling - used`, same value as `MetricHeadroom.remaining`)
   * for `headroom_warning`; the file's longest physical line in UTF-8 bytes
   * for `line_length`; line count minus `OFFICIAL_LINE_TARGET` (negative,
   * zero, or positive) for `target_distance`.
   */
  measured?: number;
  /**
   * Present for `line_length`/`target_distance`: the CONTAINER file's own
   * path ("what this finding is ABOUT").
   */
  path?: string;
  /**
   * Present for `section_extra`/`section_empty`/`module_section_missing`
   * (the H2 section name).
   */
  reference?: string;
  /** Human-readable summary. */
  message: string;
}
