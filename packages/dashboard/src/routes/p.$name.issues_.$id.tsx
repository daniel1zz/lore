/**
 * Project-scoped issue-detail route — `/p/:name/issues/:id`.
 * Purpose: thin wrapper mirroring `routes/issues_.$id.tsx`'s
 *   `IssueDetailPage` — this file owns its OWN Route-bound `id` param and
 *   renders the SAME `IssueDetail` the top-level route renders, passing
 *   `project={name}` (`IssueDetail` takes an explicit `project` prop rather
 *   than reading `useProjectParam()` internally — see its module doc
 *   comment).
 * File naming: `p.$name.issues_.$id.tsx` — the trailing underscore on
 *   `issues_` is the SAME TanStack Router "non-nested route" escape hatch the
 *   top-level `issues_.$id.tsx` uses (see that file's doc comment): without
 *   it, this file would nest under the sibling `p.$name.issues.tsx` (whose
 *   `ProjectIssuesPage` renders `<IssuesList>` directly with no `Outlet`),
 *   silently rendering the list instead of the detail. Resolved URL path is
 *   unaffected — still exactly `/p/:name/issues/:id`.
 * Source: SPEC-078 T13 dispatch deliverable
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { IssueDetail } from "@/components/IssueDetail";

export const Route = createFileRoute("/p/$name/issues_/$id")({
  component: ProjectIssueDetailPage,
});

function ProjectIssueDetailPage(): React.ReactElement {
  const { name, id } = Route.useParams();
  const navigate = useNavigate();

  function handleAdjudicated(): void {
    void navigate({ to: "/p/$name/issues", params: { name } });
  }

  return <IssueDetail reportId={id} project={name} onAdjudicated={handleAdjudicated} />;
}
