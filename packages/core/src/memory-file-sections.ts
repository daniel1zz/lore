/**
 * The required H2 section lists of the project memory-file content contract —
 * the SINGLE home of the section NAMES that `claude-md-structure.ts`'s checks
 * take as their `required` parameter
 * (spec-claude-md-root-section-structure-check-and-adoption-mode, D6; its adoption
 * mode was retired by task-memory-file-limits-are-always-enforced-the-warn-adoption).
 *
 * Public surface: ROOT_REQUIRED_SECTIONS, MODULE_REQUIRED_SECTIONS.
 *
 * Invariants:
 *   - Pure constants/types, no IO, no Node builtins — `@lore/core`'s default
 *     barrel is browser-safe.
 *   - Order of ROOT_REQUIRED_SECTIONS IS the required document order; the
 *     `section_order` check and the contract asset's numbered list both derive
 *     from it (AC-STR-7).
 *   - Matching is exact and case-sensitive on the trimmed H2 text (D5).
 *
 * Side-effect class: pure
 */

/** The five H2 sections a root memory file must contain, in this order. */
export const ROOT_REQUIRED_SECTIONS = [
  "What This Is",
  "Commands",
  "Architecture",
  "Module Index",
  "Finding Live Project State",
] as const;

/** The H2 sections a per-module memory file should contain (advisory only). */
export const MODULE_REQUIRED_SECTIONS = ["Purpose"] as const;
