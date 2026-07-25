/**
 * Project-scoped doc-detail route — `/p/:name/docs/:id`.
 * Purpose: thin wrapper mirroring `routes/docs.$id.tsx`'s `DocRoute` — owns
 *   this file's OWN Route-bound `id` param and renders the SAME
 *   `DocPageBody` the top-level route renders.
 * Source: SPEC-078 T10 dispatch deliverable 1
 */

import { createFileRoute } from "@tanstack/react-router";
import { DocPageBody } from "@/routes/docs.$id";

export const Route = createFileRoute("/p/$name/docs/$id")({
  component: ProjectDocRoute,
});

function ProjectDocRoute(): React.ReactElement {
  const { id } = Route.useParams();
  return <DocPageBody id={id} />;
}
