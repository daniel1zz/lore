/**
 * Project-scoped Needs-you route — `/p/:name/needs-you`. Renders the SAME `NeedsYou` as `routes/needs-you.tsx`.
 * Source: spec-human-review-surface-decisions-audit-items-and-pending D3
 */

import { createFileRoute } from "@tanstack/react-router";
import { NeedsYou } from "@/components/NeedsYou";

export const Route = createFileRoute("/p/$name/needs-you")({
  component: ProjectNeedsYouPage,
});

function ProjectNeedsYouPage(): React.ReactElement {
  const { name } = Route.useParams();
  return <NeedsYou project={name} />;
}
