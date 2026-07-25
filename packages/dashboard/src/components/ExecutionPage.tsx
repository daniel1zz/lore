/**
 * ExecutionPage — SPEC-077 S1 `/execution` page body: plan selector plus the
 * four SPEC-077 S2 read-only panels (PRD §21 F3).
 * Purpose: the dashboard's first reachable view onto execution state that
 *   previously required the CLI — ready/blocked tasks with claim TTL
 *   countdown, derived sessions, anchor conflicts, and phase progress
 *   scorecards, for a selected plan. Per-task evidence timelines are reached
 *   by clicking a row (zero-step navigation into the existing SPEC-075
 *   Evidence tab on `/docs/$id` — no duplicate timeline component here).
 * Public surface: ExecutionPage, ExecutionPageProps
 * Invariants:
 *   - Owns ALL data fetching for this page (`ExecutionPage` itself, not the
 *     four panels — those are pure-props, `packages/dashboard/CLAUDE.md`'s
 *     "component primitives" convention). Two suspense-shaped queries per
 *     plan selection (`GET /api/ready/:plan`, `GET /api/phase-status/:plan`),
 *     no polling — matches SPEC-077's cross-cutting Performance note.
 *   - Router-agnostic: takes `planParam`/`onPlanChange`/`onNavigateToDoc` as
 *     props rather than importing `@tanstack/react-router` hooks directly —
 *     mirrors `DocDetail`'s `onNavigate`/`onHome` optional-callback
 *     convention, so this component is directly component-testable without a
 *     real Router tree. `routes/execution.tsx` is the thin router-aware
 *     wrapper that supplies these from `Route.useSearch()`/`useNavigate()`.
 *   - Plan selection SYNCS to the caller's `?plan` search param (AC-077-1):
 *     changing the dropdown calls `onPlanChange(planId)`; this component
 *     never holds the selection in local `useState` (the URL is the SSOT,
 *     `packages/dashboard/CLAUDE.md`'s "all client state is server state +
 *     URL state" invariant). When `planParam` is absent, the EFFECTIVE plan
 *     falls back to the most-recently-active plan (`apiList`'s default
 *     `findMany` ordering, the SAME convention `ActivePlansPanel` relies on)
 *     WITHOUT pushing that default into the URL itself — a plain fallback
 *     render, not an auto-navigate side effect.
 *   - Uses `apiGetReadyReport` (SPEC-077's corrected ready-route client),
 *     never the pre-existing `apiGetReady` — see that function's doc comment
 *     in `lib/api.ts` for why.
 * Side-effect class: IO (fetch via TanStack Query)
 * Source: SPEC-077 §Scope S1/S2, AC-077-1
 *
 * @example
 * <ExecutionPage
 *   planParam={search.plan}
 *   onPlanChange={(id) => navigate({ search: (prev) => ({ ...prev, plan: id }) })}
 *   onNavigateToDoc={(id) => navigate({ to: "/docs/$id", params: { id } })}
 * />
 */

import { useQuery } from "@tanstack/react-query";
import { apiList, apiGetReadyReport, apiGetPhaseStatus } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { ReadyTaskList } from "@/components/ReadyTaskList";
import { SessionsPanel } from "@/components/SessionsPanel";
import { AnchorConflictsPanel } from "@/components/AnchorConflictsPanel";
import { PhaseProgressPanel } from "@/components/PhaseProgressPanel";

export interface ExecutionPageProps {
  /** The current `?plan` search-param value, or `undefined` when absent from the URL. */
  planParam?: string;
  /** Called with the newly-selected plan's doc id when the user changes the plan selector. */
  onPlanChange: (planId: string) => void;
  /** Called with a task's doc id when a `ReadyTaskList` row is clicked. */
  onNavigateToDoc: (docId: string) => void;
}

/**
 * @example
 * <ExecutionPage planParam={undefined} onPlanChange={() => {}} onNavigateToDoc={() => {}} />
 */
export function ExecutionPage({ planParam, onPlanChange, onNavigateToDoc }: ExecutionPageProps): React.ReactElement {
  const {
    data: plansData,
    isLoading: plansLoading,
    error: plansError,
  } = useQuery({
    queryKey: ["execution", "active-plans"],
    queryFn: () => apiList({ type: "plan", status: "active" }),
  });

  const plans = plansData?.docs ?? [];
  // reason: falls back to the most-recently-active plan (apiList's default
  // ordering) when the URL carries no ?plan param — a rendering fallback, not
  // an auto-navigate; see module header invariant.
  const effectivePlan = planParam ?? plans[0]?.id;

  const { data: readyResult, isLoading: readyLoading } = useQuery({
    queryKey: ["execution", "ready", effectivePlan],
    queryFn: () => apiGetReadyReport(effectivePlan as string),
    enabled: effectivePlan !== undefined,
  });

  const {
    data: phaseStatus,
    isLoading: phaseLoading,
    error: phaseError,
  } = useQuery({
    queryKey: ["execution", "phase-status", effectivePlan],
    queryFn: () => apiGetPhaseStatus(effectivePlan as string),
    enabled: effectivePlan !== undefined,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <label htmlFor="execution-plan-select" className="text-sm font-medium">
          Plan
        </label>
        {plansLoading && <Skeleton className="h-8 w-48 rounded" />}
        {plansError !== null && !plansLoading && (
          <p className="text-sm text-destructive">Failed to load active plans.</p>
        )}
        {!plansLoading && plansError === null && plans.length === 0 && (
          <p className="text-sm text-muted-foreground">No active plans.</p>
        )}
        {!plansLoading && plans.length > 0 && (
          <select
            id="execution-plan-select"
            className="border rounded px-2 py-1 text-sm bg-background"
            value={effectivePlan ?? ""}
            onChange={(e) => onPlanChange(e.target.value)}
            aria-label="Plan"
          >
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.title}
              </option>
            ))}
          </select>
        )}
      </div>

      {effectivePlan !== undefined && (
        <>
          <section aria-label="Ready tasks section" className="space-y-2">
            <h3 className="text-sm font-semibold">Ready Tasks</h3>
            {readyLoading && <Skeleton className="h-20 rounded" />}
            {!readyLoading && readyResult !== undefined && readyResult.ok && (
              <ReadyTaskList
                records={readyResult.value.records}
                claimTtlMinutes={readyResult.value.claim_ttl_minutes}
                onTaskClick={onNavigateToDoc}
              />
            )}
            {!readyLoading && readyResult !== undefined && !readyResult.ok && (
              <p className="text-sm text-destructive">Failed to load readiness.</p>
            )}
          </section>

          <section aria-label="Sessions section" className="space-y-2">
            <h3 className="text-sm font-semibold">Sessions</h3>
            {readyLoading && <Skeleton className="h-12 rounded" />}
            {!readyLoading && readyResult !== undefined && readyResult.ok && (
              <SessionsPanel sessions={readyResult.value.sessions} />
            )}
            {!readyLoading && readyResult !== undefined && !readyResult.ok && (
              <p className="text-sm text-destructive">Failed to load sessions.</p>
            )}
          </section>

          <section aria-label="Anchor conflicts section" className="space-y-2">
            <h3 className="text-sm font-semibold">Anchor Conflicts</h3>
            {readyLoading && <Skeleton className="h-12 rounded" />}
            {!readyLoading && readyResult !== undefined && readyResult.ok && (
              <AnchorConflictsPanel conflicts={readyResult.value.anchor_conflicts} />
            )}
            {!readyLoading && readyResult !== undefined && !readyResult.ok && (
              <p className="text-sm text-destructive">Failed to load anchor conflicts.</p>
            )}
          </section>

          <section aria-label="Phase progress section" className="space-y-2">
            <h3 className="text-sm font-semibold">Phase Progress</h3>
            {phaseLoading && <Skeleton className="h-20 rounded" />}
            {phaseError !== null && !phaseLoading && (
              <p className="text-sm text-destructive">Failed to load phase status.</p>
            )}
            {!phaseLoading && phaseError === null && phaseStatus !== undefined && (
              <PhaseProgressPanel phases={phaseStatus.phases} />
            )}
          </section>
        </>
      )}
    </div>
  );
}
