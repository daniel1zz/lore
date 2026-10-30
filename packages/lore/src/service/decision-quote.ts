/**
 * Module: decision-quote — the ONE line extractor and normaliser behind a file premise's quote (#498).
 *
 * Purpose: the decision gate quotes cited lines at write time and the milestone re-check re-reads them at the same
 *   commit; both go through these functions, so the two sides can never normalise differently.
 * Public surface: splitFileLines, quoteLines, splitQuote.
 * Invariants:
 *   - A file's text splits into lines with CRLF read as LF and ONE final newline ignored (no phantom last line).
 *   - A quote is those lines joined with "\n", exactly as cited: a blank line stays a line, so a quote may end in "\n";
 *     nothing is trimmed, capped or truncated (no per-line length limit, no code-unit slicing of multi-byte text).
 *   - A stored quote splits back with `split("\n")` after the same CRLF reading, so a quote written before this module
 *     (which kept `\r`) still compares equal to a re-read of the same lines.
 * Side-effect class: pure.
 *
 * Source: spec-a-decision-carrying-write-records-its-decision-on-its, D5, D9; GitHub issue #498.
 */

/** The lines of a file's text: CRLF read as LF, one trailing newline dropped. */
export function splitFileLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
}

/** The quote for cited lines `from..to` (1-based, inclusive) of `lines`: the lines joined with "\n", untouched. */
export function quoteLines(lines: readonly string[], from: number, to: number): string {
  return lines.slice(from - 1, to).join("\n");
}

/** The lines a stored quote holds; the inverse of {@link quoteLines}, tolerant of CRLF in quotes stored earlier. */
export function splitQuote(quote: string): string[] {
  return quote.replace(/\r\n/g, "\n").split("\n");
}
