/**
 * SearchResultCard — compact card for a single full-text search hit.
 * Purpose: renders title, snippet, and slug for a `SearchHit` (search results carry a
 *   BM25 score + content snippet, NOT the full `DocSummary` shape — no `type`/`status`/
 *   `updated_at` — so this is deliberately a separate component from `DocCard`, which
 *   requires those fields. Reusing `DocCard` here would force fabricating fields the
 *   server never sends.
 * Public surface: SearchResultCard, SearchResultCardProps
 * Invariants: read-only; no mutations. Snippet is plain text (FTS5 `snippet()` wraps
 *   matches in `[` / `]`, not HTML) — safe to render as text, never via
 *   dangerouslySetInnerHTML.
 * Side-effect class: pure (renders received data; navigation is caller's concern via onClick)
 */

import type { SearchHit } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface SearchResultCardProps {
  /** The search hit to render. */
  hit: SearchHit;
  /** Called when the card is clicked. Typically navigates to the doc detail page. */
  onClick?: () => void;
}

/**
 * Compact search hit card. Renders title, snippet, and slug.
 *
 * @example
 * <SearchResultCard hit={searchHit} onClick={() => router.navigate({ to: '/docs/$id', params: { id: hit.id } })} />
 */
export function SearchResultCard({ hit, onClick }: SearchResultCardProps): React.ReactElement {
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
        <CardTitle className="text-base leading-tight">{hit.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-1">{hit.snippet}</p>
        <p className="text-xs text-muted-foreground">
          <span className="font-mono text-xs">{hit.slug}</span>
        </p>
      </CardContent>
    </Card>
  );
}
