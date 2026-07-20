/**
 * Pure decision helper backing DocDetail's If-Match version freeze (ASYNC2D-001).
 * Purpose: decide what "base version" a doc's next write (Save / status
 *   transition) should send as If-Match — either the latest server-observed
 *   version, or whatever was pinned when the current edit session began.
 * Public surface: resolveEditBaseVersion
 * Invariants:
 *   - While an edit session is open (isEditing === true), the base version is
 *     NEVER replaced by a fresher server value — TanStack Query's default
 *     refetchOnWindowFocus/refetchOnReconnect can silently pull a newer
 *     `doc.version` into DocDetail's props mid-edit (e.g. an alt-tab after
 *     >staleTime); the editor's content does not "catch up" to that fetch
 *     (by design — see DocDetail's editorSeed freeze), so the version used
 *     for the impending write must not either. Using the fresh version would
 *     make the CAS check pass against content the editor was never showing,
 *     silently overwriting whatever changed server-side instead of raising
 *     the 409 -> ConflictModal path.
 *   - While NOT editing, the base version tracks the latest known server
 *     version 1:1 — status transitions outside an edit session must keep
 *     seeing live version updates (e.g. after a prior transition's own
 *     refetch), or every second transition would 409 against itself.
 * Side-effect class: pure
 * Source: dashboard concurrency audit finding ASYNC2D-001
 */
export function resolveEditBaseVersion(params: {
  isEditing: boolean;
  latestServerVersion: number;
  currentBaseVersion: number;
}): number {
  if (params.isEditing) {
    return params.currentBaseVersion;
  }
  return params.latestServerVersion;
}
