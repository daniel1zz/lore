/**
 * parent-suggestions — pure filtering/formatting helpers behind NewDocModal's
 * searchable parent-document picker (dogfood 2026-07-26 ISSUE-004).
 * Purpose: before this module, "Parent ID" was a bare text input demanding a
 *   hand-typed ULID/slug with no autocomplete — a human had to leave the
 *   modal, find a doc, copy its slug, and return, discovering a typo only at
 *   first submit. `filterParentSuggestions` narrows the already-fetched,
 *   already-cached doc list (`LibraryPageBody`'s unfiltered `apiList` query —
 *   no extra network request) to candidates the current child type could
 *   legally attach under, matched against the user's in-progress text.
 * Public surface: PARENT_SUGGESTION_LIMIT, filterParentSuggestions, formatParentSuggestionLabel
 * Invariants:
 *   - Parent-VALIDITY filtering reuses @lore/core's existing
 *     isValidParentType(child, parent) / PARENT_TYPE_CONTRACT -- this module
 *     invents NO new parent-validity rule; the server (CorpusService)
 *     remains the sole validator, this is a convenience narrowing only.
 *     PARENT_TYPE_CONTRACT is a "satisfies Record<DocType, ...>" total map
 *     (every DocType has an entry, possibly empty), so every real DocType
 *     value this module is ever handed resolves cleanly.
 *   - Query matching is case-insensitive substring match against BOTH
 *     title AND slug -- an empty/whitespace-only query matches every
 *     valid-parent-type candidate (used to show a starter list on focus,
 *     before the user has typed anything).
 *   - Capped at {@link PARENT_SUGGESTION_LIMIT} entries -- a corpus with
 *     hundreds of eligible parents must never render an unbounded dropdown.
 *   - Suggestion ORDER is stable input order (no re-sort) -- same
 *     no-independent-re-sort discipline PendingPanel/TriageQueue already
 *     apply to their own server-ordered lists; this module doesn't invent a
 *     relevance ranking.
 *   - Never throws on empty input (docs: [] -> []), not an error) -- the
 *     picker degrades to "no suggestions" for a component that hasn't been
 *     given a doc list yet (e.g. an early render before the query resolves),
 *     while the underlying text input stays fully typable/submittable
 *     regardless (this module never reads or mutates the input's own value).
 * Side-effect class: pure
 * Source: dogfood 2026-07-26 ISSUE-004; ADR-free (routine UX affordance,
 *   reuses the pre-existing parent-type contract) -- see NewDocModal.tsx's
 *   module doc comment for the picker's UI-level design choice (datalist vs
 *   custom combobox).
 */

import { isValidParentType } from "@lore/core";
import type { DocSummary, DocType } from "@lore/core";

/** Maximum number of parent-document suggestions shown at once. */
export const PARENT_SUGGESTION_LIMIT = 8;

/**
 * Narrow `docs` to the top {@link PARENT_SUGGESTION_LIMIT} candidates that
 * (a) are a valid parent type for `childType` per `@lore/core`'s
 * `PARENT_TYPE_CONTRACT`, and (b) match `query` (case-insensitive substring)
 * against either `title` or `slug`.
 *
 * @param docs - Candidate documents (e.g. the Library page's unfiltered `apiList` cache).
 * @param childType - The doc type currently selected in NewDocModal (the type being created).
 * @param query - The user's in-progress "Parent ID" input text.
 * @returns At most {@link PARENT_SUGGESTION_LIMIT} matching docs, in `docs`' own order.
 *
 * @example
 * filterParentSuggestions(docs, "task", "auth")
 * // => plans whose title or slug contains "auth", in docs' own order
 */
export function filterParentSuggestions(
  docs: readonly DocSummary[],
  childType: DocType,
  query: string,
): DocSummary[] {
  const q = query.trim().toLowerCase();
  const matches: DocSummary[] = [];
  for (const doc of docs) {
    if (!isValidParentType(childType, doc.type)) continue;
    if (q !== "" && !doc.title.toLowerCase().includes(q) && !doc.slug.toLowerCase().includes(q)) continue;
    matches.push(doc);
    if (matches.length >= PARENT_SUGGESTION_LIMIT) break;
  }
  return matches;
}

/**
 * Format a candidate's suggestion-row label: `"{title} -- {slug} ({type})"`.
 *
 * @param doc - The candidate document.
 * @returns The display label for one suggestion row.
 *
 * @example
 * formatParentSuggestionLabel({ title: "Auth spec", slug: "spec-auth", type: "spec", ... })
 * // => "Auth spec -- spec-auth (spec)"
 */
export function formatParentSuggestionLabel(doc: DocSummary): string {
  return `${doc.title} — ${doc.slug} (${doc.type})`;
}
