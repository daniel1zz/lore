/**
 * Library route — document list view with type filter chips and "New doc" button.
 * Path: /library
 * Purpose: the original SPEC-015/SPEC-022 doc-browsing + creation surface,
 *   relocated off "/" when SPEC-033 repurposed the home route as the resolved
 *   living PRD (PRD-001 §13.5) — no functionality was dropped, only moved.
 * Write mode: "New doc" button opens NewDocModal for creating documents (SPEC-022).
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DocCard } from "@/components/DocCard";
import { NewDocModal } from "@/components/NewDocModal";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiList } from "@/lib/api";
import type { DocType } from "@lore/core";
import { useState } from "react";
import { toast } from "sonner";
import { apiCreateDoc, DashboardApiError } from "@/api/mutations";
import type { CreateDocPayload } from "@/api/mutations";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/library")({
  component: LibraryPage,
});

const DOC_TYPES: DocType[] = ["prd", "spec", "adr", "plan", "knowledge", "task"];

function LibraryPage(): React.ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedType, setSelectedType] = useState<DocType | undefined>(undefined);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["docs", "list", selectedType],
    // reason: exactOptionalPropertyTypes forbids passing `undefined` for optional prop `type`;
    // build opts conditionally to omit the key when no type is selected. SPEC-015 §4.
    queryFn: () => apiList(selectedType !== undefined ? { type: selectedType } : {}),
  });

  async function handleCreate(payload: CreateDocPayload): Promise<void> {
    setIsCreating(true);
    setCreateError(null);
    try {
      const newDoc = await apiCreateDoc(payload);
      void queryClient.invalidateQueries({ queryKey: ["docs", "list"] });
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
