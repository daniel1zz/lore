/**
 * Library route — document list view with type/status/tag filters and "New doc" button.
 * Path: /library?type=<type>&status=<status>&tags=<a,b>
 * Purpose: the original SPEC-015/SPEC-022 doc-browsing + creation surface,
 *   relocated off "/" when SPEC-033 repurposed the home route as the resolved
 *   living PRD (PRD-001 §13.5) — no functionality was dropped, only moved.
 *   SPEC-036 §1 D2 adds status + tag (AND) filters and moves ALL filter state
 *   (type/status/tags) from `useState` into router search params, fixing the
 *   module invariant "all client state is server state + URL state" — filters
 *   now survive reload/back/forward (AC-36-5).
 * Write mode: "New doc" button opens NewDocModal for creating documents (SPEC-022).
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DocCard } from "@/components/DocCard";
import { NewDocModal } from "@/components/NewDocModal";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiList } from "@/lib/api";
import { queryKeys } from "@/lib/project-api";
import { docTypeSchema, docStatusSchema } from "@lore/core";
import type { DocType, DocStatus } from "@lore/core";
import { librarySearchSchema, tagsFromParam, tagsToParam } from "@/lib/library-search";
import { computeTagVocabulary } from "@/lib/tag-vocabulary";
import { useState } from "react";
import { toast } from "sonner";
import { apiCreateDoc, DashboardApiError } from "@/api/mutations";
import type { CreateDocPayload } from "@/api/mutations";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/library")({
  validateSearch: (search) => librarySearchSchema.parse(search),
  component: LibraryPage,
});

const DOC_TYPES: DocType[] = docTypeSchema.options;
const DOC_STATUSES: DocStatus[] = docStatusSchema.options;

function LibraryPage(): React.ReactElement {
  const navigate = useNavigate({ from: "/library" });
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const selectedType = search.type;
  const selectedStatus = search.status;
  const selectedTags = tagsFromParam(search.tags);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // reason: the unfiltered list is the tag-vocabulary source (SPEC-036 §1 D2's
  // documented zero-extra-request rationale). Its query key intentionally matches
  // the filtered query below's key exactly when no filter is active, so TanStack
  // Query dedupes them into ONE request rather than two identical fetches.
  const { data: unfilteredData } = useQuery({
    queryKey: queryKeys.scope(null, ["docs", "list", undefined, undefined, undefined]),
    queryFn: () => apiList({}),
  });
  const tagVocabulary = computeTagVocabulary(unfilteredData?.docs ?? []);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.scope(null, ["docs", "list", selectedType, selectedStatus, search.tags]),
    // reason: exactOptionalPropertyTypes forbids passing `undefined` for optional
    // ListOpts fields; conditional spread omits each key entirely when unset. SPEC-015 §4.
    queryFn: () =>
      apiList({
        ...(selectedType !== undefined ? { type: selectedType } : {}),
        ...(selectedStatus !== undefined ? { status: selectedStatus } : {}),
        ...(selectedTags.length > 0 ? { tags: selectedTags } : {}),
      }),
  });

  function selectType(nextType: DocType | undefined): void {
    void navigate({
      search: (prev) => {
        const { type: _drop, ...rest } = prev;
        return nextType !== undefined ? { ...rest, type: nextType } : rest;
      },
    });
  }

  function selectStatus(nextStatus: DocStatus | undefined): void {
    void navigate({
      search: (prev) => {
        const { status: _drop, ...rest } = prev;
        return nextStatus !== undefined ? { ...rest, status: nextStatus } : rest;
      },
    });
  }

  function toggleTag(tag: string): void {
    const next = selectedTags.includes(tag)
      ? selectedTags.filter((t) => t !== tag)
      : [...selectedTags, tag];
    void navigate({
      search: (prev) => {
        const { tags: _drop, ...rest } = prev;
        const param = tagsToParam(next);
        return param !== undefined ? { ...rest, tags: param } : rest;
      },
    });
  }

  async function handleCreate(payload: CreateDocPayload): Promise<void> {
    // reason: ASYNC2D-002 defense in depth — NewDocModal's own isPending guard
    // (handleSubmit) is the primary defense against a duplicate submission;
    // this early-return protects the case where handleCreate is invoked
    // directly (e.g. a future caller bypassing the modal's own guard) while a
    // prior create for this page is still in flight.
    if (isCreating) return;
    setIsCreating(true);
    setCreateError(null);
    try {
      const newDoc = await apiCreateDoc(payload);
      void queryClient.invalidateQueries({ queryKey: queryKeys.scope(null, ["docs", "list"]) });
      setShowCreateModal(false);
      toast.success(`Created ${newDoc.slug}`);
      void navigate({ to: "/docs/$id", params: { id: newDoc.id } });
    } catch (err) {
      const message = err instanceof DashboardApiError ? err.message : "Failed to create document";
      setCreateError(message);
      toast.error(message);
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Documents</h1>
          <p className="text-sm text-muted-foreground mt-1">Browse the shared knowledge corpus</p>
        </div>
        <button
          className="flex items-center gap-1.5 px-3 py-2 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90"
          onClick={() => { setCreateError(null); setShowCreateModal(true); }}
          type="button"
        >
          <Plus className="h-4 w-4" />
          New doc
        </button>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by type">
        <Badge
          variant={selectedType === undefined ? "default" : "outline"}
          className="cursor-pointer"
          onClick={() => selectType(undefined)}
        >
          All
        </Badge>
        {DOC_TYPES.map((type) => (
          <Badge
            key={type}
            variant={selectedType === type ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => selectType(type)}
          >
            {type}
          </Badge>
        ))}
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        <Badge
          variant={selectedStatus === undefined ? "default" : "outline"}
          className="cursor-pointer"
          onClick={() => selectStatus(undefined)}
        >
          All
        </Badge>
        {DOC_STATUSES.map((status) => (
          <Badge
            key={status}
            variant={selectedStatus === status ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => selectStatus(status)}
          >
            {status}
          </Badge>
        ))}
      </div>

      {tagVocabulary.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Tags (all of)">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Tags (all of)
          </span>
          {tagVocabulary.map(({ tag, count }) => (
            <Badge
              key={tag}
              variant={selectedTags.includes(tag) ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => toggleTag(tag)}
            >
              {tag} <span className="text-muted-foreground ml-1">{count}</span>
            </Badge>
          ))}
        </div>
      )}

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

      {/* New Doc Modal */}
      {showCreateModal && (
        <NewDocModal
          onCreate={handleCreate}
          isPending={isCreating}
          error={createError}
          onClose={() => setShowCreateModal(false)}
        />
      )}
    </div>
  );
}
