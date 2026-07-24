/**
 * IssueReportsCard — home-page side panel summarizing open incoming issue
 * reports (SPEC-074 AC-074-4).
 * Purpose: at-a-glance visibility into the dashboard's incoming-issues queue
 *   from the home page, without duplicating the full Issues page — shows the
 *   open count and up to 3 most-recent titles, each linking to the Issues
 *   page (per-report navigation is deliberately unavailable here; a click
 *   goes to the shared triage surface, mirroring `PendingPanel`'s "See all"
 *   pattern rather than duplicating per-row adjudication).
 * Public surface: IssueReportsCard, IssueReportsCardProps
 * Invariants:
 *   - Reads the SAME shared query (`useIssueReportsQuery`) as the nav badge
 *     and the Issues list page — one cache entry, one invalidation point.
 *   - Zero open reports renders an EXPLICIT empty state ("No open issue
 *     reports"), never a blank region (AC-074-4).
 *   - Shows at most ISSUE_CARD_LIMIT titles even when open_count is larger.
 * Side-effect class: IO (fetch via TanStack Query)
 * Source: SPEC-074 §Scope, AC-074-4
 */

import { useIssueReportsQuery } from "@/lib/issue-reports-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

const ISSUE_CARD_LIMIT = 3;

export interface IssueReportsCardProps {
  /** Called when the card (or a listed title) is clicked, navigating to the Issues page. */
  onNavigate?: () => void;
}

/**
 * @example
 * <IssueReportsCard onNavigate={() => navigate({ to: '/issues' })} />
 */
export function IssueReportsCard({ onNavigate }: IssueReportsCardProps): React.ReactElement {
  const { data, isLoading, error } = useIssueReportsQuery();

  return (
    <section className="rounded-lg border p-4 space-y-3" aria-label="Incoming issue reports">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Incoming Issues</h3>
        <a href="/issues" className="text-xs text-primary hover:underline">
          See all →
        </a>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-6 rounded" />
          ))}
        </div>
      )}

      {error !== null && !isLoading && (
        <p className="text-sm text-destructive">Failed to load issue reports.</p>
      )}

      {data !== undefined && data.open_count === 0 && (
        <p className="text-sm text-muted-foreground">No open issue reports.</p>
      )}

      {data !== undefined && data.open_count > 0 && (
        <div className="space-y-2">
          <Badge variant="outline" className="text-xs" aria-label={`${data.open_count} open issue reports`}>
            {data.open_count} open
          </Badge>
          <ul className="space-y-1.5">
            {data.rows.slice(0, ISSUE_CARD_LIMIT).map((row) => (
              <li key={row.id} className="text-sm">
                <button
                  type="button"
                  className="text-left text-primary hover:underline truncate block w-full"
                  onClick={() => onNavigate?.()}
                >
                  {row.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
