/**
 * PendingPanel — home-page side panel showing the top pending-review documents
 * with their latest AI judgment badge (SPEC-033 §2.2 side panels).
 * Purpose: gives the dashboard home page an at-a-glance triage summary without
 *   duplicating F3's full triage queue page (escalated-only filter, blocking
 *   questions, adjudicate buttons) — this panel is read-only and capped.
 * Public surface: PendingPanel, PendingPanelProps
 * Invariants:
 *   - Rows come from {@link fetchReviewQueueRows} — `draft` AND `in-review`
 *     docs, `in-review` sorted ahead of `draft` (ADR
 *     adr-dashboard-review-queues-include-in-review-docs-ahead-of, dogfood
 *     ISSUE-008). Shows at most PENDING_PANEL_LIMIT rows of that merged,
 *     already-ordered list — no independent client-side re-sort on top.
 *   - Every row renders a read-only `StatusPill` (no `onTransition`) so the
 *     two included statuses are visually distinguishable — the SAME status
 *     color-coding `DocDetail`'s header uses, not a bespoke badge.
 *   - Per-doc judgment fetches run in parallel (`Promise.all`), bounded by
 *     PENDING_PANEL_LIMIT so this never becomes an unbounded fan-out.
 *   - Empty queue and fetch-error both render a labeled state, never a blank panel.
 *   - "See all" links to `/pending` via a plain `<a>`, not a typed router `Link` —
 *     that route is owned by a parallel task (F3) and doesn't exist in this
 *     worktree's generated route tree; a typed `Link to="/pending"` would fail
 *     typecheck here. A plain anchor works as normal same-origin navigation once
 *     F3's route lands (SPA history-fallback already serves index.html for
 *     unknown client paths).
 *   - Row layout gives the TITLE a GUARANTEED minimum share via `min-w-[10ch]`
 *     (not `min-w-0`) — the type badge is `shrink-0` (short, fixed-shape
 *     content), the meta badge (SPEC-036 §2 D3 pending-queue extension, e.g.
 *     a long `claimed:agent:<worker>` string) shrinks/truncates on its own
 *     (capped at 25% of the row, the flex item that absorbs overflow), and
 *     the judgment badge renders ONLY when `judgment !== null` — see below.
 *     Every text-bearing element also gets a `title` attribute carrying its
 *     untruncated value.
 *     Round 1 (ISSUE-001) fixed the visual OVERLAP (title got `flex-1
 *     min-w-0 truncate`) but not a second regression caught in post-merge
 *     browser verification: `flex: 1 1 0%`'s 0% BASIS means title
 *     contributes ZERO width to the flexbox shrink-weighting pool, so under
 *     genuine overflow (the ~320px home-page aside minus padding/gaps/
 *     sibling-badge widths routinely leaves <150px for 3-4 flex siblings)
 *     title shrank to 1-2 characters while the OTHER (nonzero-basis) items
 *     kept their natural size — the opposite of "title is the primary
 *     identifier". `min-w-[10ch]` is an actual CSS `min-width`, a hard floor
 *     the shrink algorithm cannot cross regardless of basis/weighting; the
 *     meta badge (still `min-w-0` + `shrink` + `truncate`) is the one flex
 *     sibling that absorbs remaining overflow, same as before, just with a
 *     lower cap so it yields more room up front.
 *   - The judgment badge is OMITTED (not just visually de-emphasized) when
 *     `judgment === null` — "unreviewed" is EVERY row's default state before
 *     a human/AI judgment exists (verified against the seeded corpus: every
 *     row in the pre-fix screenshot read "unreviewed"), so rendering it
 *     unconditionally was pure width-eating noise that conveyed no
 *     differentiating information while directly stealing the title's
 *     share. A real judgment (`approve`/`reject`/`escalate`) DOES
 *     differentiate rows and still renders.
 * Side-effect class: IO (fetch via TanStack Query)
 * Source: SPEC-033 §2.2
 */

import { useQuery } from "@tanstack/react-query";
import { apiGetJudgments } from "@/lib/api";
import { fetchReviewQueueRows } from "@/lib/review-queue";
import type { ReviewQueueDocRow } from "@/lib/review-queue";
import type { ReviewJudgment } from "@lore/core";
import { JudgmentBadge } from "@/components/judgment-badge";
import { formatTypeMetaLabel, metaBadgeVariant } from "@/lib/type-meta-label";
import { StatusPill } from "@/components/StatusPill";
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
  doc: ReviewQueueDocRow;
  judgment: ReviewJudgment | null;
}

async function fetchPendingWithJudgments(project: string | null): Promise<PendingRow[]> {
  const docs = (await fetchReviewQueueRows(project)).slice(0, PENDING_PANEL_LIMIT);
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
              <li key={doc.id} className="flex items-center gap-2 text-sm">
                <Badge variant="outline" className="text-xs shrink-0">
                  {doc.type}
                </Badge>
                <span className="shrink-0">
                  <StatusPill status={doc.status} />
                </span>
                <button
                  type="button"
                  className="min-w-[10ch] flex-1 truncate text-left text-primary hover:underline"
                  onClick={() => onNavigate?.(doc.id)}
                  title={doc.title}
                >
                  {doc.title}
                </button>
                {metaLabel !== null && (
                  <Badge
                    variant={doc.meta !== undefined ? metaBadgeVariant(doc.meta) : "outline"}
                    className="min-w-0 max-w-[25%] shrink truncate text-xs"
                    title={metaLabel}
                  >
                    {metaLabel}
                  </Badge>
                )}
                {judgment !== null && (
                  <span className="shrink-0">
                    <JudgmentBadge judgment={judgment} docVersion={doc.version} />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
