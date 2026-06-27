/**
 * Index route — document list view with type filter chips.
 * Path: /
 * Invariants: read-only list view. Clicking a card navigates to /docs/$id.
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { DocCard } from "@/components/DocCard";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiList } from "@/lib/api";
import type { DocType } from "@lore/core";
import { useState } from "react";

export const Route = createFileRoute("/")({
  component: IndexPage,
});

const DOC_TYPES: DocType[] = ["prd", "spec", "adr", "plan", "knowledge", "task"];

function IndexPage(): React.ReactElement {
  const navigate = useNavigate();
  const [selectedType, setSelectedType] = useState<DocType | undefined>(undefined);

  const { data, isLoading, error } = useQuery({
    queryKey: ["docs", "list", selectedType],
    // reason: exactOptionalPropertyTypes forbids passing `undefined` for optional prop `type`;
    // build opts conditionally to omit the key when no type is selected. SPEC-015 §4.
    queryFn: () => apiList(selectedType !== undefined ? { type: selectedType } : {}),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Documents</h1>
        <p className="text-sm text-muted-foreground mt-1">Browse the shared knowledge corpus</p>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by type">
        <Badge
          variant={selectedType === undefined ? "default" : "outline"}
          className="cursor-pointer"
          onClick={() => setSelectedType(undefined)}
        >
          All
        </Badge>
        {DOC_TYPES.map((type) => (
          <Badge
            key={type}
            variant={selectedType === type ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => setSelectedType(type)}
          >
            {type}
          </Badge>
        ))}
      </div>

      {isLoading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      )}

      {error !== null && !isLoading && (
        <div className="rounded-md border border-destructive/50 p-4">
          <p className="text-sm text-destructive">Failed to load documents. Please try again.</p>
        </div>
      )}

      {data !== undefined && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.docs.map((doc) => (
            <DocCard
              key={doc.id}
              doc={doc}
              onClick={() =>
                void navigate({ to: "/docs/$id", params: { id: doc.id } })
              }
            />
          ))}
          {data.docs.length === 0 && (
            <p className="col-span-full text-center text-sm text-muted-foreground py-8">
              No documents found.
            </p>
          )}
        </div>
      )}

      {data !== undefined && (
        <p className="text-xs text-muted-foreground text-right">
          {data.total} document{data.total !== 1 ? "s" : ""} total
        </p>
      )}
    </div>
  );
}
