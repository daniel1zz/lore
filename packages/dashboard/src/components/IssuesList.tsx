/**
 * IssuesList — the Issues page body: one row per issue GitHub currently lists, with its DERIVED
 * status and the work that carries it (spec-github-owns-issue-report-state-no-mirror-task-work-carries
 * D4/D5, AC-GS-14).
 * Purpose: renders `GET /api/issue-reports` (the live join) as rows of `#number`, title, derived
 *   status badge and carrier slug, in the server's listing order, each linking to `/issues/$number`.
 * Public surface: IssuesList, IssuesListProps, resolutionBadgeVariant
 * Invariants:
 *   - Uses the SAME shared query (`useIssueReportsQuery`) the nav badge and home card read.
 *   - Empty listing renders a labeled empty state, never a blank page.
 *   - A refused listing is an error state, never an empty list: 401 shows the `gh auth login` hint
 *     and renders NO list items (AC-GS-14); 429/503 say to wait; anything else shows the message.
 *   - The badge shows the row's derived `status`. The component stores and computes nothing.
 * Side-effect class: IO (fetch via TanStack Query)
 * Source: spec-github-owns-issue-report-state-no-mirror-task-work-carries T9; spec-074 AC-074-1 (superseded read model)
 */

import { useIssueReportsQuery } from "@/lib/issue-reports-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { ApiError, type IssueResolution, type IssueStatus } from "@/lib/api";

export interface IssuesListProps {
  /** Called with the issue number (as a string route param) when a listed issue is clicked. */
  onNavigate?: (issueNumber: string) => void;
}

/**
 * The list's error state. A refused GitHub listing is shown as what it is — never as an empty list:
 * 401 carries the `gh auth login` hint, 429 and 503 say to wait, anything else shows the message.
 */
function IssuesLoadError({ error }: { error: unknown }): React.ReactElement {
  if (error instanceof ApiError && error.status === 401) {
    return (
      <div role="alert" data-testid="issues-auth-required" className="text-sm space-y-1">
        <p className="text-destructive">GitHub is not authenticated, so the issue listing cannot be read.</p>
        <p className="text-muted-foreground">
          Run <code className="font-mono">gh auth login</code> on the machine running lore, then reload.
        </p>
      </div>
    );
  }
  if (error instanceof ApiError && error.status === 429) {
    return (
      <p role="alert" className="text-sm text-destructive">
        GitHub rate limit reached. The list will refresh when the limit resets.
      </p>
    );
  }
  if (error instanceof ApiError && error.status === 503) {
    return (
      <p role="alert" className="text-sm text-destructive">
        GitHub could not be reached. The list will refresh when the connection returns.
      </p>
    );
  }
  const detail = error instanceof ApiError ? error.message : "unknown error";
  return (
    <p role="alert" className="text-sm text-destructive">
      Failed to load issues: {detail}
    </p>
  );
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
export function resolutionBadgeVariant(resolution: IssueResolution | IssueStatus): NonNullable<BadgeProps["variant"]> {
  switch (resolution) {
    case "open":
    // reason: the four ANOMALY statuses name a place where GitHub and the corpus disagree or a verdict
    // is missing — each needs a person's eyes, so they share `open`'s tone (spec-github-owns-issue-
    // report-state-no-mirror-task-work-carries D4).
    case "fixed (close pending)":
    case "adopted (abandoned)":
    case "closed (unverified)":
    case "closed (no verdict)":
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
        {error === null && data !== undefined && (
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

      {error !== null && !isLoading && <IssuesLoadError error={error} />}

      {error === null && data !== undefined && data.rows.length === 0 && (
        <p className="text-sm text-muted-foreground">GitHub lists no issues.</p>
      )}

      {error === null && data !== undefined && data.rows.length > 0 && (
        <div className="space-y-2">
          {data.rows.map((row) => (
            <button
              key={row.number}
              type="button"
              data-testid="issue-report-row"
              onClick={() => onNavigate?.(String(row.number))}
              className="w-full text-left rounded-lg border p-3 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <span data-testid="issue-report-title" className="font-medium text-sm truncate">
                  {row.title}
                </span>
                <Badge
                  data-testid="issue-report-resolution"
                  variant={resolutionBadgeVariant(row.status)}
                  className="text-xs shrink-0"
                >
                  {row.status}
                </Badge>
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                <span>#{row.number}</span>
                <span aria-hidden="true">·</span>
                <span>{row.carrier === null ? "no work carries it" : `carried by ${row.carrier}`}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
