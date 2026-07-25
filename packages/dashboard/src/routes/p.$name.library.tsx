/**
 * Project-scoped Library route — `/p/:name/library`.
 * Purpose: thin wrapper mirroring `routes/library.tsx`'s `LibraryRoute` — this
 *   file owns its OWN `Route.useSearch()`/`useNavigate({from: "/p/$name/library"})`
 *   bindings (route-bound, cannot be shared across two different route ids)
 *   and renders the SAME `LibraryPageBody` the top-level route renders.
 * Source: SPEC-078 T10 dispatch deliverable 1
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { librarySearchSchema } from "@/lib/library-search";
import { LibraryPageBody } from "@/routes/library";

export const Route = createFileRoute("/p/$name/library")({
  validateSearch: (search) => librarySearchSchema.parse(search),
  component: ProjectLibraryRoute,
});

function ProjectLibraryRoute(): React.ReactElement {
  const { name } = Route.useParams();
  const navigate = useNavigate({ from: "/p/$name/library" });
  const search = Route.useSearch();

  return (
    <LibraryPageBody
      search={search}
      onSearchChange={(next) => void navigate({ search: next })}
      onOpenDoc={(id) => void navigate({ to: "/p/$name/docs/$id", params: { name, id } })}
      onDocCreated={(doc) => void navigate({ to: "/p/$name/docs/$id", params: { name, id: doc.id } })}
    />
  );
}
