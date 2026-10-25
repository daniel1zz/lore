/**
 * The leading comment region of a source file: blank lines, `//` lines, a shebang and block comments, up to the
 * first line of code.
 *
 * Purpose: ONE boundary rule for "the header of a file", shared by the test-input declaration parser
 * (scripts/test-declared-inputs.ts) and the defect report's context attachment (report-issue-context.ts).
 * It lives in packages/lore so the compiled binary ships it; the script imports it from here.
 *
 * Public surface: `leadingCommentLines`.
 * Invariants: the region stops BEFORE the first code line; a block comment that opens in the region is
 * consumed to its closing line; the returned lines are verbatim (no trimming, no trailing newline).
 * Side-effect class: pure.
 */

/**
 * Splits `content` and returns the lines of its leading comment region, verbatim.
 *
 * @param content - the whole source text
 * @returns the header lines (possibly empty); trailing blank lines are INCLUDED, callers trim if they need to
 * @example leadingCommentLines("// a\n\nconst x = 1;") // ["// a", ""]
 */
export function leadingCommentLines(content: string): string[] {
  const region: string[] = [];
  let inBlock = false;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (inBlock) {
      if (trimmed.includes("*/")) inBlock = false;
    } else if (trimmed === "" || trimmed.startsWith("//") || trimmed.startsWith("#!")) {
      // leading line comment / blank line: still the header
    } else if (trimmed.startsWith("/*")) {
      if (!trimmed.includes("*/")) inBlock = true;
    } else {
      break;
    }
    region.push(line);
  }
  return region;
}
