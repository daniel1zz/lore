/**
 * Two-zone CLAUDE.md marker vocabulary — the shared grammar for the
 * lore-managed section wrapper (Z1) and the per-section fingerprint comment
 * that detects hand-edits inside it (SPEC-context-verb-family D5). Pure,
 * browser-safe leaf module: constants + a data shape + two string
 * format/parse helpers, no IO, no Node builtins.
 *
 * Public surface:
 *   - CLAUDE_MD_MARKER_START / CLAUDE_MD_MARKER_END — the outer Z1 wrapper
 *     lines. MUST stay byte-identical to the literals historically owned by
 *     `flows/setup-project-flow.ts` (SPEC-076 D7) — that file keeps its own
 *     copies until its splice-SSOT refactor task consumes these instead
 *     (transient duplication is accepted, tracked by the governing spec).
 *   - ManagedSectionMeta — `{ id, hash }`, the identity of one managed
 *     section for divergence detection (SPEC-context-verb-family D5).
 *   - formatManagedSectionFingerprint / parseManagedSectionFingerprint — the
 *     `<!-- lore:managed section=<id> hash=<8hex> -->` comment grammar.
 *     Hash computation itself (sha256 over the section body) is Node-only
 *     and lives in `packages/lore/src/service/context-projection.ts`, not
 *     here — this module only knows the wire format.
 *
 * Invariants:
 *   - No IO, no wall-clock reads, no Node builtins — consumed by both the
 *     server runtime (`packages/lore/**`) and the browser dashboard via the
 *     `@lore/core` barrel.
 *   - `parseManagedSectionFingerprint` is a tolerant parser: non-matching
 *     input returns `null`, it never throws — callers decide whether a
 *     missing/malformed fingerprint is an error in their own context.
 *
 * Source: `spec-context-verb-family-two-zone-claude-md-anatomy-lore` §Public
 *   Interface, §Design Decisions D5.
 */

/** Opening marker of the lore-managed (Z1) section of a repo's CLAUDE.md. Byte-identical to `setup-project-flow.ts`'s `CLAUDE_MD_MARKER_START`. */
export const CLAUDE_MD_MARKER_START = "# ─── lore governance (managed) ───";

/** Closing marker of the lore-managed (Z1) section of a repo's CLAUDE.md. Byte-identical to `setup-project-flow.ts`'s `CLAUDE_MD_MARKER_END`. */
export const CLAUDE_MD_MARKER_END = "# ─── end lore governance ───";

/**
 * Identity of one lore-managed section inside the Z1 wrapper (module index,
 * command table, governance pointer, spec-discovery pointer, ...).
 *
 * @property id - Stable section identifier (e.g. `"module-index"`); the same
 *   value `renderManagedSections` assigns and `parseManagedSections` reads
 *   back (both in `service/context-projection.ts`, out of this leaf's scope).
 * @property hash - First 8 hex chars of sha256 over the section body,
 *   EXCLUDING the fingerprint comment line itself. Lowercase, exactly 8
 *   chars — see {@link MANAGED_SECTION_HASH_PATTERN}.
 */
export interface ManagedSectionMeta {
  id: string;
  hash: string;
}

/** Shape a `ManagedSectionMeta.hash` value must match: exactly 8 lowercase hex chars. */
export const MANAGED_SECTION_HASH_PATTERN = /^[0-9a-f]{8}$/;

/**
 * Regex for one fingerprint comment line: `<!-- lore:managed section=<id>
 * hash=<8hex> -->`. Group 1 is the section id (any run of non-whitespace
 * chars), group 2 is the 8-hex hash. Anchored to the full (trimmed) line —
 * a fingerprint comment occupies its own line, never trailing other content.
 */
const MANAGED_SECTION_FINGERPRINT_LINE_PATTERN = /^<!-- lore:managed section=(\S+) hash=([0-9a-f]{8}) -->$/;

/**
 * Renders the fingerprint comment line for a managed section.
 *
 * Pure string formatting — trusts `meta` is well-formed (callers construct
 * `hash` from a sha256 digest, which is always 8 lowercase hex chars by
 * construction). Does not validate or throw; round-trips with
 * {@link parseManagedSectionFingerprint}.
 *
 * @param meta - The section's id + content-hash.
 * @returns The single-line HTML comment, no trailing newline.
 * @example
 * formatManagedSectionFingerprint({ id: "module-index", hash: "a1b2c3d4" })
 * // "<!-- lore:managed section=module-index hash=a1b2c3d4 -->"
 */
export function formatManagedSectionFingerprint(meta: ManagedSectionMeta): string {
  return `<!-- lore:managed section=${meta.id} hash=${meta.hash} -->`;
}

/**
 * Parses one fingerprint comment line back into its `{ id, hash }` meta.
 *
 * Tolerant parser, never throws: whitespace around `line` is trimmed before
 * matching; anything that doesn't match the exact grammar (wrong prefix,
 * missing `-->`, non-hex or wrong-length hash, extra trailing content)
 * returns `null` rather than a partial result. This is the ONLY signal
 * `parseManagedSections` (`service/context-projection.ts`) uses to detect a
 * hand-edited/missing fingerprint — a `null` there means "no fingerprint
 * found on this line", not "malformed input, fail loud".
 *
 * @param line - Candidate line, with or without surrounding whitespace/newline.
 * @returns The parsed `{ id, hash }`, or `null` if `line` is not a
 *   well-formed fingerprint comment.
 * @example
 * parseManagedSectionFingerprint("<!-- lore:managed section=module-index hash=a1b2c3d4 -->")
 * // { id: "module-index", hash: "a1b2c3d4" }
 * parseManagedSectionFingerprint("not a fingerprint") // null
 */
export function parseManagedSectionFingerprint(line: string): ManagedSectionMeta | null {
  const match = MANAGED_SECTION_FINGERPRINT_LINE_PATTERN.exec(line.trim());
  const id = match?.[1];
  const hash = match?.[2];
  if (id === undefined || hash === undefined) {
    return null;
  }
  return { id, hash };
}
