/**
 * Project-scoped Issues route — `/p/:name/issues`.
 * Purpose: thin wrapper mirroring `routes/issues.tsx`'s `IssuesPage` — renders
 *   the SAME `IssuesList` the top-level route renders. No `project` prop
 *   threading needed: `IssuesList` reads the shared `useIssueReportsQuery()`
 *   hook (`lib/issue-reports-query.ts`), which calls `useProjectParam()`
 *   internally (route-agnostic, parses the router's live pathname) — so it
 *   already resolves the correct project scope for ANY route that mounts it,
 *   including this one, with zero code changes to `IssuesList` itself.
 * Source: SPEC-078 T13 dispatch deliverable
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { IssuesList } from "@/components/IssuesList";

export const Route = createFileRoute("/p/$name/issues")({
  component: ProjectIssuesPage,
});

function ProjectIssuesPage(): React.ReactElement {
  const { name } = Route.useParams();
  const navigate = useNavigate({ from: "/p/$name/issues" });

  function handleNavigate(reportId: string): void {
    void navigate({ to: "/p/$name/issues/$id", params: { name, id: reportId } });
  }

  return <IssuesList onNavigate={handleNavigate} />;
}
