/**
 * YAML-frontmatter DELIMITER splitting — the `---`-boundary detection shared by
 * MigrationService (v1 markdown import) and ExportDocsService (corpus → disk writer).
 *
 * Public surface:
 *   - splitFrontmatter(text, mode) — locate the frontmatter block and split it from the body.
 *   - SplitFrontmatterResult / SplitFrontmatterMode
 *
 * Invariants:
 *   - Delimiter splitting ONLY. Callers apply `yaml`'s `parse()` to `frontmatter`
 *     themselves — this module has no dependency on the `yaml` package (SSOT: don't
 *     bundle a second YAML engine, don't duplicate the parse call either).
 *   - Two DISTINCT closing-delimiter dialects, selected via `mode` (no implicit default —
 *     every caller states which dialect its file format requires):
 *       "loose"  — MigrationService's original algorithm (v1 markdown). Closing marker is
 *                  the substring "\n---" anywhere after the opening delimiter; no trailing
 *                  newline required after the final "---". `frontmatter`/`body` are trimmed.
 *       "strict" — ExportDocsService's original algorithm (v2 corpus exports). Opening
 *                  delimiter must be "---" followed IMMEDIATELY by "\n"; closing marker
 *                  must be the full "\n---\n" (trailing newline required). Neither
 *                  `frontmatter` nor `body` is trimmed.
 *   - Pre-processing (BOM stripping, CRLF→LF normalisation) is each caller's responsibility,
 *     done BEFORE calling this function — it is not "delimiter splitting" and the two
 *     original call sites disagreed on whether to do it (migration-service never
 *     normalised CRLF; export-docs-service always does). Baking either into this module
 *     would silently change one site's behaviour.
 *
 * Side-effect class: Pure.
 *
 * Source: refactor — shared frontmatter split helper (migration-service.ts /
 *   export-docs-service.ts had two hand-rolled, behaviourally-distinct copies).
 */

/** Result of a delimiter split — the raw (unparsed) frontmatter string plus the body. */
export type SplitFrontmatterResult =
  | { ok: true; frontmatter: string; body: string }
  | { ok: false; error: string };

/** Which closing-delimiter dialect to apply — see module header. */
export type SplitFrontmatterMode = "loose" | "strict";

/**
 * Split a `---`-delimited frontmatter block from its body.
 *
 * @param text - Full file content, already BOM-stripped / CRLF-normalised by the caller
 *   if that caller's dialect requires it (see module header).
 * @param mode - "loose" (migration-service dialect) or "strict" (export-docs-service dialect).
 * @returns `{ok: true, frontmatter, body}` on a successful split, or
 *   `{ok: false, error}` naming why (no leading `---`, or an unclosed block).
 * @example
 *   splitFrontmatter("---\nid: x\n---\nbody", "loose")
 *   // => { ok: true, frontmatter: "id: x", body: "body" }
 *   splitFrontmatter("no frontmatter here", "strict")
 *   // => { ok: false, error: "No YAML frontmatter found (must start with ---)" }
 */
export function splitFrontmatter(
  text: string,
  mode: SplitFrontmatterMode,
): SplitFrontmatterResult {
  return mode === "strict" ? splitStrict(text) : splitLoose(text);
}

/**
 * MigrationService's original dialect: `stripped.startsWith("---")` /
 * `afterOpen.indexOf("\n---")`, both frontmatter and body trimmed.
 */
function splitLoose(text: string): SplitFrontmatterResult {
  if (!text.startsWith("---")) {
    return { ok: false, error: "No YAML frontmatter found (must start with ---)" };
  }

  const afterOpen = text.slice(3);
  const closeIdx = afterOpen.indexOf("\n---");
  if (closeIdx === -1) {
    return { ok: false, error: "Unclosed YAML frontmatter (missing closing ---)" };
  }

  return {
    ok: true,
    frontmatter: afterOpen.slice(0, closeIdx).trim(),
    body: afterOpen.slice(closeIdx + 4).trim(),
  };
}

/**
 * ExportDocsService's original dialect: `/^---\n[\s\S]*?\n---\n/` — opening delimiter
 * must be followed immediately by a newline; closing marker requires a trailing newline
 * too. Neither side is trimmed (the original regex captures never were).
 */
function splitStrict(text: string): SplitFrontmatterResult {
  if (!text.startsWith("---") || text.slice(3, 4) !== "\n") {
    return { ok: false, error: "No YAML frontmatter found (must start with ---)" };
  }

  const afterOpen = text.slice(4);
  const closeIdx = afterOpen.indexOf("\n---\n");
  if (closeIdx === -1) {
    return { ok: false, error: "Unclosed YAML frontmatter (missing closing ---)" };
  }

  return {
    ok: true,
    frontmatter: afterOpen.slice(0, closeIdx),
    body: afterOpen.slice(closeIdx + 5),
  };
}
