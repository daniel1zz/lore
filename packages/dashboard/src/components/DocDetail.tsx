/**
 * DocDetail — full document view with read + write modes.
 * Purpose: renders the complete doc view; adds edit mode, status transitions,
 *   editable links, and history tab when the server is authenticated (SPEC-022).
 * Public surface: DocDetail, DocDetailProps
 * Invariants:
 *   - Edit mode is toggled by the "Edit" button; shows CodeMirror editor.
 *   - Save triggers PATCH with If-Match (optimistic concurrency); 409 → ConflictModal.
 *   - Status transitions go through the appropriate dashboard endpoint
 *     (approve → /approve, reject → /reject, other → PATCH status field with
 *     If-Match; 409 → loud toast + onMutated() refresh, never a silent overwrite).
 *   - Links panel shows related docs with add/remove affordances.
 *   - History tab loads lazily when the "History" tab is clicked.
 *   - Draft content is restored from localStorage on mount if version matches.
 *   - onMutated is called after every successful write; the caller is responsible
 *     for cache invalidation (inversion-of-control avoids needing QueryClientProvider
 *     in unit tests). SPEC-022 §9.
 *   - Delete requires an explicit confirmation dialog (AlertDialogConfirm) before
 *     the DELETE request fires — no direct-click delete. On success, `onDeleted`
 *     is called (distinct from `onMutated`) so the caller navigates away from the
 *     now-gone document instead of re-fetching it. Delete is a 30-day-recoverable
 *     soft delete, not permanent removal (SPEC-027 AC-DH-6).
 *   - `editorSeed` (not `editContent`) is passed as Editor's `initialValue`.
 *     `editContent` updates on every keystroke; feeding it back into `initialValue`
 *     would re-trigger CodeMirror's mount effect per keystroke, destroying and
 *     recreating the view mid-edit (loses focus, resets cursor to doc start,
 *     scrambles typed input). `editorSeed` is set only when a new edit session
 *     starts (Edit button click).
 *   - The caller MUST mount DocDetail with `key={doc.id}` (see routes/docs.$id.tsx) —
 *     without a per-document key, a TanStack Query cache hit while navigating
 *     between documents reuses this component instance, and its edit state
 *     (isEditing/editContent/editorSeed) would otherwise leak from the
 *     previously viewed document into the next. SPEC-027 AC-DH-1.
 *   - The pending debounced draft-autosave timer (`draftSaveTimerRef`) is
 *     cleared on both Save and Cancel, not just on unmount — otherwise a timer
 *     scheduled just before either action fires afterwards and rewrites
 *     localStorage with content the user already saved or discarded.
 *     SPEC-027 AC-DH-3.
 *   - Header renders a type accent border + one meta row (SPEC-036 §1 D3),
 *     computed client-side via `deriveTypeMeta(doc)` (`@lore/core`) — `doc`
 *     here is the full `DocRecord` from `GET /api/docs/:id`, which has no
 *     `.meta` field of its own (that projection only exists on `DocSummary`,
 *     e.g. list rows). No `claimTtlMinutes` is available client-side, so a
 *     task's `claim_stale` is always omitted on this page (never fabricated
 *     `false`) — a narrower, documented degradation vs. the list view, which
 *     gets the server-computed value. The breadcrumb (ancestor chain) mounts
 *     above this header.
 * Side-effect class: IO (fetch, localStorage)
 * Source: SPEC-015, SPEC-022 §9.2, SPEC-027, SPEC-036 §1 D1/D3
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Editor } from "@/components/Editor";
import { StatusPill } from "@/components/StatusPill";
import { LinksPanel } from "@/components/LinksPanel";
import { HistoryTab } from "@/components/HistoryTab";
import { AuditTab } from "@/components/AuditTab";
import { ConflictModal } from "@/components/ConflictModal";
import { Breadcrumb } from "@/components/Breadcrumb";
import { saveDraft, loadDraft, clearDraft, isDraftStale } from "@/store/draft";
import type { DocWithNavigation } from "@/lib/api";
import type { DocStatus, LinkType } from "@lore/core";
import { deriveTypeMeta } from "@lore/core";
import { cn } from "@/lib/utils";
import { TYPE_ACCENT, TYPE_ACCENT_BORDER_CLASS } from "@/lib/type-accent";
import { formatTypeMetaLabel, isNotablePriority } from "@/lib/type-meta-label";
import {
  apiPatchDoc,
  apiApproveDoc,
  apiRejectDoc,
  apiCreateLink,
  apiDeleteLink,
  apiDeleteDoc,
  ConflictError,
  DashboardApiError,
} from "@/api/mutations";

// ─── Delete confirmation dialog ────────────────────────────────────────────────

interface DeleteConfirmDialogProps {
  title: string;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Explicit confirmation dialog for the destructive-looking (but recoverable)
 * delete action. Mirrors the hand-rolled overlay pattern already used by
 * ConflictModal / HistoryTab's DiffModal rather than introducing a new
 * shadcn primitive for a single call site.
 */
function DeleteConfirmDialog({ title, isPending, onConfirm, onCancel }: DeleteConfirmDialogProps): React.ReactElement {
  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onCancel}
      role="alertdialog"
      aria-modal="true"
      aria-label="Confirm delete"
    >
      <div
        className="bg-background border rounded-lg shadow-xl max-w-md w-full p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold text-lg">Delete "{title}"?</h3>
        <p className="text-sm text-muted-foreground">
          This document will be recoverable for 30 days. It will no longer appear in lists or search
          until restored.
        </p>
        <div className="flex justify-end gap-2">
          <button
            className="text-sm px-3 py-1 border rounded hover:bg-muted"
            onClick={onCancel}
            type="button"
            disabled={isPending}
          >
            Cancel
          </button>
          <button
            className="text-sm px-3 py-1 bg-destructive text-destructive-foreground rounded hover:bg-destructive/90 disabled:opacity-50"
            onClick={onConfirm}
            type="button"
            disabled={isPending}
          >
            {isPending ? "Deleting..." : "Delete (recoverable)"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DocDetailProps {
  /** Document with navigation context from the API. */
  docWithNav: DocWithNavigation;
  /** Called when the user clicks on a sibling/related doc ID (also used by breadcrumb ancestor crumbs). */
  onNavigate?: (idOrSlug: string) => void;
  /** Called when the breadcrumb's Home crumb is clicked (SPEC-036 §1 D1). */
  onNavigateHome?: () => void;
  /**
   * Called after any successful write (save/approve/reject/link).
   * Caller should invalidate query cache for this doc and related lists.
   * Decoupled here so DocDetail works in tests without QueryClientProvider.
   */
  onMutated?: () => void;
  /**
   * Called after a successful delete, in place of `onMutated` (there is no
   * document left to re-fetch). Caller should navigate away from this doc's
   * page — the Delete button/dialog is only rendered when this is provided,
   * matching the existing `onMutated !== undefined` gating for other write
   * affordances. SPEC-027 AC-DH-6.
   */
  onDeleted?: () => void;
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

type ActiveTab = "content" | "history" | "audit";

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Full document detail view with optional write mode.
 * Detects session via cookie (bootstrapAuthIfNeeded already ran), shows write UI.
 *
 * @example
 * const queryClient = useQueryClient();
 * <DocDetail
 *   docWithNav={data}
 *   onNavigate={(id) => navigate({ to: '/docs/$id', params: { id } })}
 *   onNavigateHome={() => navigate({ to: '/' })}
 *   onMutated={() => queryClient.invalidateQueries({ queryKey: ["doc", doc.id] })}
 *   onDeleted={() => navigate({ to: '/' })}
 * />
 */
export function DocDetail({
  docWithNav,
  onNavigate,
  onNavigateHome,
  onMutated,
  onDeleted,
}: DocDetailProps): React.ReactElement {
  const { doc, navigation } = docWithNav;
  // reason: `doc` is the full DocRecord (GET /api/docs/:id), which carries no `.meta`
  // projection of its own — deriveTypeMeta (browser-safe, @lore/core) computes it
  // client-side from `type` + `extra` directly. No claimTtlMinutes is available here,
  // so a task's `claim_stale` is always omitted (never fabricated `false`); see the
  // module doc comment.
  const typeMeta = deriveTypeMeta(doc);
  const metaLabel = typeMeta !== undefined ? formatTypeMetaLabel(typeMeta) : null;
  const showPriority = isNotablePriority(doc.priority);

  // ── Edit state ──────────────────────────────────────────────────────────────
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState<string>(() => {
    // Restore draft from localStorage if version matches.
    const draft = loadDraft(doc.id);
    if (draft !== null && !isDraftStale(draft, doc.version)) {
      return draft.content;
    }
    return doc.content;
  });
  // reason: Editor's `initialValue` is the CodeMirror mount effect's only dependency
  // (Editor.tsx `useEffect([initialValue])`) — every time it changes, CodeMirror
  // destroys and recreates the whole view, resetting focus and the cursor/selection
  // to document start. `editContent` is updated on every keystroke by
  // handleEditorChange, so it must NEVER be fed back into Editor's `initialValue` —
  // doing so causes a destroy+recreate per keystroke, which drops/scrambles rapidly
  // typed input (observed: saved content truncated to the first character typed).
  // `editorSeed` is the value that seeds a NEW edit session only (Edit click) and is
  // otherwise held stable while `editContent` continues to track the live value for
  // Save / draft-autosave.
  const [editorSeed, setEditorSeed] = useState<string>(editContent);
  const [isSaving, setIsSaving] = useState(false);

  // ── Conflict modal state ────────────────────────────────────────────────────
  const [conflictError, setConflictError] = useState<ConflictError | null>(null);
  const [isForcing, setIsForcing] = useState(false);

  // ── Status transition state ──────────────────────────────────────────────────
  const [isTransitioning, setIsTransitioning] = useState(false);

  // ── Links state ─────────────────────────────────────────────────────────────
  const [isLinkPending, setIsLinkPending] = useState(false);

  // ── Delete state ─────────────────────────────────────────────────────────────
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // ── Tab state ──────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<ActiveTab>("content");

  // ── Draft autosave (debounced) ───────────────────────────────────────────────
  // reason: SPEC-022 §6 risk mitigation ("Markdown editor saves trigger huge version
  // churn") requires the localStorage draft write to be debounced 1s, distinct from the
  // explicit Save button which is the only path that PATCHes the server. Writing to
  // localStorage on every keystroke is wasted work on long documents and was flagged in
  // review; a trailing-edge debounce keeps the draft-recovery UX while cutting write volume.
  const DRAFT_SAVE_DEBOUNCE_MS = 1000;
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (draftSaveTimerRef.current !== null) clearTimeout(draftSaveTimerRef.current);
    };
  }, []);

  const handleEditorChange = useCallback(
    (value: string) => {
      setEditContent(value);
      if (draftSaveTimerRef.current !== null) clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = setTimeout(() => {
        saveDraft({ doc_id: doc.id, version: doc.version, content: value, last_edited_at: new Date().toISOString() });
      }, DRAFT_SAVE_DEBOUNCE_MS);
    },
    [doc.id, doc.version],
  );

  // reason: Editing content on an approved doc auto-demotes it to draft server-side
  // (CorpusService.update side effect — no VALID_TRANSITIONS edge exists for this, see
  // SPEC-022 §4 AC-DASH-WRITE-5 note). The client compares pre-save status against the
  // server's returned status to surface this non-obvious side effect distinctly, rather
  // than a generic "saved" toast that would hide the status change from the user.
  function notifySaveOutcome(previousStatus: DocStatus, savedDoc: { status: DocStatus }, forced: boolean): void {
    if (previousStatus === "approved" && savedDoc.status === "draft") {
      toast.success("Saved — status reverted to draft (editing an approved doc requires re-review)");
      return;
    }
    toast.success(forced ? "Document saved (force overwrite)" : "Document saved");
  }

  // ── Save (PATCH) ─────────────────────────────────────────────────────────────
  async function handleSave(): Promise<void> {
    setIsSaving(true);
    try {
      const savedDoc = await apiPatchDoc(doc.id, { content: editContent }, { version: doc.version });
      // reason: cancel any pending debounced draft-autosave before clearing — otherwise
      // a timer scheduled just before Save fires up to DRAFT_SAVE_DEBOUNCE_MS later and
      // rewrites localStorage with the pre-save content, resurrecting a draft the user
      // already committed. See SPEC-027 AC-DH-3.
      if (draftSaveTimerRef.current !== null) {
        clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
      clearDraft(doc.id);
      onMutated?.();
      setIsEditing(false);
      notifySaveOutcome(doc.status, savedDoc, false);
    } catch (err) {
      if (err instanceof ConflictError) {
        setConflictError(err);
      } else {
        const message = err instanceof DashboardApiError ? err.message : "Save failed";
        toast.error(message);
      }
    } finally {
      setIsSaving(false);
    }
  }

  async function handleForceOverwrite(): Promise<void> {
    setIsForcing(true);
    try {
      const savedDoc = await apiPatchDoc(doc.id, { content: editContent }, { forceOverwrite: true });
      clearDraft(doc.id);
      setConflictError(null);
      onMutated?.();
      setIsEditing(false);
      notifySaveOutcome(doc.status, savedDoc, true);
    } catch (err) {
      const message = err instanceof DashboardApiError ? err.message : "Force save failed";
      toast.error(message);
    } finally {
      setIsForcing(false);
    }
  }

  // ── Status transition ────────────────────────────────────────────────────────
  async function handleTransition(toStatus: DocStatus, reason?: string): Promise<void> {
    setIsTransitioning(true);
    try {
      if (toStatus === "approved") {
        await apiApproveDoc(doc.id);
        toast.success("Document approved");
      } else if (toStatus === "draft" && doc.status === "in-review") {
        await apiRejectDoc(doc.id, reason);
        toast.success("Document rejected");
      } else {
        // reason: If-Match with the doc's known version closes the same concurrency
        // hole handleSave guards against — without it, checkConcurrency on the
        // server unconditionally allows the write, so two tabs racing a status
        // transition silently clobber each other. See SPEC-027 AC-DH-2.
        await apiPatchDoc(doc.id, { status: toStatus }, { version: doc.version });
        toast.success(`Status → ${toStatus}`);
      }
      onMutated?.();
    } catch (err) {
      if (err instanceof ConflictError) {
        // reason: unlike content edits, a status transition has no natural
        // "force overwrite over a diff" — the ConflictModal is content-diff shaped
        // (myContent vs serverDoc.content) and doesn't map cleanly onto a status
        // value. Refusing loudly and refreshing the cached doc (so the UI's next
        // render carries the current version/status) is the safe, non-silent
        // response; the user re-issues the transition once they see the fresh state.
        toast.error(
          `Status change failed — document is now at v${err.current.version} (status: ${err.current.status}). Refresh and retry.`,
        );
        onMutated?.();
      } else {
        const message = err instanceof DashboardApiError ? err.message : "Transition failed";
        toast.error(message);
      }
    } finally {
      setIsTransitioning(false);
    }
  }

  // ── Links ────────────────────────────────────────────────────────────────────
  async function handleLinkAdd(toId: string, type: LinkType): Promise<string | null> {
    setIsLinkPending(true);
    try {
      await apiCreateLink(doc.id, { to: toId, type });
      onMutated?.();
      return null;
    } catch (err) {
      if (err instanceof DashboardApiError) return err.message;
      return "Failed to add link";
    } finally {
      setIsLinkPending(false);
    }
  }

  async function handleLinkRemove(toId: string): Promise<void> {
    setIsLinkPending(true);
    try {
      await apiDeleteLink(doc.id, toId);
      onMutated?.();
    } catch (err) {
      const message = err instanceof DashboardApiError ? err.message : "Failed to remove link";
      toast.error(message);
    } finally {
      setIsLinkPending(false);
    }
  }

  // ── Delete ───────────────────────────────────────────────────────────────────
  async function handleDelete(): Promise<void> {
    setIsDeleting(true);
    try {
      await apiDeleteDoc(doc.id);
      // reason: cancel any pending draft-autosave timer and clear the localStorage
      // draft for this doc — otherwise a stray timer or a stale draft would
      // resurrect content for a document that no longer exists in the active list.
      if (draftSaveTimerRef.current !== null) {
        clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
      clearDraft(doc.id);
      toast.success("Document deleted (recoverable for 30 days)");
      setIsDeleteDialogOpen(false);
      onDeleted?.();
    } catch (err) {
      const message = err instanceof DashboardApiError ? err.message : "Delete failed";
      toast.error(message);
    } finally {
      setIsDeleting(false);
    }
  }

  // ── Link entries from navigation ─────────────────────────────────────────────
  const linkEntries = navigation.related.map((r) => ({
    to_id: r.id,
    title: r.title,
    link_type: r.link_type as LinkType,
  }));

  return (
    <article className="max-w-4xl mx-auto space-y-6">
      {/* Breadcrumb (SPEC-036 §1 D1). Conditional spread: exactOptionalPropertyTypes
          forbids passing a possibly-undefined value for an optional prop (same
          pattern as onMutated/onLinkAdd above). */}
      <Breadcrumb
        ancestors={navigation.ancestors}
        currentTitle={doc.title}
        {...(onNavigate !== undefined ? { onNavigate } : {})}
        {...(onNavigateHome !== undefined ? { onHome: onNavigateHome } : {})}
      />

      {/* Header — type accent border (SPEC-036 §1 D3) */}
      <header className={cn(TYPE_ACCENT_BORDER_CLASS, "pl-4", TYPE_ACCENT[doc.type])}>
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <Badge variant="secondary">{doc.type}</Badge>
          {/* reason: only enable status transitions and Edit when caller provides onMutated
              (i.e., is in a proper query-provider context). Keeps component usable in
              read-only / unit-test scenarios without a QueryClientProvider. SPEC-022 §9. */}
          <StatusPill
            status={doc.status}
            {...(onMutated !== undefined ? { onTransition: handleTransition } : {})}
            isPending={isTransitioning}
          />
          <div className="ml-auto flex items-center gap-2">
            {/* reason: gated on onDeleted (not onMutated) — Delete has no document
                left to re-render after success, so it needs the distinct
                navigate-away callback rather than a cache-invalidation callback.
                Hidden while editing to avoid deleting mid-edit. SPEC-027 AC-DH-6. */}
            {onDeleted !== undefined && !isEditing && (
              <button
                className="text-sm px-3 py-1 border border-destructive text-destructive rounded hover:bg-destructive/10"
                onClick={() => setIsDeleteDialogOpen(true)}
                type="button"
              >
                Delete
              </button>
            )}
            {onMutated !== undefined && !isEditing ? (
              <button
                className="text-sm px-3 py-1 border rounded hover:bg-muted"
                onClick={() => {
                  setEditContent(doc.content);
                  setEditorSeed(doc.content);
                  setIsEditing(true);
                }}
                type="button"
              >
                Edit
              </button>
            ) : onMutated !== undefined && isEditing ? (
              <>
                <button
                  className="text-sm px-3 py-1 border rounded hover:bg-muted"
                  onClick={() => {
                    // reason: cancel the pending debounced draft-autosave before clearing
                    // the draft — without this, a timer scheduled just before Cancel fires
                    // up to DRAFT_SAVE_DEBOUNCE_MS later and rewrites localStorage with the
                    // abandoned edit; since doc.version hasn't changed, isDraftStale() later
                    // reads it back as fresh and resurrects discarded content. SPEC-027 AC-DH-3.
                    if (draftSaveTimerRef.current !== null) {
                      clearTimeout(draftSaveTimerRef.current);
                      draftSaveTimerRef.current = null;
                    }
                    setIsEditing(false);
                    setEditContent(doc.content);
                    clearDraft(doc.id);
                  }}
                  type="button"
                  disabled={isSaving}
                >
                  Cancel
                </button>
                <button
                  className="text-sm px-3 py-1 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
                  onClick={() => void handleSave()}
                  type="button"
                  disabled={isSaving}
                >
                  {isSaving ? "Saving..." : "Save"}
                </button>
              </>
            ) : null}
          </div>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{doc.title}</h1>
        <p className="text-sm text-muted-foreground mt-1 font-mono">{doc.slug}</p>

        {(metaLabel !== null || showPriority) && (
          <div className="flex items-center gap-1.5 flex-wrap mt-2">
            {metaLabel !== null && (
              <Badge variant="outline" className="text-xs">
                {metaLabel}
              </Badge>
            )}
            {showPriority && (
              <Badge variant={doc.priority === "critical" ? "destructive" : "secondary"} className="text-xs">
                {doc.priority}
              </Badge>
            )}
          </div>
        )}

        {doc.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2" aria-label="Tags">
            {doc.tags.map((tag) => (
              <Badge key={tag} variant="outline" className="text-xs">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </header>

      <Separator />

      {/* Metadata table */}
      <section aria-label="Document metadata">
        <Table>
          <TableBody>
            <TableRow>
              <TableCell className="font-medium w-32">ID</TableCell>
              <TableCell className="font-mono text-xs">{doc.id}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">Version</TableCell>
              <TableCell>v{doc.version}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">Created</TableCell>
              <TableCell>{new Date(doc.created_at).toLocaleDateString()}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">Updated</TableCell>
              <TableCell>{new Date(doc.updated_at).toLocaleDateString()}</TableCell>
            </TableRow>
            {doc.created_by !== null && (
              <TableRow>
                <TableCell className="font-medium">Author</TableCell>
                <TableCell>{doc.created_by}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>

      <Separator />

      {/* Tab switcher */}
      <div className="flex gap-4 border-b">
        {(["content", "history", "audit"] as ActiveTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            className={`pb-2 text-sm font-medium capitalize border-b-2 -mb-px transition-colors ${
              activeTab === tab
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Content tab */}
      {activeTab === "content" && (
        <section aria-label="Document content">
          {isEditing ? (
            <Editor
              initialValue={editorSeed}
              onChange={handleEditorChange}
              splitView={true}
            />
          ) : (
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.content}</ReactMarkdown>
            </div>
          )}
        </section>
      )}

      {/* History tab */}
      {activeTab === "history" && (
        <section aria-label="Version history">
          {/* reason: onRestored reuses onMutated — restore's effect on this doc
              (content/status/version changed) is exactly the cache invalidation
              onMutated already triggers. Gated the same way as Edit/LinksPanel:
              absent in read-only contexts. SPEC-027 AC-DH-7. */}
          <HistoryTab docId={doc.id} {...(onMutated !== undefined ? { onRestored: onMutated } : {})} />
        </section>
      )}

      {/* Audit tab (SPEC-033 F3) */}
      {activeTab === "audit" && (
        <section aria-label="Audit trail">
          <AuditTab docId={doc.id} />
        </section>
      )}

      {/* Navigation footer + Links panel */}
      {(navigation.parent !== null || navigation.siblings.length > 0 || navigation.children.length > 0 || linkEntries.length > 0) && (
        <>
          <Separator />
          <footer aria-label="Document navigation" className="space-y-4">
            {navigation.parent !== null && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Parent</p>
                <button
                  className="text-sm text-primary hover:underline"
                  onClick={() => onNavigate?.(navigation.parent!.id)}
                  type="button"
                >
                  {navigation.parent.title}
                </button>
              </div>
            )}
            {navigation.children.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Children</p>
                <div className="flex flex-wrap gap-2">
                  {navigation.children.map((child) => (
                    <button
                      key={child.id}
                      className="text-sm text-primary hover:underline"
                      onClick={() => onNavigate?.(child.id)}
                      type="button"
                    >
                      {child.title}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* reason: onMutated absent means caller is in read-only context (e.g., unit test).
                  Pass write handlers only when the parent has registered a cache-invalidation
                  callback — this avoids mounting LinkAddSearch (with useQuery) in tests
                  that don't provide QueryClientProvider. SPEC-022 §9. */}
            <LinksPanel
              links={linkEntries}
              {...(onMutated !== undefined
                ? { onLinkAdd: handleLinkAdd, onLinkRemove: handleLinkRemove }
                : {})}
              isPending={isLinkPending}
            />
          </footer>
        </>
      )}

      {/* Conflict modal (shown on 409) */}
      {conflictError !== null && (
        <ConflictModal
          serverDoc={conflictError.current}
          myContent={conflictError.mine}
          diff={conflictError.diff}
          isPending={isForcing}
          onForceOverwrite={() => void handleForceOverwrite()}
          onClose={() => setConflictError(null)}
        />
      )}

      {/* Delete confirmation dialog (AC-DH-6) */}
      {isDeleteDialogOpen && (
        <DeleteConfirmDialog
          title={doc.title}
          isPending={isDeleting}
          onConfirm={() => void handleDelete()}
          onCancel={() => setIsDeleteDialogOpen(false)}
        />
      )}
    </article>
  );
}
