/**
 * DocCard — compact summary card for a single document in list or search results.
 * Purpose: renders title, type badge, status badge, relative update time, and
 *   (SPEC-036 §1 D3) a type-differentiated left accent border, one meta row
 *   per type, tag chips, and a noise-budgeted priority badge.
 * Public surface: DocCard, DocCardProps
 * Invariants: read-only; no mutations. SPEC-015 §2.2 forbids all write paths.
 * Side-effect class: pure (renders received data; navigation is caller's concern via onClick)
 */

import type { DocSummary } from "@lore/core";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { TYPE_ACCENT, TYPE_ACCENT_BORDER_CLASS } from "@/lib/type-accent";
import { formatTypeMetaLabel, isNotablePriority, metaBadgeVariant } from "@/lib/type-meta-label";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { getTypeBadgeVariant, getStatusBadgeVariant } from "@/lib/doc-badge-variants";

/** Tags beyond this count collapse into a single "+n" overflow chip (SPEC-036 §1 D3). */
const TAG_DISPLAY_LIMIT = 3;

export interface DocCardProps {
  /** The document summary to render. */
  doc: DocSummary;
  /** Called when the card is clicked. Typically navigates to the doc detail page. */
  onClick?: () => void;
}

/**
 * Compact doc summary card. Renders type + status badges, relative update
 * time, a type accent border + meta row, tag chips, and a priority badge
 * when notable.
 *
 * @example
 * <DocCard doc={docSummary} onClick={() => router.navigate({ to: '/docs/$id', params: { id: doc.id } })} />
 */
export function DocCard({ doc, onClick }: DocCardProps): React.ReactElement {
  const metaLabel = doc.meta !== undefined ? formatTypeMetaLabel(doc.meta) : null;
  const showPriority = isNotablePriority(doc.priority);
  const visibleTags = doc.tags.slice(0, TAG_DISPLAY_LIMIT);
  const overflowTagCount = doc.tags.length - visibleTags.length;

  return (
    <Card
      className={cn(
        "cursor-pointer hover:shadow-md transition-shadow",
        TYPE_ACCENT_BORDER_CLASS,
        TYPE_ACCENT[doc.type],
      )}
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label={`Open document: ${doc.title}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base leading-tight">{doc.title}</CardTitle>
          <div className="flex gap-1 shrink-0">
            <Badge variant={getTypeBadgeVariant(doc.type)} className="text-xs">
              {doc.type}
            </Badge>
            <Badge variant={getStatusBadgeVariant(doc.status)} className="text-xs">
              {doc.status}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          <span className="font-mono text-xs">{doc.slug}</span>
          {" · "}
          {formatRelativeTime(doc.updated_at)}
        </p>

        {(metaLabel !== null || showPriority) && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {metaLabel !== null && (
              <Badge variant={doc.meta !== undefined ? metaBadgeVariant(doc.meta) : "outline"} className="text-xs">
                {metaLabel}
              </Badge>
            )}
            {showPriority && (
              <Badge variant={doc.priority === "critical" ? "destructive" : "secondary"} className="text-xs">
                {doc.priority}
              </Badge>
            )}
          </div>
        )}

        {doc.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {visibleTags.map((tag) => (
              <Badge key={tag} variant="outline" className="text-xs">
                {tag}
              </Badge>
            ))}
            {overflowTagCount > 0 && (
              <Badge variant="outline" className="text-xs">
                +{overflowTagCount}
              </Badge>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
