/**
 * PendingPanel — home-page side panel showing the top pending-review documents
 * with their latest AI judgment badge (SPEC-033 §2.2 side panels).
 * Purpose: gives the dashboard home page an at-a-glance triage summary without
 *   duplicating F3's full triage queue page (escalated-only filter, blocking
 *   questions, adjudicate buttons) — this panel is read-only and capped.
 * Public surface: PendingPanel, PendingPanelProps
 * Invariants:
 *   - Shows at most PENDING_PANEL_LIMIT docs, in the order `GET /api/review/pending`
 *     returns them (no independent client-side sort — same queue order as `lore pending`).
 *   - Per-doc judgment fetches run in parallel (`Promise.all`), bounded by
 *     PENDING_PANEL_LIMIT so this never becomes an unbounded fan-out.
 *   - Empty queue and fetch-error both render a labeled state, never a blank panel.
 *   - "See all" links to `/pending` via a plain `<a>`, not a typed router `Link` —
 *     that route is owned by a parallel task (F3) and doesn't exist in this
 *     worktree's generated route tree; a typed `Link to="/pending"` would fail
 *     typecheck here. A plain anchor works as normal same-origin navigation once
 *     F3's route lands (SPA history-fallback already serves index.html for
 *     unknown client paths).
 *   - Each row's type badge + `formatTypeMetaLabel` meta badge (SPEC-036 §2 D3
 *     pending-queue extension) sit in a `min-w-0` flex group ahead of the title
 *     button, mirroring `TriageQueue`'s row layout, so the title's `truncate`
 *     still has room to shrink instead of being pushed off by the badges.
 * Side-effect class: IO (fetch via TanStack Query)
 * Source: SPEC-033 §2.2
 */

import { useQuery } from "@tanstack/react-query";
import { apiGetPendingReview, apiGetJudgments } from "@/lib/api";
import type { PendingDocRow } from "@/lib/api";
import type { ReviewJudgment } from "@lore/core";
import { JudgmentBadge } from "@/components/judgment-badge";
import { formatTypeMetaLabel, metaBadgeVariant } from "@/lib/type-meta-label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { queryKeys } from "@/lib/project-api";

const PENDING_PANEL_LIMIT = 8;

export interface PendingPanelProps {
  /** Active project, or `null`/absent for registry-less mode (SPEC-078 T10). */
  project?: string | null;
  /** Called when a listed document is clicked. */
  onNavigate?: (docId: string) => void;
}

interface PendingRow {
  doc: PendingDocRow;
  judgment: ReviewJudgment | null;
}

async function fetchPendingWithJudgments(project: string | null): Promise<PendingRow[]> {
  const docs = (await apiGetPendingReview(project)).slice(0, PENDING_PANEL_LIMIT);
  const judgments = await Promise.all(docs.map((doc) => apiGetJudgments(project, doc.id)));
  return docs.map((doc, index) => ({ doc, judgment: judgments[index]?.latest ?? null }));
}

/**
 * @example
 * <PendingPanel onNavigate={(id) => navigate({ to: '/docs/$id', params: { id } })} />
 */
export function PendingPanel({ project = null, onNavigate }: PendingPanelProps): React.ReactElement {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.scope(project, ["home", "pending-panel"]),
    queryFn: () => fetchPendingWithJudgments(project),
  });

  return (
    <section className="rounded-lg border p-4 space-y-3" aria-label="Pending review">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Pending Review</h3>
        <a href="/pending" className="text-xs text-primary hover:underline">
          See all →
        </a>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-6 rounded" />
          ))}
        </div>
      )}

      {error !== null && !isLoading && (
        <p className="text-sm text-destructive">Failed to load pending documents.</p>
      )}

      {data !== undefined && data.length === 0 && (
        <p className="text-sm text-muted-foreground">No documents pending review.</p>
      )}

      {data !== undefined && data.length > 0 && (
        <ul className="space-y-2">
          {data.map(({ doc, judgment }) => {
            const metaLabel = doc.meta !== undefined ? formatTypeMetaLabel(doc.meta) : null;
            return (
              <li key={doc.id} className="flex items-center justify-between gap-2 text-sm">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Badge variant="outline" className="text-xs shrink-0">
                    {doc.type}
                  </Badge>
                  {metaLabel !== null && (
                    <Badge
                      variant={doc.meta !== undefined ? metaBadgeVariant(doc.meta) : "outline"}
                      className="text-xs shrink-0"
                    >
                      {metaLabel}
                    </Badge>
                  )}
                  <button
                    type="button"
                    className="text-left text-primary hover:underline truncate"
                    onClick={() => onNavigate?.(doc.id)}
                  >
                    {doc.title}
                  </button>
                </div>
                <JudgmentBadge judgment={judgment} docVersion={doc.version} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
