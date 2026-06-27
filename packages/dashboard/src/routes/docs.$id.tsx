/**
 * Doc detail route — full document view for a specific doc ID or slug.
 * Path: /docs/$id
 * Invariants: read-only view. Fetches with resolveMdx=true to show placeholder resolutions.
 *   SPEC-015 §2.2: no write paths in this milestone.
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { DocDetail } from "@/components/DocDetail";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGetDoc } from "@/lib/api";

export const Route = createFileRoute("/docs/$id")({
  component: DocPage,
});

function DocPage(): React.ReactElement {
  const { id } = Route.useParams();
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ["doc", id],
    queryFn: () => apiGetDoc(id, { resolveMdx: true }),
    enabled: id.length > 0,
  });

  function handleNavigate(targetId: string): void {
    void navigate({ to: "/docs/$id", params: { id: targetId } });
  }

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-px" />
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-4" style={{ width: `${85 - i * 5}%` }} />
          ))}
        </div>
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="rounded-md border border-destructive/50 p-6">
          <h2 className="font-semibold text-destructive mb-2">Document Not Found</h2>
          <p className="text-sm text-muted-foreground">
            Could not load document <code className="font-mono">{id}</code>. It may not exist or may have moved.
          </p>
          <button
            className="mt-4 text-sm text-primary hover:underline"
            onClick={() => void navigate({ to: "/" })}
            type="button"
          >
            Back to document list
          </button>
        </div>
      </div>
    );
  }

  if (data === undefined) return <></>;

  return <DocDetail docWithNav={data} onNavigate={handleNavigate} />;
}
