/**
 * IssueDetail — single issue report detail view + in-place adjudication
 * (SPEC-074 AC-074-2, AC-074-3; D8 resolution rendering,
 * spec-issue-closure-loop-computed-resolution-agent-reachable).
 * Purpose: renders the full `extra.issue_report` payload plus the doc's
 *   description body (`doc.content`), and composes the EXISTING SPEC-022
 *   cookie-gated dashboard-docs approve/reject write routes (via
 *   `apiApproveDoc`/`apiRejectDoc`, `src/api/mutations.ts`) so approve/reject
 *   here is the SAME write path `TriageQueue` uses — never a second,
 *   independently-authored adjudication call.
 * Public surface: IssueDetail, IssueDetailProps, resolutionBadgeVariant
 * Invariants:
 *   - `extra.issue_report` is read DEFENSIVELY (mirrors the server
 *     projection's own guard shape, `issue-reports-routes.ts`) — a
 *     missing/malformed nested field renders as an em-dash placeholder,
 *     never a thrown error or a blank crash.
 *   - Reject requires a non-empty reason — the submit button is disabled
 *     (not merely validated post-click) whenever the reason textarea is
 *     empty or whitespace-only (AC-074-3).
 *   - On successful approve/reject: invalidates BOTH this doc's own query key
 *     and the shared `ISSUE_REPORTS_QUERY_KEY` (so the nav badge / home card /
 *     list page all drop the resolved report immediately, not on the next
 *     poll tick), then calls `onAdjudicated` so the route can navigate back
 *     to the Issues list.
 *   - If-Match / ConflictModal concurrency handling is NOT wired here, same
 *     documented precedent as `TriageQueue` — `apiApproveDoc`/`apiRejectDoc`
 *     never send `If-Match`; a 409 surfaces as a generic error toast.
 *   - `resolution` (D8) is NOT part of `apiGetDoc`'s response (that route
 *     serves every doc type; resolution is issue-report-specific) — it is
 *     read from the SAME `GET /api/issue-reports` projection `IssuesList`/
 *     the nav badge poll, queried here with a DIRECT `useQuery` (same
 *     `issueReportsQueryKey(project)` cache key those callers use) rather
 *     than the shared `useIssueReportsQuery()` hook — that hook derives
 *     `project` from router state (`useProjectParam()`), which would
 *     silently diverge from this component's own EXPLICIT `project` prop the
 *     instant a caller ever passed one that didn't match the current route
 *     (and unconditionally requires a `RouterProvider` in scope, which this
 *     component's explicit-prop design deliberately does not otherwise
 *     need). Matched by resolved doc id (never `reportId` directly, since
 *     that prop may be a slug). A report absent from that projection (e.g.
 *     already approved out of the still-governed set) renders NO resolution
 *     badge rather than guessing one — `doc.status` alone is never treated
 *     as a resolution stand-in.
 * Side-effect class: IO (fetch via TanStack Query, toast)
 * Source: SPEC-074 §Scope, §Design; AC-074-2, AC-074-3;
 *   spec-issue-closure-loop-computed-resolution-agent-reachable §D8, AC-ICL-9
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGetDoc, apiGetIssueReports, type IssueResolution } from "@/lib/api";
import { apiApproveDoc, apiRejectDoc, DashboardApiError } from "@/api/mutations";
import { issueReportsQueryKey } from "@/lib/issue-reports-query";
import { queryKeys } from "@/lib/project-api";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { ProjectIdentityLabel } from "@/components/ProjectIdentityLabel";

/**
 * Presentation-only resolution -> Badge variant mapping (D8) — same mapping
 * as `IssuesList.tsx`'s own local copy, duplicated rather than shared per
 * this codebase's "wait for the rule of three" convention (exactly two
 * consumers). The AC-DC-12 oracle asserts the two copies agree member-for-member,
 * so the duplication cannot drift; see `IssuesList.tsx`'s copy for the full
 * TONE-GROUP rationale (`superseded`/`duplicate` are the NON-DEROGATORY terminal
 * states and must share neither `rejected`'s nor `fixed`'s bucket; `adopted`,
 * §M7, joins `resolving`'s bucket — both are non-derogatory AND undecided,
 * unlike `superseded`/`duplicate`/`closed`, which are non-derogatory but
 * FINAL). Exported for that oracle to drive directly.
 *
 * ⛔ EXHAUSTIVE via the `never` binding after the switch, with NO `default:`
 * clause — a `default` would absorb a state added to `IssueResolution` and render
 * a plausible-but-wrong badge instead of failing to compile.
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

export interface IssueDetailProps {
  /** The issue report's task doc ULID or slug. */
  reportId: string;
  /** Active project, or `null`/absent for registry-less mode (SPEC-078 T10). */
  project?: string | null;
  /** Called after a successful approve or reject. */
  onAdjudicated?: () => void;
}

/** Defensive string reader — mirrors the server projection's own guard shape. */
function readString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : "—";
}

interface FieldRowProps {
  label: string;
  value: string;
}

function FieldRow({ label, value }: FieldRowProps): React.ReactElement {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-words">{value}</span>
    </div>
  );
}

/**
 * @example
 * <IssueDetail reportId={id} onAdjudicated={() => navigate({ to: '/issues' })} />
 */
export function IssueDetail({ reportId, project = null, onAdjudicated }: IssueDetailProps): React.ReactElement {
  const queryClient = useQueryClient();
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [submitting, setSubmitting] = useState<"approve" | "reject" | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.scope(project, ["doc", reportId]),
    queryFn: () => apiGetDoc(project, reportId),
  });

  // D8 — resolution lives on the SAME `GET /api/issue-reports` projection
  // the nav badge/list page poll (never re-derived here). Queried directly
  // (not via `useIssueReportsQuery()`, which derives `project` from router
  // state) so this stays scoped to the SAME explicit `project` prop this
  // component's cache key/invalidation already use — see this file's module
  // header. Matched by resolved doc id (NOT `reportId`, which may be a slug
  // the caller passed in).
  const { data: issueReportsData } = useQuery({
    queryKey: issueReportsQueryKey(project),
    queryFn: () => apiGetIssueReports(project),
  });
  const resolution: IssueResolution | undefined = issueReportsData?.rows.find(
    (row) => row.id === data?.doc.id,
  )?.resolution;

  async function invalidateAfterAdjudicate(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: queryKeys.scope(project, ["doc", reportId]) });
    await queryClient.invalidateQueries({ queryKey: issueReportsQueryKey(project) });
  }

  async function handleApprove(): Promise<void> {
    setSubmitting("approve");
    try {
      await apiApproveDoc(project, reportId);
      toast.success("Issue report approved");
      await invalidateAfterAdjudicate();
      onAdjudicated?.();
    } catch (err) {
      toast.error(err instanceof DashboardApiError ? err.message : "Approve failed");
    } finally {
      setSubmitting(null);
    }
  }

  async function handleReject(): Promise<void> {
    const trimmedReason = rejectReason.trim();
    if (trimmedReason.length === 0) return;

    setSubmitting("reject");
    try {
      await apiRejectDoc(project, reportId, trimmedReason);
      toast.success("Issue report rejected");
      await invalidateAfterAdjudicate();
      onAdjudicated?.();
    } catch (err) {
      toast.error(err instanceof DashboardApiError ? err.message : "Reject failed");
    } finally {
      setSubmitting(null);
    }
  }

  if (isLoading) {
    return (
      <div className="max-w-3xl space-y-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-4" style={{ width: `${85 - i * 5}%` }} />
          ))}
        </div>
      </div>
    );
  }

  if (error !== null || data === undefined) {
    return (
      <div className="max-w-3xl">
        <div className="rounded-md border border-destructive/50 p-6">
          <h2 className="font-semibold text-destructive mb-2">Issue report not found</h2>
          <p className="text-sm text-muted-foreground">
            Could not load report <code className="font-mono">{reportId}</code>.
          </p>
        </div>
      </div>
    );
  }

  const { doc } = data;
  const issueReport = (doc.extra["issue_report"] ?? {}) as Record<string, unknown>;
  const possibleDuplicates = issueReport["possible_duplicates"];
  const duplicates = Array.isArray(possibleDuplicates)
    ? possibleDuplicates.filter((entry): entry is string => typeof entry === "string")
    : [];
  const isSubmitting = submitting !== null;

  return (
    <section aria-label="Issue report detail" className="max-w-3xl space-y-6">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">{doc.title}</h1>
          <Badge variant="outline" className="text-xs">
            {doc.status}
          </Badge>
          {resolution !== undefined && (
            <Badge
              data-testid="issue-report-resolution"
              variant={resolutionBadgeVariant(resolution)}
              className="text-xs"
            >
              {resolution}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">Reported {readString(issueReport, "reported_at")}</p>
      </header>

      <div className="rounded-lg border p-4 space-y-2">
        <FieldRow label="Reporter project" value={readString(issueReport, "reporter_project")} />
        <FieldRow label="Reporter actor" value={readString(issueReport, "reporter_actor")} />
        <FieldRow label="Lore version" value={readString(issueReport, "lore_version")} />
        <FieldRow label="Expected" value={readString(issueReport, "expected")} />
        <FieldRow label="Actual" value={readString(issueReport, "actual")} />
        <FieldRow label="Repro command" value={readString(issueReport, "repro_command")} />
        <FieldRow
          label="Possible duplicates"
          value={duplicates.length > 0 ? duplicates.join(", ") : "none"}
        />
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold">Description</h2>
        <div className="rounded-lg border p-4 text-sm whitespace-pre-wrap">
          {doc.content.length > 0 ? doc.content : "(no description)"}
        </div>
      </div>

      <div className="rounded-lg border p-4 space-y-3">
        <h2 className="text-sm font-semibold">Adjudicate</h2>
        <div className="flex items-center gap-2">
          <ProjectIdentityLabel project={project} />
          <button
            type="button"
            className="text-sm px-3 py-1.5 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
            onClick={() => void handleApprove()}
            disabled={isSubmitting}
          >
            {submitting === "approve" ? "Approving…" : "Approve"}
          </button>
          <button
            type="button"
            className="text-sm px-3 py-1.5 border border-destructive text-destructive rounded hover:bg-destructive/10 disabled:opacity-50"
            onClick={() => setShowRejectForm((prev) => !prev)}
            disabled={isSubmitting}
          >
            {showRejectForm ? "Cancel reject" : "Reject"}
          </button>
        </div>

        {showRejectForm && (
          <div className="space-y-2 pt-2 border-t">
            <label htmlFor="reject-reason" className="text-xs text-muted-foreground">
              Rejection reason (required)
            </label>
            <textarea
              id="reject-reason"
              className="w-full text-sm px-2 py-1.5 border rounded bg-background"
              placeholder="Why is this report being rejected?"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              disabled={isSubmitting}
              rows={3}
            />
            <button
              type="button"
              className="text-sm px-3 py-1.5 bg-destructive text-destructive-foreground rounded hover:bg-destructive/90 disabled:opacity-50"
              onClick={() => void handleReject()}
              disabled={isSubmitting || rejectReason.trim().length === 0}
            >
              {submitting === "reject" ? "Rejecting…" : "Confirm reject"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
