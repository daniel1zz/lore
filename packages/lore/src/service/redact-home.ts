/**
 * Home-folder reduction for text attached to a public defect report.
 *
 * Purpose: the report body is otherwise passed byte-for-byte (BR-502 only reduces reporter identity), so text the
 * filer attaches on its own (a test file's header) gets its own reduction.
 *
 * Public surface: `redactHomeInText`.
 * Invariants: every occurrence of the home prefix becomes `~`; an empty or root-only home changes nothing.
 * Side-effect class: pure.
 */

/**
 * @param text - the text about to be published
 * @param home - the invocation's home folder (a trailing slash is ignored)
 * @returns `text` with each occurrence of `home` replaced by `~`
 * @example redactHomeInText("/Users/a/x.ts", "/Users/a") // "~/x.ts"
 */
export function redactHomeInText(text: string, home: string): string {
  const prefix = home.length > 1 ? home.replace(/\/+$/, "") : "";
  if (prefix.length === 0) return text;
  return text.split(prefix).join("~");
}
