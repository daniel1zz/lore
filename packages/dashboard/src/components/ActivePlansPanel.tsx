/**
 * ActivePlansPanel — home-page side panel listing active plans.
 * Purpose: SPEC-033 §2.2 calls for a "ready-task panel (`ready` data over
 *   active plans)", but no HTTP `/api/ready` route exists yet — `lore ready`
 *   is CLI/MCP-only (SPEC-025), scoped per-plan, and SPEC-033 §3 requires new
 *   routes to land in the SAME task as their API client; no such task is
 *   scheduled for this one. This panel shows active plans instead, via the
 *   existing `GET /api/docs?type=plan&status=active` route, as the closest
 *   available "what's in flight" signal until a ready HTTP route exists.
 * Public surface: ActivePlansPanel, ActivePlansPanelProps
 * Invariants:
 *   - Shows at most ACTIVE_PLANS_LIMIT plans, most-recently-updated first
 *     (server's default `findMany` ordering — no independent client sort).
 *   - Empty list and fetch-error both render a labeled state, never a blank panel.
 * Side-effect class: IO (fetch via TanStack Query)
 * Source: SPEC-033 §2.2 (partial — ready-task data deferred, see note above)
 */

import { useQuery } from "@tanstack/react-query";
import { apiList } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

const ACTIVE_PLANS_LIMIT = 8;

export interface ActivePlansPanelProps {
  /** Called when a listed plan is clicked. */
  onNavigate?: (docId: string) => void;
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
        <Badge variant="outline" className="text-xs" title="No /api/ready route yet — showing active plans instead">
          not ready-aware
        </Badge>
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
            <li key={plan.id} className="text-sm">
              <button
                type="button"
                className="text-left text-primary hover:underline truncate"
                onClick={() => onNavigate?.(plan.id)}
              >
                {plan.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
