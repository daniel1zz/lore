/**
 * AnchorConflictsPanel — SPEC-077 S2 execution-page panel: one row per
 * SPEC-042 D7 anchor-overlap advisory on the selected plan.
 * Purpose: surface `ReadyReport.anchor_conflicts` — a task declaring file
 *   anchors that overlap a DIFFERENT actor's fresh sibling claim — previously
 *   visible only via `lore ready --json`/gate-denial text, now reachable in
 *   the dashboard.
 * Public surface: AnchorConflictsPanel, AnchorConflictsPanelProps
 * Invariants:
 *   - PURE PROPS — no fetching; renders exactly the `AnchorConflict[]` it's
 *     given (`api.ts`'s hand-copied mirror of `task-workflow-service.ts`'s
 *     `AnchorConflict` — that type is lore-package-only, `@lore/dashboard`
 *     cannot import it directly).
 *   - Each row names BOTH parties in the conflict: the declaring task
 *     (`task_slug` — the task IN THIS REPORT whose anchors overlap) and the
 *     foreign `holder` (the fresh sibling claim colliding with it), plus the
 *     overlapping `paths`. `AnchorConflict` carries only one explicit holder
 *     field (`holder`) — the declaring task stands in as the conflict's other
 *     named party via its slug (see the type's own doc comment in `api.ts`).
 *   - Zero conflicts renders an explicit empty state, never a blank section.
 * Side-effect class: pure
 * Source: SPEC-077 §Scope S2, AC-077-2; SPEC-042 §Design Decisions D7
 *
 * @example
 * <AnchorConflictsPanel conflicts={report.anchor_conflicts} />
 */

import type { AnchorConflict } from "@/lib/api";

export interface AnchorConflictsPanelProps {
  /** Anchor-overlap advisories for the selected plan (`ReadyReport.anchor_conflicts`). */
  conflicts: AnchorConflict[];
}

/**
 * @example
 * <AnchorConflictsPanel conflicts={conflicts} />
 */
export function AnchorConflictsPanel({ conflicts }: AnchorConflictsPanelProps): React.ReactElement {
  if (conflicts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" aria-label="Anchor conflicts (empty)">
        No anchor conflicts.
      </p>
    );
  }

  return (
    <div className="space-y-1.5" aria-label="Anchor conflicts">
      {conflicts.map((conflict, index) => (
        <div key={index} className="text-sm border rounded p-2 space-y-1">
          <p>
            <span className="font-mono font-medium">{conflict.task_slug}</span>
            <span className="text-muted-foreground"> conflicts with </span>
            <span className="font-mono font-medium">{conflict.holder}</span>
          </p>
          <p className="text-xs text-muted-foreground font-mono">{conflict.paths.join(", ")}</p>
        </div>
      ))}
    </div>
  );
}
