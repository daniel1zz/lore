/**
 * PhaseProgressPanel — SPEC-077 S2 execution-page panel: one scorecard per
 * phase on the selected plan.
 * Purpose: surface the NEW `GET /api/phase-status/:planIdOrSlug` route's
 *   per-phase projection (SPEC-077 S3, T1 sibling task) — attested-AC counts,
 *   checklist item states, dropped items, and the SPEC-056 §Design Decisions
 *   D3 anti-vacuous-completion flag — previously visible only via
 *   `lore phase status`.
 * Public surface: PhaseProgressPanel, PhaseProgressPanelProps
 * Invariants:
 *   - PURE PROPS — no fetching; renders exactly the `PhaseScorecard[]` it's
 *     given (`api.ts`'s SPEC-PINNED client type for the T1 route).
 *   - `ac_scope` renders as literal "a/b attested" text — `attested`/`total`
 *     come straight off the projection, never recomputed here.
 *   - Each checklist item's `state`/`trust_label` render VERBATIM (own
 *     badges) — this panel never re-derives "is this satisfied" or
 *     "manual vs attested" from lower-level fields; that math belongs to the
 *     server projection (mirrors the SPEC-075 evidence-panel convention).
 *   - A `vacuous` scorecard renders an explicit "vacuous" badge — no
 *     conditional suppression when the phase also happens to have zero
 *     blocking items (a phase declaring nothing to complete is never
 *     mistaken for "done").
 *   - Dropped item names render as their own labeled list, distinct from the
 *     checklist item rows above (a dropped item is excluded from the
 *     satisfied/blocking accounting, per `computePhaseCompletion`).
 *   - Zero phases renders an explicit empty state, never a blank section.
 * Side-effect class: pure
 * Source: SPEC-077 §Scope S2, AC-077-3; SPEC-056 §Design Decisions D3
 *
 * @example
 * <PhaseProgressPanel phases={phaseStatus.phases} />
 */

import type { PhaseScorecard } from "@/lib/api";
import { Badge } from "@/components/ui/badge";

export interface PhaseProgressPanelProps {
  /** Per-phase scorecards for the selected plan (`GET /api/phase-status/:plan`). */
  phases: PhaseScorecard[];
}

/**
 * @example
 * <PhaseProgressPanel phases={phases} />
 */
export function PhaseProgressPanel({ phases }: PhaseProgressPanelProps): React.ReactElement {
  if (phases.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" aria-label="Phase progress (empty)">
        This plan has no phases yet.
      </p>
    );
  }

  return (
    <div className="space-y-3" aria-label="Phase progress">
      {phases.map((phase) => (
        <div key={phase.name} className="rounded-lg border p-3 space-y-2" aria-label={`Phase ${phase.name}`}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{phase.name}</span>
            {phase.vacuous && (
              <Badge variant="outline" className="text-xs">
                vacuous
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              {phase.ac_scope.attested}/{phase.ac_scope.total} attested
            </span>
          </div>

          {phase.checklist.length > 0 && (
            <ul className="space-y-1" aria-label={`Checklist for ${phase.name}`}>
              {phase.checklist.map((item) => (
                <li key={item.id} className="flex items-center gap-1.5 text-xs flex-wrap">
                  <Badge variant="outline" className="text-xs">
                    {item.state}
                  </Badge>
                  <Badge variant="secondary" className="text-xs">
                    {item.trust_label}
                  </Badge>
                  <span className="text-muted-foreground truncate">{item.statement}</span>
                </li>
              ))}
            </ul>
          )}

          {phase.dropped_item_names.length > 0 && (
            <p className="text-xs text-muted-foreground" aria-label={`Dropped items for ${phase.name}`}>
              Dropped: {phase.dropped_item_names.join(", ")}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
