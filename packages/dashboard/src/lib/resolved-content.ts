/**
 * Splits a document's raw markdown content into an ordered sequence of
 * segments, splicing in each resolved MDX placeholder (component) and each
 * resolution warning (stripped/unknown component) as typed slots instead of
 * leaving their raw `<ComponentName ... />` tag text in the markdown stream.
 * Purpose: the SSOT for how `ResolvedPrdBody` decides what to render at each
 *   placeholder position — kept separate from React so the splicing logic
 *   (position math, ordering, boundary handling) has a pure, DOM-free test
 *   oracle. Mirrors the server's own text-projection splice
 *   (`OutlineService.renderResolvedToMarkdown`, packages/lore/src/service/
 *   outline-service.ts) but keeps the projection as typed React slots instead
 *   of a spliced markdown string — SPEC-033 §2.2 explicitly forbids
 *   spliced-markdown-as-HTML on this surface.
 * Public surface: ContentSegment, splitContentByPlaceholders
 * Invariants:
 *   - Segments are produced in ascending document order (position.start).
 *   - `resolvedComponents` and `warnings` positions are assumed NON-OVERLAPPING —
 *     OutlineService's regex-based extractor (COMPONENT_REGEX) never emits
 *     overlapping matches, and a given tag resolves to exactly one outcome
 *     (either a resolved component OR a warning, never both), so the merged
 *     slot list never has two slots claiming the same span.
 *   - Empty `content` or zero placeholders never throws: zero slots produces
 *     a single markdown segment (or zero segments for empty content) — the
 *     caller (`ResolvedPrdBody`) renders a labeled empty state for the latter.
 * Side-effect class: pure
 * Source: SPEC-033 §2.2 (AC-33-1: zero raw placeholder tags rendered as text)
 */

import type { ResolvedComponent, ResolutionWarning } from "@/lib/api";

/** One ordered slice of a document's resolved content stream. */
export type ContentSegment =
  | { kind: "markdown"; text: string }
  | { kind: "component"; component: ResolvedComponent }
  | { kind: "warning"; warning: ResolutionWarning };

interface PositionedSlot {
  position: { start: number; end: number };
  segment: ContentSegment;
}

/**
 * Splice resolved components and warnings into a document's raw content,
 * producing an ordered list of markdown/component/warning segments that
 * together cover the entire input string.
 *
 * @param content - The document's raw (unspliced) markdown body.
 * @param resolvedComponents - Successfully resolved MDX placeholders, from `resolvedMdx.resolvedComponents`.
 * @param warnings - Stripped/unknown placeholders, from `resolvedMdx.warnings`.
 * @returns Ordered segments covering the full `content` string with placeholders replaced by typed slots.
 * @example
 * splitContentByPlaceholders(
 *   "a <ChildrenOf/> b",
 *   [{ name: "ChildrenOf", props: {}, data: { children: [] }, position: { start: 2, end: 15 } }],
 *   [],
 * );
 * // [{kind:"markdown", text:"a "}, {kind:"component", component:{...}}, {kind:"markdown", text:" b"}]
 */
export function splitContentByPlaceholders(
  content: string,
  resolvedComponents: ResolvedComponent[],
  warnings: ResolutionWarning[],
): ContentSegment[] {
  const slots: PositionedSlot[] = [
    ...resolvedComponents.map(
      (component): PositionedSlot => ({
        position: component.position,
        segment: { kind: "component", component },
      }),
    ),
    ...warnings.map(
      (warning): PositionedSlot => ({
        position: warning.position,
        segment: { kind: "warning", warning },
      }),
    ),
  ].sort((a, b) => a.position.start - b.position.start);

  const segments: ContentSegment[] = [];
  let cursor = 0;

  for (const slot of slots) {
    if (slot.position.start > cursor) {
      segments.push({ kind: "markdown", text: content.slice(cursor, slot.position.start) });
    }
    segments.push(slot.segment);
    cursor = Math.max(cursor, slot.position.end);
  }

  if (cursor < content.length) {
    segments.push({ kind: "markdown", text: content.slice(cursor) });
  }

  return segments;
}
