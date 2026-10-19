/**
 * The required H2 section lists of the project memory-file content contract —
 * the SINGLE home of the section NAMES that `claude-md-structure.ts`'s checks
 * take as their `required` parameter
 * (spec-claude-md-root-section-structure-check-and-adoption-mode, D6; its adoption
 * mode was retired by task-memory-file-limits-are-always-enforced-the-warn-adoption).
 *
 * Public surface: ROOT_REQUIRED_SECTIONS, MODULE_REQUIRED_SECTIONS, and the module architecture-card link line
 * (ARCHITECTURE_CARD_LINE_PREFIX, parseModuleCardDirectory, renderArchitectureCardLine, applyArchitectureCardLine).
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

// ─── Architecture-card link line (module memory files) ──────────────────────

/** Prefix of the one line every module memory file carries to name its architecture module card. */
export const ARCHITECTURE_CARD_LINE_PREFIX = "Architecture card: ";

/** Whole-line matcher for the card-link line (backticked slug) — the only shape refresh writes or recognises. */
const ARCHITECTURE_CARD_LINE_PATTERN = /^Architecture card: .*$/;

/**
 * `Source: \`<dir>/CLAUDE.md\`.` — the line every architecture module card opens with to declare the module
 * memory file it summarises. There is no structured `extra` field for this (baseline extra carries tree/node/label
 * only, and no CLI writer sets another key), so this declared line is the card->module mapping. Never the title.
 */
const MODULE_CARD_SOURCE_PATTERN = /^Source: `([^`\n]+)\/[^/`\n]+`/m;

/**
 * Reads the module directory a module card declares through its `Source:` line.
 *
 * @param cardContent - The module card's markdown body.
 * @returns The repo-relative directory (no trailing slash), or `null` when the card declares none.
 * @example
 * parseModuleCardDirectory("# Module card: core\n\nSource: `packages/core/src/CLAUDE.md`.\n"); // "packages/core/src"
 */
export function parseModuleCardDirectory(cardContent: string): string | null {
  return MODULE_CARD_SOURCE_PATTERN.exec(cardContent)?.[1] ?? null;
}

/** Renders the card-link line (no newline) for a card slug. */
export function renderArchitectureCardLine(cardSlug: string): string {
  return `${ARCHITECTURE_CARD_LINE_PREFIX}\`${cardSlug}\``;
}

/**
 * Returns `content` with its architecture-card line normalised: every existing card line (and the one blank
 * line after it) is removed, then, when `cardSlug` is non-null, one line is inserted right after the first
 * `# ` heading (or at the top when there is none). Idempotent: applying the result again changes nothing.
 *
 * @param content - A module memory file's bytes.
 * @param cardSlug - The module's card slug, or `null` when no card maps to the module (removes any stale line).
 * @returns The normalised bytes.
 * @example
 * applyArchitectureCardLine("# Module: x\n\n## Purpose\n", "baseline-module-card-x");
 * // "# Module: x\n\nArchitecture card: `baseline-module-card-x`\n\n## Purpose\n"
 */
export function applyArchitectureCardLine(content: string, cardSlug: string | null): string {
  const lines = content.split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (ARCHITECTURE_CARD_LINE_PATTERN.test(line)) {
      if (lines[i + 1] === "") i += 1;
      continue;
    }
    kept.push(line);
  }
  if (cardSlug === null) return kept.join("\n");
  const headingIndex = kept.findIndex((line) => line.startsWith("# "));
  const insertAt = headingIndex === -1 ? 0 : headingIndex + 1;
  const block = headingIndex === -1 ? [renderArchitectureCardLine(cardSlug), ""] : ["", renderArchitectureCardLine(cardSlug)];
  kept.splice(insertAt, 0, ...block);
  return kept.join("\n");
}
