/**
 * ConfigConflictModal — 409 optimistic-concurrency conflict UX for a config
 * PATCH (SPEC-064 §Design D5). Sibling to `ConflictModal.tsx` (SPEC-022),
 * deliberately a SEPARATE component rather than a reuse of it: config has no
 * `DocRecord` and no unified diff (it's a tree of leaf values, not one text
 * blob), and the server offers no force-overwrite escape for either config
 * PATCH route (`config-routes.ts`'s module header: "no unconditional-write
 * path" is deliberate for config) — so this modal has only ONE resolving
 * action (adopt the fresh base and keep editing), never a "force overwrite"
 * button. Visual language (overlay, dialog chrome, header/footer layout) is
 * intentionally kept close to `ConflictModal` so both read as the same UX
 * pattern across the app.
 *
 * Public surface: ConfigConflictModal, ConfigConflictModalProps
 * Invariants:
 *   - Rendered ONLY on a `ConfigConflictError` catch — the underlying
 *     `PATCH /api/dashboard/config[/machine]` call that triggered it has
 *     ALREADY been rejected server-side before any write (SPEC-062 §Design:
 *     If-Match mismatch is checked before merge/validate/save) — this modal
 *     itself performs no IO; it only reports what already didn't happen and
 *     lets the caller decide how to proceed.
 *   - "Discard my changes" (`onDiscard`) and "Keep editing with fresh base"
 *     (`onAdoptFreshBase`) are the only two exits — no "force overwrite".
 *   - Escape key closes via `onDiscard` (same UX precedent as `ConflictModal`).
 * Side-effect class: pure (callbacks drive any IO)
 * Source: SPEC-064 §Design D5; SPEC-022 §9.4 (ConflictModal precedent)
 */

import { useEffect } from "react";
import { X } from "lucide-react";
import { getByPath } from "@/components/config-path-utils";

/** One config leaf the user had changed, shown alongside the server's fresh value. */
export interface ConfigConflictRow {
  path: string;
  label: string;
  mine: unknown;
}

/** Props for {@link ConfigConflictModal}. */
export interface ConfigConflictModalProps {
  /** "team" | "machine" — which scope's config conflicted. */
  scopeLabel: string;
  /** Fresh redacted config read at rejection time (`ConfigConflictError.currentConfig`). */
  currentConfig: unknown;
  /** Fresh hash (`ConfigConflictError.currentHash`) — informational only, the caller adopts it via `onAdoptFreshBase`. */
  currentHash: string;
  /** The rows the user had changed, with the value THEY attempted to write. */
  changedRows: readonly ConfigConflictRow[];
  /** Discard the in-flight edit entirely and exit editing mode. */
  onDiscard: () => void;
  /** Adopt the fresh base (config + hash) as the new edit baseline, keep editing. */
  onAdoptFreshBase: () => void;
}

function formatValue(value: unknown): string {
  if (value === undefined) return "(unset)";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * Config-conflict dialog — lists each key the user changed, showing what they
 * attempted versus what is now on the server, with no diff/force-overwrite
 * machinery (see module header for why this diverges from `ConflictModal`).
 */
export function ConfigConflictModal({
  scopeLabel,
  currentConfig,
  currentHash,
  changedRows,
  onDiscard,
  onAdoptFreshBase,
}: ConfigConflictModalProps): React.ReactElement {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") onDiscard();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onDiscard]);

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${scopeLabel} config edit conflict`}
      data-testid="config-conflict-modal"
    >
      <div className="bg-background border rounded-lg shadow-xl w-full max-w-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h2 className="font-semibold text-base">Edit Conflict — {scopeLabel} config</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              This config was changed by someone else since you loaded it. Nothing was written — your
              attempted change was rejected before touching the file.
            </p>
          </div>
          <button onClick={onDiscard} type="button" className="p-1 rounded hover:bg-muted" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-auto p-4 flex-1">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="pb-1 pr-2">Key</th>
                <th className="pb-1 pr-2">You attempted</th>
                <th className="pb-1">Now on server</th>
              </tr>
            </thead>
            <tbody>
              {changedRows.map((row) => (
                <tr key={row.path} className="border-t">
                  <td className="py-1 pr-2 font-mono">{row.path}</td>
                  <td className="py-1 pr-2 bg-yellow-50 dark:bg-yellow-950/40">{formatValue(row.mine)}</td>
                  <td className="py-1">{formatValue(getByPath(currentConfig, row.path))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[10px] text-muted-foreground mt-3">Fresh hash: {currentHash}</p>
        </div>

        <div className="flex items-center justify-end gap-3 p-4 border-t">
          <button
            onClick={onDiscard}
            type="button"
            className="px-4 py-2 text-sm border rounded hover:bg-muted"
          >
            Discard my changes
          </button>
          <button
            onClick={onAdoptFreshBase}
            type="button"
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90"
          >
            Keep editing (use latest)
          </button>
        </div>
      </div>
    </div>
  );
}
