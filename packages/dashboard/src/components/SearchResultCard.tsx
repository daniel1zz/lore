/**
 * SearchResultCard — compact card for a single full-text search hit.
 * Purpose: renders title, snippet, slug, and (SPEC-037 D5) type/status badges
 *   for a `SearchHit` — the SPEC-037 §2 contract added `type`/`status` fields
 *   to `SearchHit` specifically so this card can carry the same badges as
 *   `DocCard` without a second query. Still a deliberately separate component
 *   from `DocCard` (no `updated_at`, and the snippet needs mark-splitting
 *   `DocCard` has no reason to do).
 * Public surface: SearchResultCard, SearchResultCardProps
 * Invariants: read-only; no mutations. The snippet's matched spans are wrapped
 *   in `SNIPPET_MARK_OPEN`/`SNIPPET_MARK_CLOSE` control-character sentinels
 *   (never `[`/`]` — those collide with literal brackets in document bodies,
 *   the pre-037 bug this replaces); `splitSnippetIntoSegments`
 *   (`@/lib/search-snippet`) turns them into `<mark>` elements — never
 *   `dangerouslySetInnerHTML`.
 * Side-effect class: pure (renders received data; navigation is caller's concern via onClick)
 */

import type { SearchHit } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getTypeBadgeVariant, getStatusBadgeVariant } from "@/lib/doc-badge-variants";
import { splitSnippetIntoSegments } from "@/lib/search-snippet";

export interface SearchResultCardProps {
  /** The search hit to render. */
  hit: SearchHit;
  /** Called when the card is clicked. Typically navigates to the doc detail page. */
  onClick?: () => void;
}

/**
 * Compact search hit card. Renders title, type/status badges, mark-highlighted
 * snippet, and slug.
 *
 * @example
 * <SearchResultCard hit={searchHit} onClick={() => router.navigate({ to: '/docs/$id', params: { id: hit.id } })} />
 */
export function SearchResultCard({ hit, onClick }: SearchResultCardProps): React.ReactElement {
  const segments = splitSnippetIntoSegments(hit.snippet);

  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-shadow"
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label={`Open document: ${hit.title}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base leading-tight">{hit.title}</CardTitle>
          <div className="flex gap-1 shrink-0">
            <Badge variant={getTypeBadgeVariant(hit.type)} className="text-xs">
              {hit.type}
            </Badge>
            <Badge variant={getStatusBadgeVariant(hit.status)} className="text-xs">
              {hit.status}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-1">
          {segments.map((segment, index) =>
            segment.matched ? (
              <mark key={index} className="bg-yellow-200 text-yellow-950 dark:bg-yellow-900 dark:text-yellow-100 rounded-sm px-0.5">
                {segment.text}
              </mark>
            ) : (
              <span key={index}>{segment.text}</span>
            ),
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          <span className="font-mono text-xs">{hit.slug}</span>
        </p>
      </CardContent>
    </Card>
  );
}
