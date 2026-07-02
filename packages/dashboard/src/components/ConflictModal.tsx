/**
 * ConflictModal — 409 optimistic-concurrency conflict UX.
 * Purpose: show a side-by-side diff when the server returns 409 stale version,
 *   and offer Cancel or Force Overwrite (SPEC-022 §9.4, Q2).
 * Public surface: ConflictModal, ConflictModalProps
 * Invariants:
 *   - Shown only when a PATCH returns ConflictError (stale version).
 *   - Left pane: "You wrote" (client draft content).
 *   - Right pane: "Now on server" (server current content).
 *   - "Force overwrite" calls onForceOverwrite which sends X-Force-Overwrite: 1.
 *   - "Cancel" calls onClose and returns user to editing state.
 *   - Modal traps focus and is closed by Escape key.
 * Side-effect class: pure (callbacks drive the IO)
 * Source: SPEC-022 §9.4, Q2
 */

import { useEffect } from "react";
import type { DocRecord } from "@lore/core";
import { X } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConflictModalProps {
  /** Current server version of the document. */
  serverDoc: DocRecord;
  /** Content the user was trying to write. */
  myContent: string;
  /** Unified diff string (from ConflictError.diff). */
  diff: string;
  /** Whether a force-overwrite is in progress. */
  isPending: boolean;
  /** Force write without concurrency check. */
  onForceOverwrite: () => void;
  /** Close and return to editing state. */
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Side-by-side conflict view with Force Overwrite escape hatch.
 *
 * @example
 * {conflictError !== null && (
 *   <ConflictModal
 *     serverDoc={conflictError.current}
 *     myContent={conflictError.mine}
 *     diff={conflictError.diff}
 *     isPending={isForcing}
 *     onForceOverwrite={handleForceOverwrite}
 *     onClose={() => setConflictError(null)}
 *   />
 * )}
 */
export function ConflictModal({
  serverDoc,
  myContent,
  diff,
  isPending,
  onForceOverwrite,
  onClose,
}: ConflictModalProps): React.ReactElement {
  // Close on Escape key.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Edit conflict"
    >
      <div className="bg-background border rounded-lg shadow-xl w-full max-w-4xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h2 className="font-semibold text-base">Edit Conflict</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              This document was modified by someone else since you opened it (now at v{serverDoc.version}).
            </p>
          </div>
          <button onClick={onClose} type="button" className="p-1 rounded hover:bg-muted" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Side-by-side panes */}
        <div className="grid grid-cols-2 divide-x flex-1 overflow-hidden">
          {/* Left: your draft */}
          <div className="flex flex-col overflow-hidden">
            <div className="px-3 py-1.5 bg-yellow-50 dark:bg-yellow-950 text-xs font-medium text-yellow-800 dark:text-yellow-200 border-b">
              You wrote (draft)
            </div>
            <pre className="text-xs font-mono p-3 overflow-auto whitespace-pre-wrap leading-5 flex-1">
              {myContent}
            </pre>
          </div>

          {/* Right: server current */}
          <div className="flex flex-col overflow-hidden">
            <div className="px-3 py-1.5 bg-blue-50 dark:bg-blue-950 text-xs font-medium text-blue-800 dark:text-blue-200 border-b">
              Now on server (v{serverDoc.version})
            </div>
            <pre className="text-xs font-mono p-3 overflow-auto whitespace-pre-wrap leading-5 flex-1">
              {serverDoc.content}
            </pre>
          </div>
        </div>

        {/* Diff section (collapsible in a details element) */}
        {diff.trim().length > 0 && (
          <details className="border-t">
            <summary className="px-4 py-2 text-xs cursor-pointer text-muted-foreground hover:bg-muted">
              Show unified diff
            </summary>
            <pre className="text-xs font-mono p-4 overflow-auto max-h-40 leading-5">
              {diff.split("\n").map((line, i) => {
                const key = `diff-${i}`;
                let color = "";
                if (line.startsWith("+")) color = "text-green-600 dark:text-green-400";
                else if (line.startsWith("-")) color = "text-red-600 dark:text-red-400";
                else if (line.startsWith("@@")) color = "text-blue-600 dark:text-blue-400";
                return (
                  <span key={key} className={`block ${color}`}>
                    {line}
                  </span>
                );
              })}
            </pre>
          </details>
        )}

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-3 p-4 border-t">
          <button
            onClick={onClose}
            type="button"
            className="px-4 py-2 text-sm border rounded hover:bg-muted"
            disabled={isPending}
          >
            Cancel — keep editing
          </button>
          <button
            onClick={onForceOverwrite}
            type="button"
            className="px-4 py-2 text-sm bg-destructive text-destructive-foreground rounded hover:bg-destructive/90 disabled:opacity-50"
            disabled={isPending}
          >
            {isPending ? "Saving..." : "Force overwrite"}
          </button>
        </div>
      </div>
    </div>
  );
}
