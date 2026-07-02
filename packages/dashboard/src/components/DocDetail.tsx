/**
 * DocDetail — full document view with read + write modes.
 * Purpose: renders the complete doc view; adds edit mode, status transitions,
 *   editable links, and history tab when the server is authenticated (SPEC-022).
 * Public surface: DocDetail, DocDetailProps
 * Invariants:
 *   - Edit mode is toggled by the "Edit" button; shows CodeMirror editor.
 *   - Save triggers PATCH with If-Match (optimistic concurrency); 409 → ConflictModal.
 *   - Status transitions go through the appropriate dashboard endpoint
 *     (approve → /approve, reject → /reject, other → PATCH status field).
 *   - Links panel shows related docs with add/remove affordances.
 *   - History tab loads lazily when the "History" tab is clicked.
 *   - Draft content is restored from localStorage on mount if version matches.
 *   - onMutated is called after every successful write; the caller is responsible
 *     for cache invalidation (inversion-of-control avoids needing QueryClientProvider
 *     in unit tests). SPEC-022 §9.
 *   - `editorSeed` (not `editContent`) is passed as Editor's `initialValue`.
 *     `editContent` updates on every keystroke; feeding it back into `initialValue`
 *     would re-trigger CodeMirror's mount effect per keystroke, destroying and
 *     recreating the view mid-edit (loses focus, resets cursor to doc start,
 *     scrambles typed input). `editorSeed` is set only when a new edit session
 *     starts (Edit button click).
 * Side-effect class: IO (fetch, localStorage)
 * Source: SPEC-015, SPEC-022 §9.2
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
import { ConflictModal } from "@/components/ConflictModal";
import { saveDraft, loadDraft, clearDraft, isDraftStale } from "@/store/draft";
import type { DocWithNavigation } from "@/lib/api";
import type { DocStatus, LinkType } from "@lore/core";
import {
  apiPatchDoc,
  apiApproveDoc,
  apiRejectDoc,
  apiCreateLink,
  apiDeleteLink,
  ConflictError,
  DashboardApiError,
} from "@/api/mutations";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DocDetailProps {
  /** Document with navigation context from the API. */
  docWithNav: DocWithNavigation;
  /** Called when the user clicks on a sibling/related doc ID. */
  onNavigate?: (idOrSlug: string) => void;
  /**
   * Called after any successful write (save/approve/reject/link).
   * Caller should invalidate query cache for this doc and related lists.
   * Decoupled here so DocDetail works in tests without QueryClientProvider.
   */
  onMutated?: () => void;
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

type ActiveTab = "content" | "history";

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
 *   onMutated={() => queryClient.invalidateQueries({ queryKey: ["doc", doc.id] })}
 * />
 */
export function DocDetail({ docWithNav, onNavigate, onMutated }: DocDetailProps): React.ReactElement {
  const { doc, navigation } = docWithNav;

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
        await apiPatchDoc(doc.id, { status: toStatus });
        toast.success(`Status → ${toStatus}`);
      }
      onMutated?.();
    } catch (err) {
      const message = err instanceof DashboardApiError ? err.message : "Transition failed";
      toast.error(message);
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

  // ── Link entries from navigation ─────────────────────────────────────────────
  const linkEntries = navigation.related.map((r) => ({
    to_id: r.id,
    title: r.title,
    link_type: r.link_type as LinkType,
  }));

  return (
    <article className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <header>
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
            {doc.tags !== undefined && doc.tags.length > 0 && (
              <TableRow>
                <TableCell className="font-medium">Tags</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {doc.tags.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>

      <Separator />

      {/* Tab switcher */}
      <div className="flex gap-4 border-b">
        {(["content", "history"] as ActiveTab[]).map((tab) => (
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
          <HistoryTab docId={doc.id} />
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
    </article>
  );
}
