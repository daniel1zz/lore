/**
 * Tree route — hierarchical corpus tree view.
 * Path: /tree
 * Invariants: read-only tree view; clicking a node navigates to /docs/$id.
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { DocTree } from "@/components/DocTree";
import { Skeleton } from "@/components/ui/skeleton";
import { apiTree } from "@/lib/api";
import type { TreeNode } from "@/lib/api";

export const Route = createFileRoute("/tree")({
  component: TreePage,
});

function TreePage(): React.ReactElement {
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ["tree"],
    queryFn: () => apiTree(),
  });

  function handleNodeSelect(node: TreeNode): void {
    void navigate({ to: "/docs/$id", params: { id: node.doc.id } });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Document Tree</h1>
        <p className="text-sm text-muted-foreground mt-1">Hierarchical view of the corpus</p>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-8 rounded-md" style={{ width: `${80 - i * 5}%` }} />
          ))}
        </div>
      )}

      {error !== null && !isLoading && (
        <div className="rounded-md border border-destructive/50 p-4">
          <p className="text-sm text-destructive">Failed to load document tree. Please try again.</p>
        </div>
      )}

      {data !== undefined && (
        <div className="border rounded-lg p-2">
          <DocTree root={data} onSelect={handleNodeSelect} />
        </div>
      )}
    </div>
  );
}
