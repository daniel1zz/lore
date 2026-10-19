/**
 * TaskExecution — task-detail Execution section (SPEC-037 D3).
 * Purpose: renders the advisory claim lease and the oracle-evidence timeline
 *   for a task doc, above PARENT/RELATED in `DocDetail`'s footer.
 * Public surface: TaskExecution, TaskExecutionProps
 * Invariants:
 *   - Parses `task.extra` via `readClaimRecord`/`extractEvidence`
 *     (`@lore/core`, `task-workflow.ts`) — both already `safeParse`-guard
 *     malformed/legacy `extra` and degrade to `undefined`/`[]` rather than
 *     throwing. Reused here (not re-implemented) so this component never
 *     hand-rolls a second zod-parsing rule for the same fields the SPEC-025
 *     service layer and SPEC-036 `deriveTypeMeta` already parse.
 *   - Renders NOTHING (returns `null`) when there is neither a claim nor any
 *     evidence — covers both "never claimed/evidenced" and "extra is
 *     malformed" (AC-37-5's "legacy task with malformed extra renders no
 *     Execution section, no error" — both degrade to the same empty state).
 *   - No client-side staleness computation — `claim.stale`/`age_minutes` are
 *     NOT rendered here (no TTL available client-side, SPEC-036 precedent);
 *     the `(stale)` marker only ever appears in list surfaces that get it
 *     from server-computed `meta`/`ReadyRecord`.
 *   - Evidence entries render newest-first (the stored array is append-only,
 *     oldest-first) — reversed once, not re-sorted per render.
 *   - A `fail` result renders the destructive Badge variant (the same
 *     "danger color" rule as `metaBadgeVariant`, applied directly here since
 *     evidence entries aren't `DocTypeMeta` — they ARE the source data
 *     `deriveTypeMeta` counts up); `pass` renders `secondary`; `expected-fail`/
 *     `inconclusive` render the neutral `outline` variant (mirrors
 *     `TaskEvidencePanel.tsx::resultVariant`'s identical 3-way rule) — NEVER
 *     `destructive`, which would mischaracterize a deliberate RED pin or an
 *     ambiguous runner outcome as an alarming genuine failure
 *     (task-two-more-evidence-consumers-erase-an-expected-fail-row-doc,
 *     found during that task's exhaustive consumer audit — this component
 *     never dropped the raw `result` text, but its old bare
 *     `result === "pass" ? secondary : destructive` ternary painted both
 *     non-green values the same alarming red as a real failure).
 * Side-effect class: pure (renders received data; no IO of its own)
 * Source: SPEC-037 §1 D3, AC-37-5, AC-37-6
 */

import type { DocRecord } from "@lore/core";
import { readClaimRecord, extractEvidence } from "@lore/core";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime } from "@/lib/format-relative-time";

export interface TaskExecutionProps {
  /** The full task `DocRecord` (raw `extra` — this component does its own parsing). */
  task: DocRecord;
}

/**
 * @example
 * <TaskExecution task={doc} />
 */
export function TaskExecution({ task }: TaskExecutionProps): React.ReactElement | null {
  const claim = readClaimRecord(task);
  const evidence = extractEvidence(task);

  if (claim === undefined && evidence.length === 0) {
    return null;
  }

  // reason: append-only storage order is oldest-first; the timeline reads newest-first.
  const newestFirst = [...evidence].reverse();

  return (
    <section aria-label="Execution" className="space-y-4">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Execution</p>

      {claim !== undefined && (
        <div className="rounded-lg border p-3 space-y-1" aria-label="Claim">
          <p className="text-sm">
            Claimed by <span className="font-medium">{claim.by}</span>
          </p>
          {claim.branch !== undefined && (
            <p className="text-xs font-mono text-muted-foreground">{claim.branch}</p>
          )}
          <p className="text-xs text-muted-foreground">{formatRelativeTime(claim.at)}</p>
        </div>
      )}

      {newestFirst.length > 0 && (
        <div className="space-y-2" aria-label="Evidence timeline">
          {newestFirst.map((entry, index) => (
            <div key={index} className="rounded-lg border p-3 space-y-1.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <Badge variant="secondary" className="text-xs">
                  {entry.oracle}
                </Badge>
                <Badge
                  variant={
                    entry.result === "pass" ? "secondary" : entry.result === "fail" ? "destructive" : "outline"
                  }
                  className="text-xs"
                >
                  {entry.result}
                </Badge>
                <span className="text-xs text-muted-foreground">{formatRelativeTime(entry.recorded_at)}</span>
                <span className="text-xs text-muted-foreground">{entry.recorded_by}</span>
              </div>
              <p className="text-xs font-mono text-muted-foreground break-all">{entry.command}</p>
              {entry.output_tail !== undefined && (
                <details>
                  <summary className="text-xs text-muted-foreground cursor-pointer">Output</summary>
                  <pre className="overflow-x-auto text-xs mt-1 bg-muted rounded p-2">{entry.output_tail}</pre>
                </details>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
