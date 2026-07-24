/**
 * IssuesList — full Issues triage list page body (SPEC-074 AC-074-1).
 * Purpose: renders every open incoming issue report (`GET /api/issue-reports`)
 *   as a row showing title / reporter_project / reported_at / possible_duplicates
 *   count, newest first (server order — no independent client-side re-sort),
 *   linking to its detail view (`/issues/$id`).
 * Public surface: IssuesList, IssuesListProps
 * Invariants:
 *   - Uses the SAME shared query (`useIssueReportsQuery`) the nav badge and
 *     home card read — one cache entry, one invalidation point.
 *   - Empty queue renders a labeled empty state, never a blank page.
 *   - Fetch error renders a labeled error state, never a silent blank page.
 * Side-effect class: IO (fetch via TanStack Query)
 * Source: SPEC-074 §Scope, AC-074-1
 */

import { useIssueReportsQuery } from "@/lib/issue-reports-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export interface IssuesListProps {
  /** Called when a listed report's title is clicked. */
  onNavigate?: (reportId: string) => void;
}

/**
 * @example
 * <IssuesList onNavigate={(id) => navigate({ to: '/issues/$id', params: { id } })} />
 */
export function IssuesList({ onNavigate }: IssuesListProps): React.ReactElement {
  const { data, isLoading, error } = useIssueReportsQuery();

  return (
    <section aria-label="Issues" className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Issues</h1>
        {data !== undefined && (
          <Badge variant="outline" className="text-xs">
            {data.open_count} open
          </Badge>
        )}
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded" />
          ))}
        </div>
      )}

      {error !== null && !isLoading && (
        <p className="text-sm text-destructive">Failed to load issue reports.</p>
      )}

      {data !== undefined && data.rows.length === 0 && (
        <p className="text-sm text-muted-foreground">No open issue reports.</p>
      )}

      {data !== undefined && data.rows.length > 0 && (
        <div className="space-y-2">
          {data.rows.map((row) => (
            <button
              key={row.id}
              type="button"
              data-testid="issue-report-row"
              onClick={() => onNavigate?.(row.id)}
              className="w-full text-left rounded-lg border p-3 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <span data-testid="issue-report-title" className="font-medium text-sm truncate">
                  {row.title}
                </span>
                {row.possible_duplicates.length > 0 && (
                  <Badge variant="secondary" className="text-xs shrink-0">
                    {row.possible_duplicates.length} possible duplicate
                    {row.possible_duplicates.length === 1 ? "" : "s"}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                <span>{row.reporter_project.length > 0 ? row.reporter_project : "unknown project"}</span>
                <span aria-hidden="true">·</span>
                <time dateTime={row.reported_at} title={row.reported_at}>
                  {row.reported_at.length > 0 ? row.reported_at : "unknown time"}
                </time>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
