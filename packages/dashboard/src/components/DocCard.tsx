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
import { formatTypeMetaLabel, isNotablePriority } from "@/lib/type-meta-label";

/** Tags beyond this count collapse into a single "+n" overflow chip (SPEC-036 §1 D3). */
const TAG_DISPLAY_LIMIT = 3;

export interface DocCardProps {
  /** The document summary to render. */
  doc: DocSummary;
  /** Called when the card is clicked. Typically navigates to the doc detail page. */
  onClick?: () => void;
}

/** Map DocType to a badge variant for visual distinction. */
function getTypeBadgeVariant(type: string): "default" | "secondary" | "outline" | "destructive" {
  switch (type) {
    case "prd":
    case "spec":
      return "default";
    case "adr":
    case "plan":
      return "secondary";
    default:
      return "outline";
  }
}

/** Map DocStatus to a badge variant. */
function getStatusBadgeVariant(status: string): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "active":
    case "approved":
      return "default";
    case "draft":
    case "in-review":
      return "secondary";
    case "archived":
    case "deprecated":
      return "outline";
    default:
      return "outline";
  }
}

/**
 * Format an ISO timestamp as a human-readable relative time string.
 * @param iso - ISO 8601 date string.
 * @returns Relative time string like "2 days ago".
 */
function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 30) return `${diffDays} days ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths} months ago`;
  return `${Math.floor(diffMonths / 12)} years ago`;
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
              <Badge variant="outline" className="text-xs">
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
