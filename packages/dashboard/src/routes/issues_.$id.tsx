/**
 * Issue detail route — single issue report detail + in-place adjudication.
 * Path: /issues/$id
 * Purpose: thin route wrapper around `IssueDetail` (SPEC-074), the same
 *   pattern as `docs.$id.tsx` wrapping `DocDetail`. Navigates back to
 *   `/issues` after a successful approve/reject.
 * File naming: `issues_.$id.tsx` — the trailing underscore on `issues_` is
 *   TanStack Router's file-based-routing "non-nested route" escape hatch
 *   (https://tanstack.com/router routing-concepts: "Non-Nested Routes").
 *   Without it, this file's dot-segment naming (`issues.$id`) would nest
 *   UNDER the sibling `issues.tsx` route as a child rendered through its
 *   `<Outlet/>` — but `issues.tsx`'s `IssuesPage` renders `<IssuesList>`
 *   directly with no `Outlet`, so a nested `/issues/$id` would silently
 *   render the LIST page's tree unchanged instead of the detail view (caught
 *   by this task's own e2e suite navigating to `/issues/$id` and finding the
 *   list, not the detail, still on screen). The resolved URL path is
 *   unaffected — still exactly `/issues/$id`.
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { IssueDetail } from "@/components/IssueDetail";

export const Route = createFileRoute("/issues_/$id")({
  component: IssueDetailPage,
});

function IssueDetailPage(): React.ReactElement {
  const { id } = Route.useParams();
  const navigate = useNavigate();

  function handleAdjudicated(): void {
    void navigate({ to: "/issues" });
  }

  return <IssueDetail reportId={id} onAdjudicated={handleAdjudicated} />;
}
