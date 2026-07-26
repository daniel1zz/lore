/**
 * PhaseProgressPanel — SPEC-077 S2 execution-page panel: one scorecard per
 * phase on the selected plan.
 * Purpose: surface the `GET /api/phase-status/:planIdOrSlug` route's
 *   per-phase projection (SPEC-077 S3, T1; extended by
 *   `adr-planphasestatus-projects-declared-extra-phases-alongside` to project
 *   BOTH phase-authoring paths) — attested-AC counts, checklist item states,
 *   dropped items, the SPEC-056 §Design Decisions D3 anti-vacuous-completion
 *   flag, and declared-phase (`plan.extra.phases[]`) evidence/AC rollups —
 *   previously visible only via `lore phase status` / `lore phase list`.
 * Public surface: PhaseProgressPanel, PhaseProgressPanelProps
 * Invariants:
 *   - PURE PROPS — no fetching; renders exactly the `PlanPhaseEntry[]` it's
 *     given (`api.ts`'s discriminated union, mirroring
 *     `PhaseWorkflowService.planPhaseStatus`'s real response field-for-field —
 *     SPEC-077 T2 client-shape-drift fix, extended by the declared-phase ADR).
 *   - Each entry is dispatched on `source` — `"phase-doc"` renders the
 *     original scorecard (checklist, AC-scope attested/total, claim), never
 *     touching declared-only fields; `"declared"` renders a compact
 *     scorecard (title, task count, evidence pass/fail, AC coverage,
 *     orphaned flag) and NEVER reads `checklist_items`/`ac_scope`/`phase_id`
 *     — those fields don't exist on a `DeclaredPhaseScorecard` and reading
 *     them unconditionally is exactly the crash this component previously had
 *     (a `source: "declared"` entry has no `checklist_items`, so
 *     `phase.checklist_items.filter(...)` threw a TypeError at render time).
 *   - `ac_scope`/`ac_coverage` render straight off the projection, never
 *     recomputed here — `ac_coverage`'s per-AC state uses
 *     `deriveAcCoverageState` (`@lore/core`), the SAME fail-first precedence
 *     `SpecAcCoveragePanel` already uses, never a second ordering.
 *   - Each phase-doc checklist item's `state`/`trust` render VERBATIM (own
 *     badges) — this panel never re-derives "is this satisfied" or "manual
 *     vs attested" from lower-level fields; that math belongs to the server
 *     projection (mirrors the SPEC-075 evidence-panel convention).
 *   - A `vacuous` scorecard renders an explicit "vacuous" badge — no
 *     conditional suppression when the phase also happens to have zero
 *     blocking items (a phase declaring nothing to complete is never
 *     mistaken for "done").
 *   - A `declared` scorecard with `orphaned: true` renders an explicit
 *     "not declared on plan" warning badge — an orphaned task-phase
 *     reference is never silently indistinguishable from a normal one.
 *   - Dropped item names (phase-doc only) render as their own labeled list,
 *     distinct from the checklist item rows above. There is no
 *     `dropped_item_names` field on the real projection — names are DERIVED
 *     here from `checklist_items` entries whose `state === "dropped"` (a
 *     dropped item is excluded from the satisfied/blocking accounting, per
 *     `computePhaseCompletion`).
 *   - React key: `phase-doc` entries key by `phase_id` (stable doc id);
 *     `declared` entries have no doc id, so they key by
 *     `` `declared:${phase_title}` `` — `phase_title` is unique within one
 *     plan's projection (mirrors `plan.extra.phases[].name` uniqueness).
 *   - Zero phases renders an explicit empty state, never a blank section. The
 *     copy is "This plan has no phases." — truthful again now that BOTH
 *     phase-authoring paths (phase docs AND declared `extra.phases[]`)
 *     project into this array; the prior "No phase documents for this plan."
 *     copy predates the declared-phase ADR and was itself only ever a
 *     half-truth (see the ADR's Context section, ISSUE-007).
 * Side-effect class: pure
 * Source: SPEC-077 §Scope S2, AC-077-3; SPEC-056 §Design Decisions D3;
 *   adr-planphasestatus-projects-declared-extra-phases-alongside
 *
 * @example
 * <PhaseProgressPanel phases={phaseStatus.phases} />
 */

import { deriveAcCoverageState } from "@lore/core";
import type { DeclaredPhaseScorecard, PhaseScorecard, PlanPhaseEntry } from "@/lib/api";
import { Badge } from "@/components/ui/badge";

export interface PhaseProgressPanelProps {
  /** Per-phase scorecards for the selected plan (`GET /api/phase-status/:plan`) — mixed phase-doc/declared entries. */
  phases: PlanPhaseEntry[];
}

/**
 * Derives the dropped-item statement list for one phase-doc scorecard from
 * its `checklist_items` — the real projection has no standalone
 * `dropped_item_names` field (see this module's header comment).
 *
 * @param phase - One phase-doc scorecard.
 * @returns Statements of every `checklist_items` entry whose `state === "dropped"`.
 */
function droppedItemNames(phase: PhaseScorecard): string[] {
  return phase.checklist_items.filter((item) => item.state === "dropped").map((item) => item.statement);
}

/** Renders one SPEC-056 phase-DOC scorecard — the original, unchanged rendering. */
function PhaseDocScorecard({ phase }: { phase: PhaseScorecard }): React.ReactElement {
  const dropped = droppedItemNames(phase);
  return (
    <div className="rounded-lg border p-3 space-y-2" aria-label={`Phase ${phase.phase_title}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium">{phase.phase_title}</span>
        {phase.vacuous && (
          <Badge variant="outline" className="text-xs">
            vacuous
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">
          {phase.ac_scope.attested}/{phase.ac_scope.total} attested
        </span>
      </div>

      {phase.checklist_items.length > 0 && (
        <ul className="space-y-1" aria-label={`Checklist for ${phase.phase_title}`}>
          {phase.checklist_items.map((item) => (
            <li key={item.id} className="flex items-center gap-1.5 text-xs flex-wrap">
              <Badge variant="outline" className="text-xs">
                {item.state}
              </Badge>
              <Badge variant="secondary" className="text-xs">
                {item.trust}
              </Badge>
              <span className="text-muted-foreground truncate">{item.statement}</span>
            </li>
          ))}
        </ul>
      )}

      {dropped.length > 0 && (
        <p className="text-xs text-muted-foreground" aria-label={`Dropped items for ${phase.phase_title}`}>
          Dropped: {dropped.join(", ")}
        </p>
      )}
    </div>
  );
}

/**
 * Renders one SPEC-023 DECLARED phase scorecard — compact rendering, no
 * checklist section (declared phases have none). AC-coverage summary is
 * derived ONLY from `phase.ac_coverage` via `deriveAcCoverageState` — never
 * recomputed locally.
 */
function DeclaredScorecard({ phase }: { phase: DeclaredPhaseScorecard }): React.ReactElement {
  return (
    <div className="rounded-lg border p-3 space-y-2" aria-label={`Phase ${phase.phase_title}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium">{phase.phase_title}</span>
        <Badge variant="outline" className="text-xs">
          declared
        </Badge>
        {phase.orphaned && (
          <Badge variant="destructive" className="text-xs">
            not declared on plan
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">
          {phase.task_count} task{phase.task_count === 1 ? "" : "s"}
        </span>
      </div>

      <div className="flex items-center gap-2 flex-wrap text-xs">
        <Badge variant="secondary" className="text-xs">
          {phase.evidence.pass} pass
        </Badge>
        <Badge variant={phase.evidence.fail > 0 ? "destructive" : "secondary"} className="text-xs">
          {phase.evidence.fail} fail
        </Badge>
      </div>

      {phase.ac_coverage.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={`AC coverage for ${phase.phase_title}`}>
          {phase.ac_coverage.map((fact) => (
            <li key={fact.ac_id} className="text-xs">
              <Badge variant="outline" className="text-xs font-mono">
                {fact.ac_id}: {deriveAcCoverageState(fact)}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * @example
 * <PhaseProgressPanel phases={phases} />
 */
export function PhaseProgressPanel({ phases }: PhaseProgressPanelProps): React.ReactElement {
  if (phases.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" aria-label="Phase progress (empty)">
        This plan has no phases.
      </p>
    );
  }

  return (
    <div className="space-y-3" aria-label="Phase progress">
      {phases.map((phase) =>
        phase.source === "phase-doc" ? (
          <PhaseDocScorecard key={phase.phase_id} phase={phase} />
        ) : (
          <DeclaredScorecard key={`declared:${phase.phase_title}`} phase={phase} />
        ),
      )}
    </div>
  );
}
