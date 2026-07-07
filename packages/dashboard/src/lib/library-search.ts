/**
 * Library filter <-> URL search-param mapping (SPEC-036 §1 D2).
 * Purpose: pure schema + serialize/deserialize helpers for `/library`'s router
 *   search state (type/status/tags), extracted so the mapping is
 *   unit-testable independent of TanStack Router. Fixes the pre-existing
 *   module invariant violation (`packages/dashboard/CLAUDE.md`: "all client
 *   state is server state + URL state") where filter state lived in
 *   `useState` instead of the URL — filters now survive reload/share/back
 *   (AC-36-5).
 * Public surface: librarySearchSchema, LibrarySearch, tagsFromParam, tagsToParam
 * Invariants:
 *   - `type`/`status` values are validated against the SSOT `@lore/core` Zod
 *     enums (`docTypeSchema`/`docStatusSchema`) — never a hand-rolled list.
 *   - Tags round-trip through a single comma-joined string param (never an
 *     array param) — matches `apiList`'s existing `tags` query-string shape,
 *     which the HTTP server comma-splits (`routes.ts`).
 *   - Empty/whitespace-only tag entries are dropped on both directions;
 *     an all-empty tag list serializes to `undefined` (param omitted from
 *     the URL) rather than an empty string.
 * Side-effect class: pure
 * Source: SPEC-036 §1 D2, AC-36-5, AC-36-6
 */

import { z } from "zod";
import { docTypeSchema, docStatusSchema } from "@lore/core";

/** Zod schema for `/library`'s router search params — passed to `validateSearch`. */
export const librarySearchSchema = z.object({
  type: docTypeSchema.optional(),
  status: docStatusSchema.optional(),
  /** Comma-joined tag list, e.g. `"a,b"`. Use {@link tagsFromParam}/{@link tagsToParam} to convert. */
  tags: z.string().optional(),
});

export type LibrarySearch = z.infer<typeof librarySearchSchema>;

/**
 * Parses the comma-joined `tags` URL param into a cleaned string array.
 *
 * @param param - Raw `tags` search param value (`undefined` when absent from the URL).
 * @returns Trimmed, non-empty tag names in URL order. `[]` when `param` is absent or blank.
 *
 * @example
 * tagsFromParam("a, b,,c") // => ["a", "b", "c"]
 * tagsFromParam(undefined) // => []
 */
export function tagsFromParam(param: string | undefined): string[] {
  if (param === undefined) return [];
  return param
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

/**
 * Serializes a tag list back into the comma-joined URL param form.
 *
 * @param tags - Selected tag names.
 * @returns Comma-joined string, or `undefined` when the cleaned list is empty
 *   (so the caller can omit the `tags` key entirely rather than writing `tags=`).
 *
 * @example
 * tagsToParam(["a", "b"]) // => "a,b"
 * tagsToParam([])         // => undefined
 */
export function tagsToParam(tags: string[]): string | undefined {
  const cleaned = tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0);
  return cleaned.length > 0 ? cleaned.join(",") : undefined;
}
