/**
 * Search route — full-text search results page.
 * Path: /search?q=<query>
 * Invariants: query is driven by URL search param `q`; result is read-only.
 * SPEC-078 T13: split into a thin route wrapper (`SearchRoute`, owns this
 *   file's `Route.useSearch()`/`useNavigate({from: "/search"})` bindings —
 *   TanStack Router types those to the LITERAL "/search" route id, so they
 *   cannot be called from a component mounted at a different route) plus
 *   `SearchPageBody` (exported, props-driven, reused verbatim by the
 *   `/p/$name/search` mirror route's own thin wrapper). `SearchPageBody`
 *   still reads `useProjectParam()` directly — that hook is route-agnostic by
 *   design (parses the router's live pathname, `project-api.ts`), so it needs
 *   no prop threading — same convention as `LibraryPageBody` (`routes/library.tsx`).
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { SearchResultCard } from "@/components/SearchResultCard";
import { SearchBar } from "@/components/SearchBar";
import { Skeleton } from "@/components/ui/skeleton";
import { apiSearch } from "@/lib/api";
import { queryKeys, useProjectParam } from "@/lib/project-api";

/** Exported for reuse by `routes/p.$name.search.tsx`'s own `validateSearch`. */
export const searchParamsSchema = z.object({
  q: z.string().optional().default(""),
});

export const Route = createFileRoute("/search")({
  validateSearch: (search) => searchParamsSchema.parse(search),
  component: SearchRoute,
});

/** Thin route wrapper — owns this file's own Route-bound search/navigate. */
function SearchRoute(): React.ReactElement {
  const navigate = useNavigate({ from: "/search" });
  const { q } = Route.useSearch();

  return (
    <SearchPageBody
      q={q}
      onSearch={(query) => void navigate({ search: { q: query } })}
      onOpenDoc={(id) =>
        // reason: routeTree.gen.ts is hand-written for initial typecheck; TanStack Router's
        // generated types are complex. Double-cast through unknown avoids "non-overlapping types"
        // error until tsr generate regenerates routeTree from the actual route files. SPEC-015 §4.
        void navigate({ to: "/docs/$id", params: { id } } as unknown as Parameters<typeof navigate>[0])
      }
    />
  );
}

/** Props for {@link SearchPageBody} — the route-agnostic reusable body. */
export interface SearchPageBodyProps {
  /** Current parsed `q` search param (from whichever route mounted this body). */
  q: string;
  /** Called with the new query string when the user submits a search. */
  onSearch: (query: string) => void;
  /** Called when a search-result card is clicked. */
  onOpenDoc: (id: string) => void;
}

/**
 * Route-agnostic Search body — reused verbatim by `routes/p.$name.search.tsx`
 * (SPEC-078 T13). Exported for that reuse.
 */
export function SearchPageBody({ q, onSearch, onOpenDoc }: SearchPageBodyProps): React.ReactElement {
  const project = useProjectParam();

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.scope(project, ["search", q]),
    queryFn: () => apiSearch(project, q),
    enabled: q.trim().length > 0,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Search</h1>
      </div>

      <SearchBar initialQuery={q} onSearch={onSearch} placeholder="Search corpus…" />

      {q.trim().length === 0 && (
        <p className="text-sm text-muted-foreground">Enter a search query above to find documents.</p>
      )}

      {isLoading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      )}

      {error !== null && !isLoading && (
        <div className="rounded-md border border-destructive/50 p-4">
          <p className="text-sm text-destructive">Search failed. Please try again.</p>
        </div>
      )}

      {data !== undefined && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {/* reason: CorpusService.search returns { results }, no server-computed total
                (SPEC-031 read-path fix) — the count is derived client-side. */}
            {data.results.length} result{data.results.length !== 1 ? "s" : ""} for <strong>"{q}"</strong>
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.results.map((hit) => (
              <SearchResultCard key={hit.id} hit={hit} onClick={() => onOpenDoc(hit.id)} />
            ))}
            {data.results.length === 0 && (
              <p className="col-span-full text-center text-sm text-muted-foreground py-8">
                No documents match your query.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
