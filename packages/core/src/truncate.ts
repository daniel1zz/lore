/**
 * Code-point-safe text truncation (BUG-001 audit fix).
 *
 * Public surface:
 *   - headChars(text, max) — keep the FIRST `max` UTF-16 code units of `text`.
 *   - tailChars(text, max) — keep the LAST `max` UTF-16 code units of `text`.
 *   Neither ever splits a surrogate pair at the cut boundary.
 *
 * Invariants:
 *   - Budget is an upper bound, never exceeded: `result.length <= max` always holds.
 *     A naive cut point that would land inside a surrogate pair shrinks the result by
 *     ONE additional code unit (dropping the orphaned half of the pair) rather than
 *     growing past `max`.
 *   - `result.length === text.length` when `text.length <= max` (no truncation needed).
 *   - BMP-only input (no surrogate pairs anywhere near the cut point) is byte-identical
 *     to the naive `.slice()` truncation these two helpers replace — REGRESSION
 *     contract for the four call sites this module consolidates.
 *   - `max <= 0` returns `""`.
 *
 * Side-effect class: Pure.
 *
 * ---
 * ## Why boundary-inspection, not `Array.from(text)` (deliberate perf tradeoff)
 *
 * A correct-by-construction alternative is `Array.from(text).slice(...)`, which walks
 * every code point in the string to build an array before slicing. That is O(n) on the
 * FULL input length regardless of where the truncation point falls — for a multi-MB
 * oracle-output capture (this module's real callers: `lore evidence
 * --output-tail-file`, `lore verify`'s captured stdout+stderr, `lore handoff
 * --failing-tail-file`, and assess-prompt section truncation), an MB-scale string would
 * be fully re-materialised into a code-point array just to keep the last `CAPTURE_TAIL_CHARS` characters
 * of it.
 *
 * Instead: take the naive `.slice()` cut point, then inspect AT MOST the single pair of
 * UTF-16 code units straddling that cut point (`String.charCodeAt` — O(1), independent
 * of `text.length`). If that pair forms a split surrogate pair, shift the cut point by
 * exactly one code unit so it lands outside the pair.
 *
 * ## The bug this fixes
 *
 * `text.slice(text.length - max)` (old `tailChars`, three independent copies) and
 * `text.slice(0, maxChars)` (old `truncateSection` head-truncation) both cut purely by
 * UTF-16 code-unit offset, with no awareness that an astral-plane character (emoji, CJK
 * extension-B, etc.) occupies TWO code units (a "surrogate pair"). When the cut lands
 * between the two halves of a pair, the result starts or ends with a single, unpaired
 * surrogate code unit (in the `0xD800`–`0xDFFF` range). Empirically verified:
 * `bun:sqlite` accepts and stores an unpaired surrogate on write WITHOUT raising an
 * error, but does not round-trip it — the value reads back corrupted, silently, with no
 * error at write OR read time.
 *
 * Source: BUG-001 audit finding (2026-07-20).
 */

/** Lower bound of the UTF-16 high-surrogate range (first half of a surrogate pair). */
const HIGH_SURROGATE_MIN = 0xd800;
/** Upper bound of the UTF-16 high-surrogate range. */
const HIGH_SURROGATE_MAX = 0xdbff;
/** Lower bound of the UTF-16 low-surrogate range (second half of a surrogate pair). */
const LOW_SURROGATE_MIN = 0xdc00;
/** Upper bound of the UTF-16 low-surrogate range. */
const LOW_SURROGATE_MAX = 0xdfff;

function isHighSurrogate(code: number): boolean {
  return code >= HIGH_SURROGATE_MIN && code <= HIGH_SURROGATE_MAX;
}

function isLowSurrogate(code: number): boolean {
  return code >= LOW_SURROGATE_MIN && code <= LOW_SURROGATE_MAX;
}

/**
 * Keep the first `max` UTF-16 code units of `text`, without splitting a surrogate pair
 * at the cut boundary.
 *
 * @param text - Source text; may contain astral-plane characters (e.g. emoji).
 * @param max - Budget in UTF-16 code units. `max <= 0` returns `""`.
 * @returns The head of `text`, at most `max` code units — `max - 1` when the naive cut
 *   point would have split a surrogate pair, `text` unchanged when it's already within
 *   budget.
 * @example
 *   headChars("hello world", 5); // => "hello"
 *   headChars("hi", 5); // => "hi" (already within budget)
 *   headChars("a😀b", 2); // => "a" (naive cut at 2 would split the emoji pair)
 */
export function headChars(text: string, max: number): string {
  if (max <= 0) return "";
  if (text.length <= max) return text;
  let end = max;
  if (isHighSurrogate(text.charCodeAt(end - 1)) && isLowSurrogate(text.charCodeAt(end))) {
    end -= 1;
  }
  return text.slice(0, end);
}

/**
 * Keep the last `max` UTF-16 code units of `text`, without splitting a surrogate pair
 * at the cut boundary.
 *
 * @param text - Source text; may contain astral-plane characters (e.g. emoji).
 * @param max - Budget in UTF-16 code units. `max <= 0` returns `""`.
 * @returns The tail of `text`, at most `max` code units — `max - 1` when the naive cut
 *   point would have split a surrogate pair, `text` unchanged when it's already within
 *   budget.
 * @example
 *   tailChars("hello world", 5); // => "world"
 *   tailChars("hi", 5); // => "hi" (already within budget)
 *   tailChars("a😀b", 2); // => "b" (naive cut at length-2 would split the emoji pair)
 */
export function tailChars(text: string, max: number): string {
  if (max <= 0) return "";
  if (text.length <= max) return text;
  let start = text.length - max;
  if (isLowSurrogate(text.charCodeAt(start)) && isHighSurrogate(text.charCodeAt(start - 1))) {
    start += 1;
  }
  return text.slice(start);
}
