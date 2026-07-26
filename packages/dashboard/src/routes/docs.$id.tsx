/**
 * Doc detail route — full document view for a specific doc ID or slug.
 * Path: /docs/$id
 * Write mode: wires onMutated callback so DocDetail can invalidate the query
 *   cache after saves/status-transitions/link changes (SPEC-022).
 * Concurrency: tracks DocDetail's edit-session state (via onEditingChange) and
 *   disables refetchOnWindowFocus/refetchOnReconnect on this doc's query while
 *   an edit session is open — ASYNC2D-001 defense in depth. This does NOT
 *   change non-editing refetch behavior (both flip back to the query-client
 *   default `true` the moment editing ends); the primary guarantee against a
 *   background refetch corrupting a Save's If-Match version is DocDetail's own
 *   `editBaseVersion` freeze (src/lib/edit-session.ts), which holds even if
 *   this route were to stop wiring the callback.
 * SPEC-078 T10: split into a thin route wrapper (`DocRoute`, owns this file's
 *   `Route.useParams()` — route-bound to the literal "/docs/$id" id, so it
 *   cannot be called from a component mounted under `/p/$name/docs/$id`) plus
 *   `DocPageBody` (exported, takes `id` as a prop, reused verbatim by that
 *   mirror route's own thin wrapper).
 */

import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DocDetail } from "@/components/DocDetail";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGetDoc } from "@/lib/api";
import { queryKeys, useProjectParam } from "@/lib/project-api";

export const Route = createFileRoute("/docs/$id")({
  component: DocRoute,
});

/** Thin route wrapper — owns this file's own Route-bound `id` param. */
function DocRoute(): React.ReactElement {
  const { id } = Route.useParams();
  return <DocPageBody id={id} />;
}

/**
 * Route-agnostic doc-detail body — reused verbatim by
 * `routes/p.$name.docs.$id.tsx` (SPEC-078 T10). Exported for that reuse.
 *
 * @param id - Document ULID or slug (from whichever route mounted this body).
 */
export function DocPageBody({ id }: { id: string }): React.ReactElement {
  const navigate = useNavigate();
  const project = useProjectParam();
  const queryClient = useQueryClient();
  const [isEditingDoc, setIsEditingDoc] = useState(false);

  // reason: navigating "home" from within a project context should stay in
  // that project's scope (`/p/:name`), not bounce to the bare "/" (which
  // would then redirect back via `useProjectRedirect` anyway — going direct
  // avoids the extra round trip and matches user intent: "back to THIS
  // project's home", not "re-resolve which project to land on").
  const homeTarget = project !== null ? ({ to: "/p/$name", params: { name: project } } as const) : ({ to: "/" } as const);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.scope(project, ["doc", id]),
    queryFn: () => apiGetDoc(project, id, { resolveMdx: true }),
    enabled: id.length > 0,
    refetchOnWindowFocus: !isEditingDoc,
    refetchOnReconnect: !isEditingDoc,
  });

  function handleNavigate(targetId: string): void {
    if (project !== null) {
      void navigate({ to: "/p/$name/docs/$id", params: { name: project, id: targetId } });
      return;
    }
    void navigate({ to: "/docs/$id", params: { id: targetId } });
  }

  function handleMutated(): void {
    // reason: invalidate both the detail query and all list queries so the
    // index page reflects updated status/title. SPEC-022 §9.2.
    void queryClient.invalidateQueries({ queryKey: queryKeys.scope(project, ["doc", id]) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.scope(project, ["docs", "list"]) });
  }

  function handleDeleted(): void {
    // reason: the doc this page was showing no longer exists in the active
    // set — there is nothing left to re-fetch, unlike handleMutated. Drop
    // the now-stale detail query and navigate away rather than invalidating
    // it (which would just re-fetch a doc that's now soft-deleted).
    // SPEC-027 AC-DH-6.
    queryClient.removeQueries({ queryKey: queryKeys.scope(project, ["doc", id]) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.scope(project, ["docs", "list"]) });
    // reason: ISSUE-005 symmetry — a delete changes the total doc count just
    // as much as a create does; without this the header's "N docs" badge
    // stayed stale here too until a full reload.
    void queryClient.invalidateQueries({ queryKey: queryKeys.scope(project, ["status"]) });
    void navigate(homeTarget);
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
            onClick={() => void navigate(homeTarget)}
            type="button"
          >
            Back to document list
          </button>
        </div>
      </div>
    );
  }

  if (data === undefined) return <></>;

  // reason: `key={data.doc.id}` forces React to unmount/remount DocDetail when
  // navigating between documents. TanStack Query's 5-minute staleTime means a
  // cache hit on doc B can resolve synchronously while DocDetail's internal
  // edit state (isEditing/editContent/editorSeed) is still the instance that
  // was mounted for doc A — without a fresh key, that state (and an in-flight
  // unsaved edit) silently carries over and can be saved against the wrong
  // document. See SPEC-027 AC-DH-1.
  return (
    <DocDetail
      key={data.doc.id}
      docWithNav={data}
      onNavigate={handleNavigate}
      onNavigateHome={() => void navigate(homeTarget)}
      onMutated={handleMutated}
      onDeleted={handleDeleted}
      onEditingChange={setIsEditingDoc}
    />
  );
}
