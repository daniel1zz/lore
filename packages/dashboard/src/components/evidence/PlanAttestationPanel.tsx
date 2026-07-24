/**
 * PlanAttestationPanel — Evidence-tab rendering for a `plan` doc's projection
 * (SPEC-075 §Module Boundary D7, the `plan` branch of `EvidencePanelProjection`).
 * Purpose: render the plan-wide attestation-ratio summary (the same two
 *   conditions `gate-predicates.ts::attestationFloor` gates `plan-close` on,
 *   SPEC-069) plus per-task attestation facts, so a reviewer can see WHY a
 *   plan is blocked, not just THAT it is.
 * Public surface: PlanAttestationPanel, PlanAttestationPanelProps
 * Invariants:
 *   - 1:1 with the core `PlanEvidencePanel` union member — rendering only, no
 *     local ratio math (`deriveAttestationSummary`/`buildTaskAttestationInfos`
 *     own that, `@lore/core`).
 *   - `attestation.ratio === null` (the vacuous-pass "no evidence anywhere"
 *     case) renders an EXPLICIT "not applicable" copy — NEVER "0%". A
 *     fabricated 0% would misleadingly read as "every entry failed
 *     attestation" when the true state is "nothing has been verified yet".
 *   - `zero_attested_tasks` (per-task floor condition 1 failures) renders as
 *     its own labeled list — the SAME slugs the `plan-close` gate's feeding
 *     pack names, so a reviewer sees exactly which tasks to fix.
 *   - Zero task children → an explicit empty state (AC-075-3), distinct from
 *     "zero evidence on existing tasks" (which renders the vacuous-pass
 *     ratio:null copy above, not this empty state).
 * Side-effect class: pure
 * Source: SPEC-075 §Module Boundary D7, AC-075-2, AC-075-3; SPEC-069 §Design
 *   Decisions D1 (attestationFloor, the gate this panel explains)
 *
 * @example
 * <PlanAttestationPanel panel={{doc_type: "plan", attestation: {...}, tasks: [...]}} />
 */

import type { PlanEvidencePanel as PlanEvidencePanelProjection } from "@lore/core";
import { Badge } from "@/components/ui/badge";

export interface PlanAttestationPanelProps {
  /** The `plan` branch of `EvidencePanelProjection` (`@lore/core`, `evidence-panel.ts`). */
  panel: PlanEvidencePanelProjection;
}

/** Formats `AttestationSummary.ratio` — `null` renders as explicit vacuous copy, never "0%". */
function formatRatio(ratio: number | null): string {
  if (ratio === null) return "not applicable — no evidence recorded yet";
  return `${Math.round(ratio * 100)}%`;
}

/**
 * @example
 * <PlanAttestationPanel panel={panel} />
 */
export function PlanAttestationPanel({ panel }: PlanAttestationPanelProps): React.ReactElement {
  if (panel.tasks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" aria-label="Attestation summary (empty)">
        This plan has no task children yet.
      </p>
    );
  }

  const { attestation } = panel;

  return (
    <div className="space-y-3" aria-label="Attestation summary">
      <div className="rounded-lg border p-3 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={attestation.meets_floor ? "secondary" : "destructive"} className="text-xs">
            {attestation.meets_floor ? "meets floor" : "below floor"}
          </Badge>
          <span className="text-sm">
            Attested ratio: <span className="font-medium">{formatRatio(attestation.ratio)}</span>
          </span>
          <span className="text-xs text-muted-foreground">(floor {Math.round(attestation.min_ratio * 100)}%)</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {attestation.attested} / {attestation.total_evidence} evidence entries attested
        </p>
        {attestation.zero_attested_tasks.length > 0 && (
          <div aria-label="Zero-attested tasks">
            <p className="text-xs font-medium text-destructive">Tasks with unattested evidence:</p>
            <ul className="list-disc list-inside text-xs text-muted-foreground">
              {attestation.zero_attested_tasks.map((slug) => (
                <li key={slug} className="font-mono">
                  {slug}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="space-y-1.5" aria-label="Per-task attestation">
        {panel.tasks.map((task) => (
          <div key={task.slug} className="flex items-center justify-between gap-2 text-xs border rounded p-2">
            <span className="truncate">{task.title}</span>
            <span className="text-muted-foreground shrink-0">
              {task.attestedCount} / {task.evidenceCount} attested
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
