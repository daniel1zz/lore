/**
 * ReadyTaskList — SPEC-077 S2 execution-page panel: one row per computed
 * readiness record for the selected plan's tasks.
 * Purpose: surface ready/blocked state, unmet blockers, evidence count, and a
 *   tri-state claim badge (fresh w/ TTL countdown, stale, or absent) for every
 *   task the SPEC-025/SPEC-042 `TaskWorkflowService.ready` report returns —
 *   the dashboard's first reachable view onto execution state that previously
 *   required the CLI (PRD §21 F3).
 * Public surface: ReadyTaskList, ReadyTaskListProps
 * Invariants:
 *   - PURE PROPS — all fetching lives in `ExecutionPage`; this component only
 *     renders the `ReadyRecord[]` + `claimTtlMinutes` it is handed.
 *   - Claim badge tri-state (AC-077-1): a FRESH claim renders the holder plus
 *     remaining minutes = `claimTtlMinutes - claim.age_minutes`, clamped at 0
 *     — never negative. A STALE claim renders the holder plus the literal
 *     label "stale" (its own badge, never merged into one string, so a test
 *     can assert on the exact literal). An ABSENT claim renders no badge at
 *     all — not an empty one.
 *   - The remaining-minutes countdown ticks CLIENT-SIDE off a 60s interval
 *     (no polling, no refetch) — `age_minutes` was fetched once; elapsed wall
 *     time since mount is added locally so the number counts down between
 *     fetches, per SPEC-077's cross-cutting Performance note.
 *   - Zero records renders an explicit empty state, never a blank list.
 * Side-effect class: pure (the ticking countdown's `setInterval` is a
 *   presentation-only timer, not IO — it never fetches).
 * Source: SPEC-077 §Scope S2, AC-077-1
 *
 * @example
 * <ReadyTaskList records={report.records} claimTtlMinutes={report.claim_ttl_minutes} onTaskClick={openDoc} />
 */

import { useEffect, useState } from "react";
import { getAllowedTransitions } from "@lore/core";
import type { ReadyRecord } from "@lore/core";
import { Badge } from "@/components/ui/badge";

export interface ReadyTaskListProps {
  /** Per-task computed readiness records (`ReadyReport.records`, `@lore/core`). */
  records: ReadyRecord[];
  /** Resolved `workflow.claim_ttl_minutes` — divides the fresh-claim countdown. */
  claimTtlMinutes: number;
  /** Called with the task's doc id when a row is clicked (drilldown to `/docs/$id`). */
  onTaskClick?: (docId: string) => void;
}

/** One tick interval for the client-side countdown (SPEC-077 "no polling" note). */
const TICK_MS = 60_000;

interface ClaimBadgeProps {
  claim: ReadyRecord["claim"];
  claimTtlMinutes: number;
}

/**
 * Tri-state claim badge (AC-077-1). Split out so its own `setInterval` effect
 * is scoped to one row, not the whole list.
 */
function ClaimBadge({ claim, claimTtlMinutes }: ClaimBadgeProps): React.ReactElement | null {
  const [elapsedTicks, setElapsedTicks] = useState(0);

  useEffect(() => {
    // reason: a stale or absent claim never counts down — only a fresh claim's
    // remaining-minutes figure needs a live timer.
    if (claim === undefined || claim.stale) return;
    const interval = setInterval(() => setElapsedTicks((n) => n + 1), TICK_MS);
    return () => clearInterval(interval);
  }, [claim]);

  if (claim === undefined) return null;

  if (claim.stale) {
    return (
      <span className="inline-flex items-center gap-1">
        <Badge variant="outline" className="text-xs font-mono">
          {claim.by}
        </Badge>
        <Badge variant="destructive" className="text-xs">
          stale
        </Badge>
      </span>
    );
  }

  const remaining = Math.max(0, claimTtlMinutes - claim.age_minutes - elapsedTicks);
  return (
    <span className="inline-flex items-center gap-1">
      <Badge variant="outline" className="text-xs font-mono">
        {claim.by}
      </Badge>
      <Badge variant="secondary" className="text-xs">
        {remaining}m left
      </Badge>
    </span>
  );
}

/**
 * The row's status badge, total over task statuses. A terminal status (no lifecycle edge
 * leaves it, per core's `getAllowedTransitions`) renders its own honest label: archived is
 * "done", every other terminal status (today: deprecated) renders its status name. Only a
 * non-terminal task is "ready" or "blocked", from `ready` (the server's `ready` is false for
 * every terminal task, which says nothing about being blocked).
 */
function readyBadgeLabel(record: ReadyRecord): string {
  const { status } = record.task;
  if (getAllowedTransitions(status).length === 0) return status === "archived" ? "done" : status;
  return record.ready ? "ready" : "blocked";
}

/**
 * @example
 * <ReadyTaskList records={records} claimTtlMinutes={120} />
 */
export function ReadyTaskList({ records, claimTtlMinutes, onTaskClick }: ReadyTaskListProps): React.ReactElement {
  if (records.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" aria-label="Ready tasks (empty)">
        No tasks in this plan.
      </p>
    );
  }

  return (
    <div className="space-y-2" aria-label="Ready tasks">
      {records.map((record) => {
        const badge = readyBadgeLabel(record);
        return (
        <div
          key={record.task.id}
          role="button"
          tabIndex={0}
          onClick={() => onTaskClick?.(record.task.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") onTaskClick?.(record.task.id);
          }}
          className="rounded-lg border p-3 space-y-1.5 cursor-pointer hover:bg-accent/50"
        >
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-medium truncate">{record.task.title}</span>
            <Badge variant={badge === "blocked" ? "outline" : "secondary"} className="text-xs">
              {badge}
            </Badge>
            <ClaimBadge claim={record.claim} claimTtlMinutes={claimTtlMinutes} />
            <span className="text-xs text-muted-foreground ml-auto shrink-0">
              {record.evidence_count} evidence
            </span>
          </div>
          {!record.ready && record.unmet_blockers.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Blocked by: {record.unmet_blockers.map((blocker) => blocker.slug).join(", ")}
            </p>
          )}
        </div>
        );
      })}
    </div>
  );
}
