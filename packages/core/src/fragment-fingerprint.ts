/**
 * The ONE definition of the fingerprint line that marks a lore-managed rules or skill file
 * (a generated projection of a context fragment): `<!-- lore:managed fragment=<id> hash=<8hex> -->`.
 * `service/context-fragments/section.ts` writes and parses it; the memory-file admission check
 * (`service/claude-md-admission.ts`) recognises a generated file by it. Neither keeps a copy.
 *
 * Public surface:
 *   - {@link FRAGMENT_FINGERPRINT_LINE} — anchored regex for one whole line (groups: id, hash).
 *   - {@link formatFragmentFingerprint} — the line for an id and hash.
 *   - {@link parseFragmentFingerprint} — one line -> `{id, hash}` or `null`.
 *   - {@link startsWithFragmentFingerprint} — does a file's FIRST line carry an intact fingerprint line.
 *
 * Invariants: strict on purpose (BR-1176, spec-process-state-end-state D3): a header with any extra
 * token does not parse, so such a file is never treated as lore-owned.
 *
 * Side-effect class: pure (no imports; browser-safe).
 */

/** One whole fingerprint line; group 1 = fragment id, group 2 = 8-hex hash. */
export const FRAGMENT_FINGERPRINT_LINE = /^<!-- lore:managed fragment=(\S+) hash=([0-9a-f]{8}) -->$/;

/**
 * @param id - Fragment id (already validated by the caller).
 * @param hash - 8-hex content hash.
 * @returns The fingerprint line, without a trailing newline.
 */
export function formatFragmentFingerprint(id: string, hash: string): string {
  return `<!-- lore:managed fragment=${id} hash=${hash} -->`;
}

/**
 * @param line - One line, no newline.
 * @returns The id and hash, or `null` when the line is not a fingerprint line.
 * @example
 * parseFragmentFingerprint("<!-- lore:managed fragment=a hash=0123abcd -->"); // => { id: "a", hash: "0123abcd" }
 */
export function parseFragmentFingerprint(line: string): { id: string; hash: string } | null {
  const match = FRAGMENT_FINGERPRINT_LINE.exec(line);
  if (match === null) return null;
  return { id: match[1] as string, hash: match[2] as string };
}

/**
 * @param content - Whole file text.
 * @returns True iff the first line (newline-terminated) is a fingerprint line.
 */
export function startsWithFragmentFingerprint(content: string): boolean {
  const newline = content.indexOf("\n");
  return newline >= 0 && parseFragmentFingerprint(content.slice(0, newline)) !== null;
}
