/**
 * Issue detail route — one listed GitHub issue, its derived status and carriers.
 * Path: /issues/$id, where `$id` is the GitHub issue NUMBER.
 * Purpose: thin route wrapper around `IssueDetail`, the same pattern as `docs.$id.tsx` wrapping `DocDetail`.
 * File naming: `issues_.$id.tsx` — the trailing underscore on `issues_` is TanStack Router's file-based-routing
 *   "non-nested route" escape hatch. Without it this file would nest UNDER the sibling `issues.tsx` route as
 *   a child rendered through its `<Outlet/>`, but `issues.tsx` renders `<IssuesList>` directly with no
 *   `Outlet`, so `/issues/$id` would silently render the LIST page. The resolved URL path is unaffected.
 */

import { createFileRoute } from "@tanstack/react-router";
import { IssueDetail } from "@/components/IssueDetail";

export const Route = createFileRoute("/issues_/$id")({
  component: IssueDetailPage,
});

function IssueDetailPage(): React.ReactElement {
  const { id } = Route.useParams();
  return <IssueDetail issueNumber={id} />;
}
