/**
 * Search route — full-text search results page.
 * Path: /search?q=<query>
 * Invariants: query is driven by URL search param `q`; result is read-only.
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { DocCard } from "@/components/DocCard";
import { SearchBar } from "@/components/SearchBar";
import { Skeleton } from "@/components/ui/skeleton";
import { apiSearch } from "@/lib/api";

const searchParamsSchema = z.object({
  q: z.string().optional().default(""),
});

export const Route = createFileRoute("/search")({
  validateSearch: (search) => searchParamsSchema.parse(search),
  component: SearchPage,
});

function SearchPage(): React.ReactElement {
  const navigate = useNavigate({ from: "/search" });
  const { q } = Route.useSearch();

  const { data, isLoading, error } = useQuery({
    queryKey: ["search", q],
    queryFn: () => apiSearch(q),
    enabled: q.trim().length > 0,
  });

  function handleSearch(query: string): void {
    void navigate({ search: { q: query } });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Search</h1>
      </div>

      <SearchBar initialQuery={q} onSearch={handleSearch} placeholder="Search corpus…" />

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
            {data.total} result{data.total !== 1 ? "s" : ""} for <strong>"{q}"</strong>
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.docs.map((doc) => (
              <DocCard
                key={doc.id}
                doc={doc}
                onClick={() =>
                  // reason: routeTree.gen.ts is hand-written for initial typecheck; TanStack Router's
                  // generated types are complex. Double-cast through unknown avoids "non-overlapping types"
                  // error until tsr generate regenerates routeTree from the actual route files. SPEC-015 §4.
                  void navigate({ to: "/docs/$id", params: { id: doc.id } } as unknown as Parameters<typeof navigate>[0])
                }
              />
            ))}
            {data.docs.length === 0 && (
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
