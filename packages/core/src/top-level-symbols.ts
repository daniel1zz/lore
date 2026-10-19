/**
 * top-level-symbols.ts — which top-level symbols of a source file an edit touches, from the position of the text it replaces.
 *
 * Purpose: lets the pre-edit anchor gate hold `path#Symbol` instead of a whole file, so two sessions editing different
 * functions of one hotspot file (a composition root, a tool registry) do not take turns.
 * Public surface: {@link TOP_LEVEL_PSEUDO_SYMBOL}, {@link isSymbolScannable}, {@link scanRegions}, {@link locateAll},
 * {@link touchedSymbols}, {@link changedSymbols}.
 * Side-effect class: pure (no IO, no Node builtin, no process access), so it stays importable from the browser-safe
 * `@lore/core` barrel.
 *
 * ## Single source
 *
 * This file is the ONE implementation. The pre-edit anchor gate is a shipped hook asset that cannot import `@lore/core`, so
 * it uses `assets/hooks/lib/top-level-symbols.mjs`, GENERATED from this file by `scripts/sync-hook-top-level-symbols.ts`
 * (`bun run check:hook-top-level-symbols` proves them identical). `lore integrate` judges a branch's own diff with the same
 * extraction (`service/own-diff-judgment.ts`). Edit here, rerun the script, then `bun scripts/embed-assets-manifest.mjs`.
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

/** A half-open character range `[start, end)` of a text. */
export interface TextSpan {
  readonly start: number;
  readonly end: number;
}

/** One contiguous region of a source file: a top-level declaration (or `$toplevel`) and the text it owns. */
export interface TopLevelRegion extends TextSpan {
  readonly name: string;
}

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
 * @param path - a file path (any separator style).
 * @returns whether {@link scanRegions} can attribute an edit to a top-level symbol of this file.
 */
export function isSymbolScannable(path: string): boolean {
  return SCANNABLE_EXTENSION.test(path);
}

/** @returns the region name a column-0 line starts, or null. */
function regionNameOf(line: string): string | null {
  const named = NAMED_DECLARATION.exec(line);
  if (named !== null) return named[1] ?? null;
  if (ANONYMOUS_DEFAULT.test(line)) return 'default';
  if (LOOSE_TOP_LEVEL.test(line)) return TOP_LEVEL_PSEUDO_SYMBOL;
  return null;
}

/**
 * Splits `text` into contiguous regions covering every character.
 *
 * @param text - source text.
 * @returns regions (`[start, end)` character offsets, in order), or null
 *   when the file has no declaration at all (nothing to narrow to).
 */
export function scanRegions(text: string): TopLevelRegion[] | null {
  const lines = text.split('\n');
  const lineStart: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStart.push(offset);
    offset += line.length + 1;
  }
  const starts: { name: string; line: number }[] = [];
  let sawDeclaration = false;
  for (const [i, line] of lines.entries()) {
    const name = regionNameOf(line);
    if (name === null) continue;
    if (name !== TOP_LEVEL_PSEUDO_SYMBOL) sawDeclaration = true;
    let first = i;
    const previous = starts.at(-1);
    const floor = previous === undefined ? 0 : previous.line + 1;
    while (first - 1 >= floor && COMMENT_OR_DECORATOR.test(lines[first - 1] ?? '')) first -= 1;
    starts.push({ name, line: first });
  }
  const head = starts[0];
  if (!sawDeclaration || head === undefined) return null;
  const startOf = (line: number): number => lineStart[line] ?? text.length;
  const regions: TopLevelRegion[] = [];
  if (head.line > 0) regions.push({ name: TOP_LEVEL_PSEUDO_SYMBOL, start: 0, end: startOf(head.line) });
  for (const [k, entry] of starts.entries()) {
    const next = starts[k + 1];
    regions.push({ name: entry.name, start: startOf(entry.line), end: next === undefined ? text.length : startOf(next.line) });
  }
  return regions;
}

/**
 * Every position at which `needle` occurs in `text`.
 *
 * @param text - the file content.
 * @param needle - the text an edit replaces (an Edit's `old_string`).
 * @returns occurrences; empty when `needle` is empty or absent.
 */
export function locateAll(text: string, needle: string): TextSpan[] {
  if (needle === '') return [];
  const found: TextSpan[] = [];
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) {
    found.push({ start: at, end: at + needle.length });
  }
  return found;
}

/**
 * The top-level symbols whose region overlaps any of `spans`, in file order, without duplicates.
 *
 * @param text - the file content before the edit.
 * @param spans - the replaced spans.
 * @returns symbol names, or null when the touched set cannot be determined (no spans, no declarations,
 *   or a span outside every region) — the caller must then hold the whole file.
 */
export function touchedSymbols(text: string, spans: readonly TextSpan[]): string[] | null {
  if (spans.length === 0) return null;
  const regions = scanRegions(text);
  if (regions === null) return null;
  const names: string[] = [];
  for (const span of spans) {
    const hit = regions.filter((region) => span.start < region.end && span.end > region.start);
    if (hit.length === 0) return null;
    for (const region of hit) if (!names.includes(region.name)) names.push(region.name);
  }
  return names;
}

/** Region texts of `text` grouped by symbol name (repeated names, e.g. several `$toplevel` runs or overloads, concatenate in file order). */
function textBySymbol(text: string, regions: readonly TopLevelRegion[]): Map<string, string> {
  const bySymbol = new Map<string, string>();
  for (const region of regions) bySymbol.set(region.name, (bySymbol.get(region.name) ?? '') + text.slice(region.start, region.end));
  return bySymbol;
}

/**
 * The top-level symbols whose text differs between two versions of one file: a symbol present on one side only (added,
 * deleted) counts under its own name, and a renamed one under both names. A file absent on one side (`null`) is changed
 * in every symbol of the other side.
 *
 * @param before - the file content before the change, or null when the file did not exist.
 * @param after - the file content after the change, or null when the file no longer exists.
 * @returns the changed symbol names in a stable order (names of `before` first, then names only `after` has), or null when
 *   they cannot be determined (neither side has a declaration to scan) — the caller must then treat the WHOLE file as changed.
 */
export function changedSymbols(before: string | null, after: string | null): string[] | null {
  const beforeRegions = before === null ? [] : scanRegions(before);
  const afterRegions = after === null ? [] : scanRegions(after);
  if (beforeRegions === null || afterRegions === null) return null;
  const beforeText = before === null ? new Map<string, string>() : textBySymbol(before, beforeRegions);
  const afterText = after === null ? new Map<string, string>() : textBySymbol(after, afterRegions);
  if (beforeText.size === 0 && afterText.size === 0) return null;
  const names = [...new Set([...beforeText.keys(), ...afterText.keys()])];
  return names.filter((name) => beforeText.get(name) !== afterText.get(name));
}
