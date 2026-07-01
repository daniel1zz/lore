/**
 * Text normalisation helpers for body comparison and canonical disk writes.
 *
 * Public surface:
 *   - canonicaliseBody(s) — CRLF→LF, trim both ends, ensure exactly one trailing newline.
 *
 * Invariants:
 *   - Idempotent: canonicaliseBody(canonicaliseBody(s)) === canonicaliseBody(s)
 *   - Result always ends with exactly one "\n".
 *   - The non-trailing-whitespace portion of the string is not modified beyond CRLF→LF.
 *
 * Side-effect class: Pure.
 *
 * Used by SyncDocsService (drift check) and ExportDocsService (write).
 * Shared SSOT so both services normalise identically — guarantees roundtrip parity.
 * Source: SPEC-021 §4 "CRITICAL — whitespace parity"
 */

/**
 * Normalise a body string for roundtrip comparison and canonical disk writes.
 *
 * Steps:
 *   1. Convert CRLF → LF (handles Windows-originated content)
 *   2. Trim all leading and trailing whitespace (same as pre-SPEC-021 normalizeBody)
 *   3. Append exactly one newline
 *
 * The trimEnd-only approach would break roundtrip if corpus bodies have leading whitespace
 * because sync-docs applies `bodyRaw.trimStart()` when reading files. Using full `.trim()`
 * ensures both sides converge to the same value after normalisation.
 * reason: trim() not trimEnd() — sync-docs strips leading whitespace from parsed file body
 * via bodyRaw.trimStart(), so the corpus and file sides must converge. Full trim() ensures
 * both canonicaliseBody(corpus) and canonicaliseBody(file_after_trimStart) are equal.
 *
 * @param s - Raw body text (from file or corpus).
 * @returns Canonicalised body ending with exactly one newline.
 * @example
 *   canonicaliseBody("foo\r\n") // => "foo\n"
 *   canonicaliseBody("foo\n\n\n") // => "foo\n"
 *   canonicaliseBody("foo") // => "foo\n"
 *   canonicaliseBody("  foo  ") // => "foo\n"
 *   canonicaliseBody(canonicaliseBody("foo\n\n")) // => "foo\n" (idempotent)
 */
export function canonicaliseBody(s: string): string {
  return s.replace(/\r\n/g, "\n").trim() + "\n";
}
