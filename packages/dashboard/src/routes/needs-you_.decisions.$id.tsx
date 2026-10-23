/**
 * Decision detail route — `/needs-you/decisions/:id` (serves open decisions).
 * File naming: the `needs-you_` trailing underscore keeps this a sibling of `needs-you.tsx` rather than a
 * child (that page has no Outlet) — same escape hatch as `issues_.$id.tsx`. URL is unaffected.
 * Source: spec-human-review-surface-decisions-audit-items-and-pending D3
 */

import { createFileRoute } from "@tanstack/react-router";
import { DecisionDetailPage } from "@/components/DecisionDetailPage";

export const Route = createFileRoute("/needs-you_/decisions/$id")({
  component: DecisionDetailRoute,
});

function DecisionDetailRoute(): React.ReactElement {
  const { id } = Route.useParams();
  return <DecisionDetailPage id={id} />;
}
