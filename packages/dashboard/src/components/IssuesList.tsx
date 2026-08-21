/**
 * IssuesList — full Issues triage list page body (SPEC-074 AC-074-1;
 * D8 resolution rendering, spec-issue-closure-loop-computed-resolution-agent-reachable).
 * Purpose: renders every still-governed incoming issue report
 *   (`GET /api/issue-reports`) as a row showing title / reporter_project /
 *   reported_at / possible_duplicates count / computed resolution, newest
 *   first (server order — no independent client-side re-sort), linking to
 *   its detail view (`/issues/$id`).
 * Public surface: IssuesList, IssuesListProps, resolutionBadgeVariant
 * Invariants:
 *   - Uses the SAME shared query (`useIssueReportsQuery`) the nav badge and
 *     home card read — one cache entry, one invalidation point.
 *   - Empty queue renders a labeled empty state, never a blank page.
 *   - Fetch error renders a labeled error state, never a silent blank page.
 *   - Every row renders its OWN `resolution` badge (D8) — never the raw
 *     `status` field as a stand-in for resolution (that proxy-status failure
 *     is exactly what D2's computed resolution replaces). A row can render
 *     `status: "draft"` next to `resolution: "fixed"` (an unclosed
 *     escalation, D5(a)) — both are shown, never collapsed into one.
 * Side-effect class: IO (fetch via TanStack Query)
 * Source: SPEC-074 §Scope, AC-074-1; spec-issue-closure-loop-computed-resolution-agent-reachable §D8, AC-ICL-9
 */

import { useIssueReportsQuery } from "@/lib/issue-reports-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { IssueResolution } from "@/lib/api";

export interface IssuesListProps {
  /** Called when a listed report's title is clicked. */
  onNavigate?: (reportId: string) => void;
}

/**
 * Presentation-only resolution -> Badge variant mapping (D8). Deliberately a
 * small local function, not a shared module — exactly two consumers today
 * (this file, `IssueDetail.tsx`); per this codebase's "wait for the rule of
 * three" convention (`lore-ai-native-coding` skill, ai-anti-patterns.md
 * "Premature Abstraction"), a shared helper is not worth extracting yet.
 * Exported only so `packages/dashboard/tests/unit/
 * issue-resolution-union-parity.test.ts` (AC-DC-12) can drive it directly for
 * every member of the vocabulary — rendering the whole component to observe one
 * pure mapping would be a far weaker oracle.
 *
 * TONE GROUPS — nine resolution states, four Badge variants
 * (`ui/badge.tsx`'s cva table), so the variant carries TONE and the badge's own
 * text carries identity:
 *   - `outline`     — still needs triage eyes (`open`)
 *   - `secondary`   — neutral: a fix in flight (`resolving`) or an owner
 *                     assigned but undecided (`adopted`, §M7), or terminal
 *                     with NO judgement against the report (`superseded`,
 *                     `duplicate`, `closed`)
 *   - `default`     — the report produced a fix (`fixed`)
 *   - `destructive` — a judgement AGAINST the report (`rejected`, `wontfix`)
 *
 * ⛔ `superseded`/`duplicate` MUST NOT be `destructive`: they are the two
 * NON-DEROGATORY terminal states (spec-the-defect-channel-cannot-be-honestly-
 * maintained-an §M3), and rendering them in the derogatory bucket reproduces the
 * "silent trash can operationally indistinguishable from rejected" failure §M3
 * exists to fix. They must also not share `fixed`'s bucket — that WAS the
 * pre-2026-08-11 defect. Both constraints are pinned by the AC-DC-12 oracle.
 * `adopted` (§M7) shares `resolving`'s bucket rather than a bucket of its own:
 * both are non-derogatory AND UNDECIDED (as opposed to `superseded`/
 * `duplicate`/`closed`, which are non-derogatory but FINAL) — `adopted` MUST
 * NOT be `destructive` (it is not a judgement against the report) and MUST NOT
 * be `default` (nothing has been fixed yet).
 *
 * ⛔ EXHAUSTIVE via the `never` binding after the switch, with NO `default:`
 * clause. A `default` would absorb a state added to `IssueResolution` and render
 * a plausible-but-wrong badge; the `never` binding makes that same addition a
 * COMPILE error here. Before this check existed the switch fell off its end and
 * returned `undefined` in defiance of this signature, which CVA's
 * `defaultVariants.variant: "default"` then rendered as `fixed` styling.
 */
export function resolutionBadgeVariant(resolution: IssueResolution): NonNullable<BadgeProps["variant"]> {
  switch (resolution) {
    case "open":
      return "outline";
    case "resolving":
    case "adopted":
      return "secondary";
    case "fixed":
      return "default";
    case "rejected":
    case "wontfix":
      return "destructive";
    case "superseded":
    case "duplicate":
    case "closed":
      return "secondary";
  }
  const unhandledResolution: never = resolution;
  throw new Error(`unhandled issue resolution: ${String(unhandledResolution)}`);
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
                <div className="flex items-center gap-1.5 shrink-0">
                  <Badge
                    data-testid="issue-report-resolution"
                    variant={resolutionBadgeVariant(row.resolution)}
                    className="text-xs"
                  >
                    {row.resolution}
                  </Badge>
                  {row.possible_duplicates.length > 0 && (
                    <Badge variant="secondary" className="text-xs shrink-0">
                      {row.possible_duplicates.length} possible duplicate
                      {row.possible_duplicates.length === 1 ? "" : "s"}
                    </Badge>
                  )}
                </div>
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
