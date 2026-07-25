/**
 * Shared TanStack Query binding for the SPEC-074 issue-reports projection.
 * Purpose: the nav badge (`__root.tsx`), the home card (`IssueReportsCard`),
 *   and the Issues list page (`IssuesList`) all read the SAME
 *   `GET /api/issue-reports` endpoint (spec's "one endpoint, no second count
 *   route" design) — centralizing the query key + poll interval here means
 *   all three surfaces update from a single cache entry / single invalidation
 *   instead of drifting into three independently-typed `useQuery` calls.
 * Public surface: issueReportsQueryKey, useIssueReportsQuery
 * Invariants:
 *   - Polls every ISSUE_REPORTS_POLL_MS as a background freshness floor — but
 *     the detail view's approve/reject mutations ADDITIONALLY invalidate this
 *     exact key on success (`IssueDetail.tsx`) for immediate, non-polling
 *     freshness (AC-074-2/AC-074-3 require the badge to drop within the same
 *     test, not after a poll interval elapses).
 *   - Always mounted (the nav badge lives in the root layout, rendered on
 *     every route) — an approve/reject invalidation always has a live
 *     subscriber to refresh, even when the Issues page itself isn't mounted.
 *   - `issueReportsQueryKey` is a FUNCTION, not a module-level constant
 *     (SPEC-078 T10) — `queryKeys.scope` needs a live `project` value, and a
 *     React hook (`useProjectParam`) cannot be called at module scope.
 *     Callers (`useIssueReportsQuery` here, `IssueDetail.tsx`'s invalidation)
 *     each call `useProjectParam()` themselves and pass the result in.
 * Side-effect class: IO (fetch via TanStack Query)
 * Source: SPEC-074 §Design ("nav badge polls the same projection the page renders")
 */

import { useQuery } from "@tanstack/react-query";
import { apiGetIssueReports } from "./api";
import { queryKeys, useProjectParam } from "./project-api";

/** Query key builder — pass to `queryClient.invalidateQueries` after approve/reject. */
export function issueReportsQueryKey(project: string | null): readonly unknown[] {
  return queryKeys.scope(project, ["issue-reports"]);
}

const ISSUE_REPORTS_POLL_MS = 15_000;

/**
 * @example
 * const { data, isLoading } = useIssueReportsQuery();
 * const openCount = data?.open_count ?? 0;
 */
export function useIssueReportsQuery() {
  const project = useProjectParam();
  return useQuery({
    queryKey: issueReportsQueryKey(project),
    queryFn: () => apiGetIssueReports(project),
    refetchInterval: ISSUE_REPORTS_POLL_MS,
  });
}
