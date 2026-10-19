/**
 * Project-scoped decision detail — `/p/:name/needs-you/decisions/:id`. Same component as the top-level route.
 * Source: spec-human-review-surface-decisions-audit-items-and-pending D3
 */

import { createFileRoute } from "@tanstack/react-router";
import { DecisionDetailPage } from "@/components/DecisionDetailPage";

export const Route = createFileRoute("/p/$name/needs-you_/decisions/$id")({
  component: ProjectDecisionDetailRoute,
});

function ProjectDecisionDetailRoute(): React.ReactElement {
  const { name, id } = Route.useParams();
  return <DecisionDetailPage id={id} project={name} />;
}
