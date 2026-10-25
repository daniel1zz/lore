/**
 * IssueDetail — one listed GitHub issue: its derived status and the corpus work that carries it
 * (spec-github-owns-issue-report-state-no-mirror-task-work-carries D4/D5, AC-GS-14).
 * Purpose: shows `#number`, title, GitHub's state, the derived status badge and links to each
 *   carrier document. There is nothing to adjudicate here: the issue is GitHub's, and the corpus
 *   keeps no report document to approve or reject.
 * Public surface: IssueDetail, IssueDetailProps, resolutionBadgeVariant
 * Invariants:
 *   - Reads the SAME `GET /api/issue-reports` live join the list and nav badge read, queried with a
 *     DIRECT `useQuery` on `issueReportsQueryKey(project)` so it stays scoped to its explicit
 *     `project` prop (the shared hook derives the project from router state).
 *   - The issue is matched by number. One absent from the listing renders "not found", never a
 *     guessed status.
 *   - A refused listing (401 and the rest) renders a labeled error, never "not found".
 *   - Carrier links go to `/docs/$slug` through `projectPath`, so a project-scoped page stays scoped.
 * Side-effect class: IO (fetch via TanStack Query)
 * Source: spec-github-owns-issue-report-state-no-mirror-task-work-carries T9 (replaces the SPEC-074
 *   adjudication detail, whose subject, a mirror task, no longer exists)
 */

import { useQuery } from "@tanstack/react-query";
import { ApiError, apiGetIssueReports, type IssueResolution, type IssueStatus } from "@/lib/api";
import { issueReportsQueryKey } from "@/lib/issue-reports-query";
import { projectPath } from "@/lib/project-api";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge, type BadgeProps } from "@/components/ui/badge";

/**
 * Presentation-only status -> Badge variant mapping — same mapping as `IssuesList.tsx`'s own local
 * copy, duplicated rather than shared per this codebase's "wait for the rule of three" convention
 * (exactly two consumers). The AC-DC-12 oracle asserts the two copies agree member-for-member, so the
 * duplication cannot drift; see `IssuesList.tsx`'s copy for the full TONE-GROUP rationale.
 *
 * ⛔ EXHAUSTIVE via the `never` binding after the switch, with NO `default:` clause — a `default`
 * would absorb a state added to the vocabulary and render a plausible-but-wrong badge instead of
 * failing to compile.
 */
export function resolutionBadgeVariant(resolution: IssueResolution | IssueStatus): NonNullable<BadgeProps["variant"]> {
  switch (resolution) {
    case "open":
    // reason: the four ANOMALY statuses need a person's eyes, so they share `open`'s tone.
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

export interface IssueDetailProps {
  /** The GitHub issue number, as the route param string. */
  issueNumber: string;
  /** Active project, or `null`/absent for registry-less mode (SPEC-078 T10). */
  project?: string | null;
}

/**
 * @example
 * <IssueDetail issueNumber={id} project={name} />
 */
export function IssueDetail({ issueNumber, project = null }: IssueDetailProps): React.ReactElement {
  const { data, isLoading, error } = useQuery({
    queryKey: issueReportsQueryKey(project),
    queryFn: () => apiGetIssueReports(project),
  });

  if (isLoading) {
    return (
      <div className="max-w-3xl space-y-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
      </div>
    );
  }

  if (error !== null) {
    const authRequired = error instanceof ApiError && error.status === 401;
    return (
      <div role="alert" className="max-w-3xl rounded-md border border-destructive/50 p-6">
        <h2 className="font-semibold text-destructive mb-2">Could not load the issue listing</h2>
        <p className="text-sm text-muted-foreground">
          {authRequired ? (
            <>
              GitHub is not authenticated. Run <code className="font-mono">gh auth login</code>, then reload.
            </>
          ) : (
            error.message
          )}
        </p>
      </div>
    );
  }

  const row = data?.rows.find((candidate) => String(candidate.number) === issueNumber);
  if (row === undefined) {
    return (
      <div className="max-w-3xl">
        <div className="rounded-md border border-destructive/50 p-6">
          <h2 className="font-semibold text-destructive mb-2">Issue not found</h2>
          <p className="text-sm text-muted-foreground">
            GitHub does not list issue <code className="font-mono">#{issueNumber}</code>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <section aria-label="Issue detail" className="max-w-3xl space-y-6">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">{row.title}</h1>
          <Badge data-testid="issue-report-resolution" variant={resolutionBadgeVariant(row.status)} className="text-xs">
            {row.status}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          #{row.number} · GitHub state: {row.state}
        </p>
      </header>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold">Work carrying this issue</h2>
        {row.carriers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No task or plan names this issue.</p>
        ) : (
          <ul className="space-y-1">
            {row.carriers.map((slug) => (
              <li key={slug} className="text-sm">
                <a
                  data-testid="issue-carrier-link"
                  href={projectPath(project, `/docs/${encodeURIComponent(slug)}`)}
                  className="text-primary hover:underline font-mono"
                >
                  {slug}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
