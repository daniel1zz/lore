/**
 * TaskEvidencePanel — Evidence-tab rendering for a `task` doc's projection
 * (SPEC-075 §Module Boundary D7, the `task` branch of `EvidencePanelProjection`).
 * Purpose: render the task's full verification-evidence timeline — newest
 *   first, mirroring `TaskExecution`'s existing ordering convention — with an
 *   explicit attested-vs-self-reported trust label per entry (the load-bearing
 *   distinction this whole workbench exists to surface, SPEC-039/SPEC-069) and
 *   an always-visible monospace `output_tail` panel.
 * Public surface: TaskEvidencePanel, TaskEvidencePanelProps
 * Invariants:
 *   - 1:1 with the core `TaskEvidencePanel` union member (`@lore/core`,
 *     `evidence-panel.ts`) — this component owns ONLY rendering, never
 *     re-derives coverage/attestation math (that stays in `@lore/core`).
 *   - "attested" is `entry.attestation !== undefined` — the SAME test
 *     `deriveAttestationSummary`/`summarizeForAdjudicationBar` use; never a
 *     second ad-hoc definition of "trustworthy evidence".
 *   - Zero evidence entries → an explicit empty state (AC-075-3), never a
 *     silently blank section — distinct copy from `TaskExecution`'s "renders
 *     nothing" convention because THIS component is the dedicated Evidence
 *     tab (an empty tab body reads as broken, unlike an optional footer
 *     section that legitimately has nothing to add).
 *   - `output_tail` renders unconditionally in a `<pre>` (monospace) block
 *     when present — no `<details>` collapse (unlike `TaskExecution`'s
 *     footer-section precedent): this IS the dedicated evidence view, so the
 *     command output is exactly what a reviewer came here to read.
 * Side-effect class: pure
 * Source: SPEC-075 §Module Boundary D7, AC-075-1, AC-075-3
 *
 * @example
 * <TaskEvidencePanel panel={{doc_type: "task", evidence: [...], ac_refs: ["AC-1"]}} />
 */

import type { TaskEvidencePanel as TaskEvidencePanelProjection } from "@lore/core";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime } from "@/lib/format-relative-time";

export interface TaskEvidencePanelProps {
  /** The `task` branch of `EvidencePanelProjection` (`@lore/core`, `evidence-panel.ts`). */
  panel: TaskEvidencePanelProjection;
}

/** Badge color for an evidence entry's oracle-verified result. */
function resultVariant(result: TaskEvidencePanelProjection["evidence"][number]["result"]): "secondary" | "destructive" | "outline" {
  if (result === "pass") return "secondary";
  if (result === "fail") return "destructive";
  return "outline"; // inconclusive
}

/**
 * @example
 * <TaskEvidencePanel panel={panel} />
 */
export function TaskEvidencePanel({ panel }: TaskEvidencePanelProps): React.ReactElement {
  if (panel.evidence.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" aria-label="Evidence timeline (empty)">
        No verification evidence recorded yet.
      </p>
    );
  }

  // reason: append-only storage order is oldest-first; the timeline reads newest-first
  // (mirrors TaskExecution.tsx's identical convention).
  const newestFirst = [...panel.evidence].reverse();

  return (
    <div className="space-y-2" aria-label="Evidence timeline">
      {newestFirst.map((entry, index) => {
        const isAttested = entry.attestation !== undefined;
        return (
          <div key={index} className="rounded-lg border p-3 space-y-1.5">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge variant="secondary" className="text-xs">
                {entry.oracle}
              </Badge>
              <Badge variant={resultVariant(entry.result)} className="text-xs">
                {entry.result}
              </Badge>
              {/* reason: the load-bearing trust distinction (SPEC-039/SPEC-069) — runner-
                  attested evidence vs a human's own self-reported claim. Same test
                  (`attestation !== undefined`) as deriveAttestationSummary/
                  summarizeForAdjudicationBar (`@lore/core`), never re-derived. */}
              <Badge variant={isAttested ? "default" : "outline"} className="text-xs">
                {isAttested ? "attested" : "self-reported"}
              </Badge>
              {entry.ac_ref !== undefined && (
                <Badge variant="outline" className="text-xs font-mono">
                  {entry.ac_ref}
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">{formatRelativeTime(entry.recorded_at)}</span>
              <span className="text-xs text-muted-foreground">{entry.recorded_by}</span>
            </div>
            <p className="text-xs font-mono text-muted-foreground break-all">{entry.command}</p>
            {entry.output_tail !== undefined && (
              <pre className="overflow-x-auto text-xs mt-1 bg-muted rounded p-2 font-mono whitespace-pre-wrap">
                {entry.output_tail}
              </pre>
            )}
          </div>
        );
      })}
    </div>
  );
}
