/**
 * Tag vocabulary — derives the distinct tag list + counts for the library
 * tag-filter chips (SPEC-036 §1 D2) from an already-fetched, unfiltered doc
 * list.
 * Purpose: pure aggregation so the "distinct tags across the corpus, sorted
 *   by count desc" computation is unit-testable independent of the TanStack
 *   Query cache it reads from.
 * Public surface: computeTagVocabulary, TagVocabularyEntry
 * Invariants:
 *   - Reads only `doc.tags` from an already-loaded `DocSummary[]` — never
 *     issues its own fetch. The caller supplies the corpus's UNFILTERED
 *     `apiList({})` result (SPEC-036 §1 D2's documented zero-extra-request
 *     rationale: that call is already the library's landing query).
 *   - Sort order: count descending, tag name ascending as a stable tiebreaker.
 * Side-effect class: pure
 * Source: SPEC-036 §1 D2, AC-36-6
 */

import type { DocSummary } from "@lore/core";

export interface TagVocabularyEntry {
  tag: string;
  count: number;
}

/**
 * Aggregates distinct tags + occurrence counts across a doc list.
 *
 * @param docs - Doc summaries to aggregate over (typically the unfiltered corpus list).
 * @returns Distinct tags sorted by count descending, then tag name ascending.
 *
 * @example
 * computeTagVocabulary([{ tags: ["a", "b"], ... }, { tags: ["a"], ... }])
 * // => [{ tag: "a", count: 2 }, { tag: "b", count: 1 }]
 */
export function computeTagVocabulary(docs: DocSummary[]): TagVocabularyEntry[] {
  const counts = new Map<string, number>();
  for (const doc of docs) {
    for (const tag of doc.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
