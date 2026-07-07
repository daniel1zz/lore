/**
 * ActivePlansPanel — home-page side panel listing active plans.
 * Purpose: SPEC-033 §2.2 calls for a "ready-task panel (`ready` data over
 *   active plans)". SPEC-037 D1 lands the `GET /api/ready/:planIdOrSlug` route
 *   this panel previously stood in for — each active plan row now fetches its
 *   own readiness record and renders "N ready / M tasks".
 * Public surface: ActivePlansPanel, ActivePlansPanelProps
 * Invariants:
 *   - Shows at most ACTIVE_PLANS_LIMIT plans, most-recently-updated first
 *     (server's default `findMany` ordering — no independent client sort).
 *   - Empty list and fetch-error both render a labeled state, never a blank panel.
 *   - Per-plan readiness is its OWN query (`["home","ready",planId]`), separate
 *     from the plans-list query — a single plan's readiness fetch failing
 *     degrades only that row (no counter + a small muted note), never blanks
 *     the whole panel. A plan with zero tasks renders muted "no tasks" text,
 *     never a fabricated "0 ready / 0 tasks".
 * Side-effect class: IO (fetch via TanStack Query)
 * Source: SPEC-033 §2.2; SPEC-037 §1 D1, AC-37-2
 */

import { useQuery } from "@tanstack/react-query";
import { apiGetReady, apiList } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";

const ACTIVE_PLANS_LIMIT = 8;

export interface ActivePlansPanelProps {
  /** Called when a listed plan is clicked. */
  onNavigate?: (docId: string) => void;
}

interface PlanReadinessSummaryProps {
  /** The plan document ID to fetch readiness for. */
  planId: string;
}

/**
 * Per-plan readiness counter — isolated in its own component so its own
 * TanStack Query instance (and thus its own loading/error state) never
 * affects sibling rows or the panel's plans-list query (AC-37-2).
 */
function PlanReadinessSummary({ planId }: PlanReadinessSummaryProps): React.ReactElement | null {
  const { data, isLoading } = useQuery({
    queryKey: ["home", "ready", planId],
    queryFn: () => apiGetReady(planId),
  });

  if (isLoading || data === undefined) {
    return null;
  }

  if (!data.ok) {
    return <span className="text-xs text-muted-foreground">readiness unavailable</span>;
  }

  const records = data.value;
  if (records.length === 0) {
    return <span className="text-xs text-muted-foreground">no tasks</span>;
  }

  const readyCount = records.filter((record) => record.ready).length;
  return (
    <span className="text-xs text-muted-foreground shrink-0">
      {readyCount} ready / {records.length} tasks
    </span>
  );
}

/**
 * @example
 * <ActivePlansPanel onNavigate={(id) => navigate({ to: '/docs/$id', params: { id } })} />
 */
export function ActivePlansPanel({ onNavigate }: ActivePlansPanelProps): React.ReactElement {
  const { data, isLoading, error } = useQuery({
    queryKey: ["home", "active-plans"],
    queryFn: () => apiList({ type: "plan", status: "active" }),
  });

  const plans = data?.docs.slice(0, ACTIVE_PLANS_LIMIT) ?? [];

  return (
    <section className="rounded-lg border p-4 space-y-3" aria-label="Active plans">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Active Plans</h3>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-6 rounded" />
          ))}
        </div>
      )}

      {error !== null && !isLoading && (
        <p className="text-sm text-destructive">Failed to load active plans.</p>
      )}

      {data !== undefined && plans.length === 0 && (
        <p className="text-sm text-muted-foreground">No active plans.</p>
      )}

      {data !== undefined && plans.length > 0 && (
        <ul className="space-y-1.5">
          {plans.map((plan) => (
            <li key={plan.id} className="text-sm flex items-center justify-between gap-2">
              <button
                type="button"
                className="text-left text-primary hover:underline truncate"
                onClick={() => onNavigate?.(plan.id)}
              >
                {plan.title}
              </button>
              <PlanReadinessSummary planId={plan.id} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
