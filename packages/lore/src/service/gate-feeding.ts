/**
 * "Active feeding" — minimal-slice content assembly for `lore gate spec-create`
 * (the IoC vertical-slice tech-spec §4.1/§11). When a candidate spec fails one or
 * more `gate-predicates.ts` predicates, the gate must give the AI enough to fix the
 * violation WITHOUT dumping full documents back into context (context-rot hard
 * boundary from the tech-spec) — pointers + a small, sourced, trust-labelled slice
 * only. `buildFeedingPack` performs the trimming; `renderFeedingPack` turns the
 * result into the plain-text block the gate embeds in its `reason` field.
 *
 * Pure, side-effect-free functions. No store, no IO — the caller (not-yet-implemented
 * `lore gate spec-create`) is responsible for reading the rule doc and parent doc
 * markdown from the corpus (and for only ever passing APPROVED corpus documents in —
 * the corpus is itself an attack surface, so feeding an unreviewed/draft doc's
 * content back into a prompt is out of scope for this module and must be enforced
 * by the caller before invoking `buildFeedingPack`).
 *
 * @invariant Truncation always preserves the LEADING slice of the source markdown
 *   (title + first paragraph live at the top of every corpus doc by convention) and
 *   discards the tail. It never preserves the middle or the end.
 * @invariant `renderFeedingPack`'s output always carries a `[source: ..., trust: ...]`
 *   provenance header as its first line — every AI-facing string this module
 *   produces is traceable to exactly one team-authored corpus document.
 */

/** Minimal-slice content package the gate feeds back to the AI on a rule violation. */
export interface FeedingPack {
  /** Slug of the rule document the `ruleSlice` was cut from. */
  source: string;
  /**
   * Trust label for `source`. Always `"team-authored"` — `buildFeedingPack` has no
   * other trust tier because the caller contract requires the rule doc to be an
   * approved, team-authored corpus document (see module header). A future gate that
   * feeds AI-authored or externally-sourced content would need a new label, not a
   * relaxation of this one.
   */
  trust: "team-authored";
  /** Leading slice of the rule document's markdown, truncated to at most `maxChars`. */
  ruleSlice: string;
  /**
   * Leading slice of the target parent document's markdown, truncated to at most
   * `maxChars`. Absent (not an empty string) when the caller supplied no
   * `parentMarkdown` — distinguishes "no parent slice available" from "parent slice
   * is empty".
   */
  parentSlice?: string;
  /** Machine-readable list of what the gate determined is missing/violated, passed through unchanged. */
  missing: string[];
}

/** `buildFeedingPack`'s default per-slice character budget (rule slice and parent slice each). */
export const DEFAULT_FEEDING_MAX_CHARS = 800;

/** Appended when a slice is truncated, so the reader can tell the doc continues beyond the cut. */
const TRUNCATION_SUFFIX = "\n\n…[truncated]";

/**
 * Cuts `markdown` down to its leading slice, at most `maxChars` characters INCLUDING
 * any truncation marker — never over budget, even at very small `maxChars`.
 *
 * @param markdown - Source markdown (rule doc or parent doc body).
 * @param maxChars - Hard cap on the returned string's length.
 * @returns `markdown` unchanged when `markdown.length <= maxChars`; otherwise the
 *   leading `maxChars - TRUNCATION_SUFFIX.length` characters plus `TRUNCATION_SUFFIX`
 *   (or, when `maxChars` is too small to fit the suffix, a bare leading slice of
 *   exactly `maxChars` characters with no suffix).
 * @example
 * truncateLeadingSlice("short", 800);              // => "short" (unchanged)
 * truncateLeadingSlice("a".repeat(1000), 800).length <= 800; // => true
 */
function truncateLeadingSlice(markdown: string, maxChars: number): string {
  if (markdown.length <= maxChars) {
    return markdown;
  }
  if (maxChars <= TRUNCATION_SUFFIX.length) {
    return markdown.slice(0, maxChars);
  }
  const budget = maxChars - TRUNCATION_SUFFIX.length;
  return markdown.slice(0, budget) + TRUNCATION_SUFFIX;
}

/**
 * Assembles a {@link FeedingPack} from a rule document, an optional parent document,
 * and the gate's `missing` list — trimming both markdown inputs to `maxChars` via
 * {@link truncateLeadingSlice}.
 *
 * @param input.ruleSource - Slug of the rule document `ruleMarkdown` was read from.
 * @param input.ruleMarkdown - Full markdown body of the rule document (caller reads it;
 *   this function never touches the store).
 * @param input.parentMarkdown - Full markdown body of the candidate spec's target
 *   parent document, when one exists. Omit entirely (do not pass `""`) when there is
 *   no parent slice to feed.
 * @param input.missing - Machine-readable reasons the gate rejected the candidate
 *   (e.g. `gate-predicates.ts` `PredicateResult.reason` values). Passed through
 *   unchanged — this function does not interpret or validate the codes.
 * @param input.maxChars - Per-slice character budget; defaults to
 *   {@link DEFAULT_FEEDING_MAX_CHARS} (800).
 * @returns A `FeedingPack` with `trust: "team-authored"` always set (see the field's
 *   own doc comment for why there is no other tier).
 * @example
 * buildFeedingPack({
 *   ruleSource: "knowledge-write-spec-rules",
 *   ruleMarkdown: "## Rule\n...",
 *   missing: ["PARENT_REQUIRED"],
 * });
 * // => { source: "knowledge-write-spec-rules", trust: "team-authored",
 * //      ruleSlice: "## Rule\n...", missing: ["PARENT_REQUIRED"] }
 */
export function buildFeedingPack(input: {
  ruleSource: string;
  ruleMarkdown: string;
  parentMarkdown?: string;
  missing: string[];
  maxChars?: number;
}): FeedingPack {
  const maxChars = input.maxChars ?? DEFAULT_FEEDING_MAX_CHARS;
  const ruleSlice = truncateLeadingSlice(input.ruleMarkdown, maxChars);
  const parentSlice =
    input.parentMarkdown === undefined
      ? undefined
      : truncateLeadingSlice(input.parentMarkdown, maxChars);

  return {
    source: input.ruleSource,
    trust: "team-authored",
    ruleSlice,
    ...(parentSlice !== undefined ? { parentSlice } : {}),
    missing: [...input.missing],
  };
}

/**
 * Renders a {@link FeedingPack} into the plain-text block `lore gate spec-create`
 * embeds in its rejection `reason`. Always leads with a `[source: ..., trust: ...]`
 * provenance line (module invariant), followed by the `missing` list (when
 * non-empty), the rule slice, and — when present — the parent slice.
 *
 * @param pack - A `FeedingPack` produced by {@link buildFeedingPack}.
 * @returns Plain-text, newline-joined block. Never throws.
 * @example
 * renderFeedingPack({
 *   source: "knowledge-write-spec-rules", trust: "team-authored",
 *   ruleSlice: "## Rule\n...", missing: ["INVALID_SPEC_KIND"],
 * });
 * // => "[source: knowledge-write-spec-rules, trust: team-authored]\n\nMissing:\n- INVALID_SPEC_KIND\n\n## Rule\n..."
 */
export function renderFeedingPack(pack: FeedingPack): string {
  const lines: string[] = [`[source: ${pack.source}, trust: ${pack.trust}]`];

  if (pack.missing.length > 0) {
    lines.push("");
    lines.push("Missing:");
    for (const reason of pack.missing) {
      lines.push(`- ${reason}`);
    }
  }

  lines.push("");
  lines.push("## Rule");
  lines.push(pack.ruleSlice);

  if (pack.parentSlice !== undefined) {
    lines.push("");
    lines.push("## Parent");
    lines.push(pack.parentSlice);
  }

  return lines.join("\n");
}
