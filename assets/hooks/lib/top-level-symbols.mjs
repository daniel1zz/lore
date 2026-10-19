/**
 * top-level-symbols.mjs — which top-level symbols of a source file an edit touches, from the position of the text it replaces.
 *
 * Purpose: lets the pre-edit anchor gate hold `path#Symbol` instead of a whole file, so two sessions editing different
 * functions of one hotspot file (a composition root, a tool registry) do not take turns.
 * Public surface: {@link TOP_LEVEL_PSEUDO_SYMBOL}, {@link isSymbolScannable}, {@link scanRegions}, {@link locateAll},
 * {@link touchedSymbols}.
 * Side-effect class: pure (no IO, no process access); standalone — a shipped hook asset cannot import `@lore/core`.
 *
 * ## Invariants
 *
 * - Lexical, line-oriented, deliberately conservative: a region is one column-0 declaration (`function`, `class`,
 *   `interface`, `enum`, `namespace`, `type`, `const|let|var`, `export default`) plus the comment/decorator lines directly
 *   above it, up to the next declaration. Anything between declarations that is not a declaration (a closing `}`, a column-0
 *   statement) belongs to the region above it, so an edit can only ever be attributed to a region that really contains it.
 * - Column-0 `import` / `export { ... }` / `export * from` lines form `$toplevel` regions (imports and re-exports), and the
 *   lines before the first declaration are `$toplevel` too. `$toplevel` is a valid anchor symbol (`$` starts an identifier).
 * - Undecidable input is NOT narrowed: a non-source extension, a file with no declaration, an `old_string` that cannot be
 *   located all yield `null` — the caller then holds the WHOLE file (fail closed).
 * - The symbol grammar is the anchor grammar (`FILE_ANCHOR_SYMBOL_RE`, ASCII identifier).
 */

/** Pseudo-symbol for import / re-export lines and the file header (before the first declaration). */
export const TOP_LEVEL_PSEUDO_SYMBOL = '$toplevel';

/** Extensions the lexical scan understands; every other file is held whole. */
const SCANNABLE_EXTENSION = /\.(?:[cm]?[jt]s|[jt]sx)$/;

const NAMED_DECLARATION =
  /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\b\s*\*?\s*|class\s+|interface\s+|enum\s+|const\s+enum\s+|namespace\s+|type\s+|(?:const|let|var)\s+)([A-Za-z_$][A-Za-z0-9_$]*)/;
const ANONYMOUS_DEFAULT = /^export\s+default\b/;
const LOOSE_TOP_LEVEL = /^(?:import\b|export\s*[{*])/;
const COMMENT_OR_DECORATOR = /^(?:\/\*|\s?\*|\/\/|@)/;

/**
 * @param {string} path - a file path (any separator style).
 * @returns {boolean} whether {@link scanRegions} can attribute an edit to a top-level symbol of this file.
 */
export function isSymbolScannable(path) {
  return SCANNABLE_EXTENSION.test(path);
}

/** @returns {string | null} the region name a column-0 line starts, or null. */
function regionNameOf(line) {
  const named = NAMED_DECLARATION.exec(line);
  if (named !== null) return named[1];
  if (ANONYMOUS_DEFAULT.test(line)) return 'default';
  if (LOOSE_TOP_LEVEL.test(line)) return TOP_LEVEL_PSEUDO_SYMBOL;
  return null;
}

/**
 * Splits `text` into contiguous regions covering every character.
 *
 * @param {string} text - source text.
 * @returns {{name: string, start: number, end: number}[] | null} regions (`[start, end)` character offsets, in order), or null
 *   when the file has no declaration at all (nothing to narrow to).
 */
export function scanRegions(text) {
  const lines = text.split('\n');
  const lineStart = [];
  let offset = 0;
  for (const line of lines) {
    lineStart.push(offset);
    offset += line.length + 1;
  }
  const starts = [];
  let sawDeclaration = false;
  for (let i = 0; i < lines.length; i += 1) {
    const name = regionNameOf(lines[i]);
    if (name === null) continue;
    if (name !== TOP_LEVEL_PSEUDO_SYMBOL) sawDeclaration = true;
    let first = i;
    const floor = starts.length === 0 ? 0 : starts[starts.length - 1].line + 1;
    while (first - 1 >= floor && COMMENT_OR_DECORATOR.test(lines[first - 1])) first -= 1;
    starts.push({ name, line: first });
  }
  if (!sawDeclaration) return null;
  const regions = [];
  if (starts[0].line > 0) regions.push({ name: TOP_LEVEL_PSEUDO_SYMBOL, start: 0, end: lineStart[starts[0].line] });
  for (let k = 0; k < starts.length; k += 1) {
    const start = lineStart[starts[k].line];
    const end = k + 1 < starts.length ? lineStart[starts[k + 1].line] : text.length;
    regions.push({ name: starts[k].name, start, end });
  }
  return regions;
}

/**
 * Every position at which `needle` occurs in `text`.
 *
 * @param {string} text - the file content.
 * @param {string} needle - the text an edit replaces (an Edit's `old_string`).
 * @returns {{start: number, end: number}[]} occurrences; empty when `needle` is empty or absent.
 */
export function locateAll(text, needle) {
  if (needle === '') return [];
  const found = [];
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) {
    found.push({ start: at, end: at + needle.length });
  }
  return found;
}

/**
 * The top-level symbols whose region overlaps any of `spans`, in file order, without duplicates.
 *
 * @param {string} text - the file content before the edit.
 * @param {{start: number, end: number}[]} spans - the replaced spans.
 * @returns {string[] | null} symbol names, or null when the touched set cannot be determined (no spans, no declarations,
 *   or a span outside every region) — the caller must then hold the whole file.
 */
export function touchedSymbols(text, spans) {
  if (spans.length === 0) return null;
  const regions = scanRegions(text);
  if (regions === null) return null;
  const names = [];
  for (const span of spans) {
    const hit = regions.filter((region) => span.start < region.end && span.end > region.start);
    if (hit.length === 0) return null;
    for (const region of hit) if (!names.includes(region.name)) names.push(region.name);
  }
  return names;
}
