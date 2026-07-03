/**
 * HistoryTab — document version timeline with per-version diff modal.
 * Purpose: show version history for a document and allow viewing diffs (AC-DASH-WRITE-8).
 * Public surface: HistoryTab, HistoryTabProps
 * Invariants:
 *   - Fetches version log on mount via /api/docs/:id/log.
 *   - `apiGetVersionLog` resolves to a bare `VersionLogEntry[]` (server's
 *     `GET /api/docs/:id/log` returns `{ ok, data: VersionEntry[] }` — no `{versions,
 *     total}` wrapper). Do not reintroduce a `.versions` accessor here.
 *   - Diff modal is opened when user clicks a version's diff link.
 *   - Diff is fetched lazily (only when opened).
 *   - Renders a "no history" empty state when only 1 version exists.
 * Side-effect class: IO (fetch via useQuery)
 * Source: SPEC-022 §9.2, AC-DASH-WRITE-8
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGetVersionLog, apiGetVersionDiff } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { DiffView } from "@/components/DiffView";
import { X } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HistoryTabProps {
  /** Document ULID or slug. */
  docId: string;
}

// ─── Diff Modal ───────────────────────────────────────────────────────────────

interface DiffModalProps {
  docId: string;
  fromVersion: number;
  toVersion: number;
  onClose: () => void;
}

function DiffModal({ docId, fromVersion, toVersion, onClose }: DiffModalProps): React.ReactElement {
  const { data, isLoading, error } = useQuery({
    queryKey: ["diff", docId, fromVersion, toVersion],
    queryFn: () => apiGetVersionDiff(docId, { from: fromVersion, to: toVersion }),
  });

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Diff from v${fromVersion} to v${toVersion}`}
    >
      <div
        className="bg-background border rounded-lg shadow-xl max-w-3xl w-full max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold">
            Diff: v{fromVersion} → v{toVersion}
          </h3>
          <button onClick={onClose} type="button" className="p-1 rounded hover:bg-muted" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 overflow-auto flex-1">
          {isLoading && <Skeleton className="h-40 w-full" />}
          {error !== null && (
            <p className="text-sm text-destructive">Failed to load diff.</p>
          )}
          {data !== undefined && (
            data.content_diff.trim() === "" ? (
              <p className="text-sm text-muted-foreground">No content changes between these versions.</p>
            ) : (
              <DiffView diff={data.content_diff} className="whitespace-pre-wrap" />
            )
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Document version timeline. Each entry shows version number, action, author, and date.
 * Adjacent version pairs have a "diff" link that opens the DiffModal.
 *
 * @example
 * <HistoryTab docId={doc.id} />
 */
export function HistoryTab({ docId }: HistoryTabProps): React.ReactElement {
  const [diffVersions, setDiffVersions] = useState<{ from: number; to: number } | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["version-log", docId],
    queryFn: () => apiGetVersionLog(docId, { limit: 50 }),
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (error !== null) {
    return <p className="text-sm text-destructive">Failed to load version history.</p>;
  }

  if (data === undefined || data.length === 0) {
    return <p className="text-sm text-muted-foreground">No version history yet.</p>;
  }

  return (
    <>
      <div className="space-y-2">
        {data.map((entry, index) => {
          const prevEntry = data[index + 1];
          const hasDiff = prevEntry !== undefined;

          return (
            <div key={entry.version} className="flex items-start gap-3 py-2 border-b last:border-0">
              <div className="shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-mono">
                v{entry.version}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium capitalize">{entry.action}</span>
                  <span className="text-xs text-muted-foreground">{entry.created_by}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-muted-foreground">
                    {new Date(entry.created_at).toLocaleString()}
                  </span>
                </div>
                {entry.change_summary !== undefined && (
                  <p className="text-xs text-muted-foreground mt-1 truncate">{entry.change_summary}</p>
                )}
              </div>
              {hasDiff && (
                <button
                  className="shrink-0 text-xs text-primary hover:underline"
                  onClick={() => setDiffVersions({ from: prevEntry.version, to: entry.version })}
                  type="button"
                >
                  diff
                </button>
              )}
            </div>
          );
        })}
      </div>

      {diffVersions !== null && (
        <DiffModal
          docId={docId}
          fromVersion={diffVersions.from}
          toVersion={diffVersions.to}
          onClose={() => setDiffVersions(null)}
        />
      )}
    </>
  );
}
