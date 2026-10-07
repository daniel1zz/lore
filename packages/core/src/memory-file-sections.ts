/**
 * The required H2 section lists of the project memory-file content contract —
 * the SINGLE home of the section NAMES that `claude-md-structure.ts`'s checks
 * take as their `required` parameter, and the adoption-mode value type
 * (spec-claude-md-root-section-structure-check-and-adoption-mode, D6).
 *
 * Public surface: ROOT_REQUIRED_SECTIONS, MODULE_REQUIRED_SECTIONS, AdoptionMode.
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

/**
 * `context.memory_files.adoption` — whether deterministic memory-file findings
 * are exit-relevant (`enforce`) or reported as advisory `downgraded` (`warn`).
 */
export type AdoptionMode = "enforce" | "warn";
