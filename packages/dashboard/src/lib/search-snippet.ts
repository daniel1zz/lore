/**
 * Search snippet mark-splitting — pure helper that turns a FTS5 snippet string
 * (matched spans wrapped in `SNIPPET_MARK_OPEN`/`SNIPPET_MARK_CLOSE`, SPEC-037
 * §2) into a flat list of `{text, matched}` segments `SearchResultCard` maps
 * to plain text / `<mark>` elements. Kept independent of React (same pattern
 * as `resolved-content.ts::splitContentByPlaceholders`) so the splitting rule
 * itself is unit-testable without mounting a component.
 *
 * Public surface: splitSnippetIntoSegments, SnippetSegment
 * Invariants:
 *   - The sentinels are C0 control characters that cannot occur in authored
 *     markdown — so a literal `[`/`]` in a document's body is NEVER mistaken
 *     for a highlight marker; it passes through untouched as plain text
 *     inside a non-matched segment (AC-37-8).
 *   - An unterminated open marker (malformed/truncated snippet) treats the
 *     remainder of the string as a matched segment rather than losing it or
 *     throwing — fail-loud-by-inclusion, not by crash.
 *   - Empty string input returns an empty segment array.
 * Side-effect class: pure
 * Source: SPEC-037 §1 D5, AC-37-8
 *
 * @example
 * splitSnippetIntoSegments(`a ${SNIPPET_MARK_OPEN}bc${SNIPPET_MARK_CLOSE} d`)
 * // => [{text:"a ", matched:false}, {text:"bc", matched:true}, {text:" d", matched:false}]
 */

import { SNIPPET_MARK_OPEN, SNIPPET_MARK_CLOSE } from "@lore/core";

export interface SnippetSegment {
  text: string;
  matched: boolean;
}

/**
 * Splits a snippet string into alternating matched/non-matched segments.
 * @param snippet - Raw snippet string from a `SearchHit`.
 * @returns Ordered list of segments; empty-string segments are omitted.
 */
export function splitSnippetIntoSegments(snippet: string): SnippetSegment[] {
  const segments: SnippetSegment[] = [];
  let cursor = 0;

  while (cursor < snippet.length) {
    const openIndex = snippet.indexOf(SNIPPET_MARK_OPEN, cursor);
    if (openIndex === -1) {
      pushSegment(segments, snippet.slice(cursor), false);
      break;
    }

    pushSegment(segments, snippet.slice(cursor, openIndex), false);

    const closeIndex = snippet.indexOf(SNIPPET_MARK_CLOSE, openIndex + SNIPPET_MARK_OPEN.length);
    if (closeIndex === -1) {
      // reason: unterminated marker — treat the remainder as matched rather
      // than dropping it (fail-loud-by-inclusion).
      pushSegment(segments, snippet.slice(openIndex + SNIPPET_MARK_OPEN.length), true);
      break;
    }

    pushSegment(segments, snippet.slice(openIndex + SNIPPET_MARK_OPEN.length, closeIndex), true);
    cursor = closeIndex + SNIPPET_MARK_CLOSE.length;
  }

  return segments;
}

function pushSegment(segments: SnippetSegment[], text: string, matched: boolean): void {
  if (text.length > 0) segments.push({ text, matched });
}
