/**
 * Project-scoped Search route — `/p/:name/search`.
 * Purpose: thin wrapper mirroring `routes/search.tsx`'s `SearchRoute` — this
 *   file owns its OWN `Route.useSearch()`/`useNavigate({from: "/p/$name/search"})`
 *   bindings (route-bound, cannot be shared across two different route ids)
 *   and renders the SAME `SearchPageBody` the top-level route renders.
 * Source: SPEC-078 T13 dispatch deliverable
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { searchParamsSchema, SearchPageBody } from "@/routes/search";

export const Route = createFileRoute("/p/$name/search")({
  validateSearch: (search) => searchParamsSchema.parse(search),
  component: ProjectSearchRoute,
});

function ProjectSearchRoute(): React.ReactElement {
  const { name } = Route.useParams();
  const navigate = useNavigate({ from: "/p/$name/search" });
  const { q } = Route.useSearch();

  return (
    <SearchPageBody
      q={q}
      onSearch={(query) => void navigate({ search: { q: query } })}
      onOpenDoc={(id) => void navigate({ to: "/p/$name/docs/$id", params: { name, id } })}
    />
  );
}
