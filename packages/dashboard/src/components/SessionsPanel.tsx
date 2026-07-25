/**
 * SessionsPanel — SPEC-077 S2 execution-page panel: one row per derived
 * session on the selected plan.
 * Purpose: surface `ReadyReport.sessions` (SPEC-042 D7's `(by, machine,
 *   worktree)`-grouped fresh claims) — previously visible only via
 *   `lore ready --json`/`lore bootstrap`, now reachable in the dashboard.
 * Public surface: SessionsPanel, SessionsPanelProps
 * Invariants:
 *   - PURE PROPS — no fetching; renders exactly the `ReadySession[]` it's given.
 *   - One row per session, showing the held-task count (`task_slugs.length`)
 *     — never the task slugs themselves (this panel is a session ROSTER, not
 *     a task list; `ReadyTaskList` is the per-task drilldown).
 *   - Zero sessions renders an explicit "no active sessions" empty state
 *     (SPEC-077 §Scope S2), never a blank section.
 * Side-effect class: pure
 * Source: SPEC-077 §Scope S2, AC-077-2
 *
 * @example
 * <SessionsPanel sessions={report.sessions} />
 */

import type { ReadySession } from "@lore/core";

export interface SessionsPanelProps {
  /** Derived sessions for the selected plan (`ReadyReport.sessions`, `@lore/core`). */
  sessions: ReadySession[];
}

/**
 * @example
 * <SessionsPanel sessions={sessions} />
 */
export function SessionsPanel({ sessions }: SessionsPanelProps): React.ReactElement {
  if (sessions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" aria-label="Sessions (empty)">
        No active sessions.
      </p>
    );
  }

  return (
    <div className="space-y-1.5" aria-label="Sessions">
      {sessions.map((session, index) => (
        <div key={index} className="flex items-center justify-between gap-2 text-sm border rounded p-2">
          <div className="flex flex-col min-w-0">
            <span className="font-medium font-mono truncate">{session.by}</span>
            <span className="text-xs text-muted-foreground truncate">
              {session.machine ?? "unknown machine"}
              {session.worktree !== undefined ? ` · ${session.worktree}` : ""}
            </span>
          </div>
          <span className="text-xs text-muted-foreground shrink-0">
            {session.task_slugs.length} held
          </span>
        </div>
      ))}
    </div>
  );
}
