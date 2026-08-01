/**
 * PlanAttestationPanel — Evidence-tab rendering for a `plan` doc's projection
 * (SPEC-075 §Module Boundary D7, the `plan` branch of `EvidencePanelProjection`).
 * Purpose: render the plan-wide attestation-ratio summary AND the declared-scope
 *   coverage conjunct — the SAME conjuncts `gate-predicates.ts::attestationFloor`
 *   gates `plan-close` on (SPEC-069; spec-declared-scope-attestation-contract-
 *   task-owned-ac-scope §Facts D4) — plus per-task attestation facts, so a
 *   reviewer can see WHY a plan is blocked, not just THAT it is.
 * Public surface: PlanAttestationPanel, PlanAttestationPanelProps
 * Invariants:
 *   - 1:1 with the core `PlanEvidencePanel` union member — rendering only, no
 *     local ratio/coverage math (`deriveAttestationSummary`/
 *     `buildTaskAttestationInfos`/`deriveDeclaredScopeCoverage`/
 *     `declaredScopeCoverageVerdict` own that, `@lore/core`, all computed
 *     upstream by `VerificationProjectionService`).
 *   - `derivePlanAttestationBadgeState` (task-meets-floor-renders-pass-while-
 *     the-declared-scope-conjunct) is the ONE place that combines
 *     `attestation.meets_floor` (the RATIO conjunct ALONE — see its own
 *     `@lore/core` doc comment) with `declared_scope_verdict` (the DECLARED-
 *     scope conjunct) into the primary badge's THREE-valued state: `"meets
 *     floor"` / `"below floor"` / `"scope undeclared"`. This is a precedence
 *     PICK over two already-resolved facts (mirrors `formatRatio`/`formatFloor`
 *     below, and `attestationFloor`'s own FAIL > NOT-APPLICABLE > PASS
 *     ordering) — NOT a ratio/coverage re-derivation. `"scope undeclared"` is
 *     a GENUINELY THIRD state: it must never collapse into `"meets floor"`
 *     (the exact defect this component exists to remove) NOR into `"below
 *     floor"` (an escalation this component does not attempt — see that
 *     function's own doc comment).
 *   - `attestation.ratio === null` (the vacuous-pass "no evidence anywhere"
 *     case) renders an EXPLICIT "not applicable" copy — NEVER "0%". A
 *     fabricated 0% would misleadingly read as "every entry failed
 *     attestation" when the true state is "nothing has been verified yet".
 *   - `attestation.min_ratio === null` (spec-plan-close-predicates-measure-
 *     invariants-an-applicability §D4 — the ratio conjunct UNCONFIGURED)
 *     renders the literal text "ratio conjunct disabled" — NEVER a fabricated
 *     "0%" (would read as "0% required") or "50%" (would claim an enforcement
 *     that is not happening).
 *   - `zero_attested_tasks` (per-task floor condition 1 failures) renders as
 *     its own labeled list — the SAME slugs the `plan-close` gate's feeding
 *     pack names, so a reviewer sees exactly which tasks to fix.
 *   - `claimed_ac_coverage.unattested_acs` (§D3 condition 2 failures, EXERCISED
 *     scope) renders as its own labeled list, mirroring `zero_attested_tasks`.
 *   - `declared_scope_coverage.unattested_acs` (the DECLARED-scope conjunct's
 *     own failures) renders as a SEPARATE labeled list — deliberately never
 *     merged with `claimed_ac_coverage`'s list: the two are INDEPENDENT facts
 *     (`@lore/core`'s `evidence-panel.ts` module header) that can legitimately
 *     disagree, and merging them would hide that disagreement.
 *   - `declared_scope_verdict.notApplicable === true` renders an explicit
 *     "nothing declared yet" notice, INDEPENDENTLY of the primary badge's own
 *     precedence (so a reviewer still sees the undeclared-scope fact even when
 *     a failing ratio already won the badge's precedence pick).
 *   - Zero task children → an explicit empty state (AC-075-3), distinct from
 *     "zero evidence on existing tasks" (which renders the vacuous-pass
 *     ratio:null copy above, not this empty state).
 * Side-effect class: pure
 * Source: SPEC-075 §Module Boundary D7, AC-075-2, AC-075-3; SPEC-069 §Design
 *   Decisions D1 (attestationFloor, the gate this panel explains);
 *   spec-plan-close-predicates-measure-invariants-an-applicability §D3
 *   (per-claimed-AC coverage), §D4 (ratio conjunct default flip);
 *   spec-declared-scope-attestation-contract-task-owned-ac-scope §Facts D4
 *   (the exercised/declared split); task-meets-floor-renders-pass-while-the-
 *   declared-scope-conjunct (this file's three-state badge fix)
 *
 * @example
 * <PlanAttestationPanel panel={{doc_type: "plan", attestation: {...}, tasks: [...], declared_scope_coverage: {...}, declared_scope_verdict: {ok: true}}} />
 */

import type {
  DeclaredScopeCoverageVerdict,
  PlanEvidencePanel as PlanEvidencePanelProjection,
} from "@lore/core";
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
 * Formats `AttestationSummary.min_ratio` — `null` (the conjunct is unconfigured,
 * §D4) renders the literal, standalone text "ratio conjunct disabled" (no
 * surrounding punctuation, so an exact-text query matches it directly), never a
 * fabricated "0%" or a numeric floor that implies an enforcement that is not
 * happening.
 */
function formatFloor(minRatio: number | null): string {
  if (minRatio === null) return "ratio conjunct disabled";
  return `floor ${Math.round(minRatio * 100)}%`;
}

/** The primary badge's three-valued state (task-meets-floor-renders-pass-while-the-declared-scope-conjunct). */
type PlanAttestationBadgeState = "meets-floor" | "below-floor" | "scope-undeclared";

/**
 * Combines the RATIO conjunct (`attestation.meets_floor`) with the
 * DECLARED-scope conjunct's verdict (`declared_scope_verdict`) into the ONE
 * state this panel's primary badge renders. Neither conjunct alone is the
 * `plan-close` gate's verdict: `meets_floor` carries ONLY the ratio conjunct
 * (`AttestationSummary.meets_floor`'s own `@lore/core` doc comment), and the
 * gate ANDs it with the declared-scope conjunct
 * (`gate-predicates.ts::attestationFloor`). This function is the ONE place
 * that combination happens for this panel, so no render call site re-derives
 * a (possibly diverging) rule of its own.
 *
 * NOT a ratio/coverage re-derivation — both inputs are ALREADY-resolved facts
 * handed down by `VerificationProjectionService`; this is a precedence PICK
 * over two enums, the same class of decision `formatRatio`/`formatFloor`
 * above already make locally in this file.
 *
 * Precedence mirrors `attestationFloor`'s own ordering (gate-predicates.ts):
 * a measured FAILURE (either conjunct) outranks the undeclared-scope
 * not-applicable, which outranks a pass — an undeclared scope must never mask
 * a genuinely failing ratio, and a passing ratio must never paper over an
 * undeclared scope. `"scope-undeclared"` deliberately does NOT escalate to
 * `"below-floor"` even when the gate's OWN full predicate would eventually
 * deny for that same undeclared scope (task-plan-close-must-block-when-the-
 * coverage-conjunct-is-scope) — that escalation depends on a THIRD fact
 * (whether the spec declares any script-mode AC at all) this panel does not
 * have, and the governing task for this fix explicitly forbids collapsing the
 * third state into either pass or fail.
 *
 * @param meetsFloor - `AttestationSummary.meets_floor` — the RATIO conjunct alone.
 * @param declaredScopeVerdict - `declaredScopeCoverageVerdict`'s verdict over
 *   the plan's `DeclaredScopeCoverage` (`panel.declared_scope_verdict`).
 * @returns `"below-floor"` when either conjunct measurably fails,
 *   `"scope-undeclared"` when neither measurably fails but the declared-scope
 *   conjunct is not-applicable, `"meets-floor"` when both conjuncts pass.
 * @example
 * derivePlanAttestationBadgeState(true, { ok: true }); // => "meets-floor"
 * @example
 * derivePlanAttestationBadgeState(true, { notApplicable: true, reason: "scope-undeclared", referent: "plan-x" });
 * // => "scope-undeclared" — NEVER "meets-floor"
 * @example
 * derivePlanAttestationBadgeState(false, { ok: true }); // => "below-floor"
 * @example
 * derivePlanAttestationBadgeState(true, { ok: false, unattested_acs: ["AC-1"] }); // => "below-floor"
 */
function derivePlanAttestationBadgeState(
  meetsFloor: boolean,
  declaredScopeVerdict: DeclaredScopeCoverageVerdict,
): PlanAttestationBadgeState {
  if (!meetsFloor) return "below-floor";
  if ("ok" in declaredScopeVerdict && !declaredScopeVerdict.ok) return "below-floor";
  if (!("ok" in declaredScopeVerdict)) return "scope-undeclared";
  return "meets-floor";
}

/** Badge copy/variant per {@link PlanAttestationBadgeState} — the ONE definition site (never inline ternaries at the render call site). */
const BADGE_COPY: Record<PlanAttestationBadgeState, { readonly text: string; readonly variant: "secondary" | "destructive" | "outline" }> = {
  "meets-floor": { text: "meets floor", variant: "secondary" },
  "below-floor": { text: "below floor", variant: "destructive" },
  "scope-undeclared": { text: "scope undeclared", variant: "outline" },
};

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

  const { attestation, declared_scope_coverage: declaredScopeCoverage, declared_scope_verdict: declaredScopeVerdict } = panel;
  const badgeState = derivePlanAttestationBadgeState(attestation.meets_floor, declaredScopeVerdict);
  const badge = BADGE_COPY[badgeState];

  return (
    <div className="space-y-3" aria-label="Attestation summary">
      <div className="rounded-lg border p-3 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={badge.variant} className="text-xs">
            {badge.text}
          </Badge>
          <span className="text-sm">
            Attested ratio: <span className="font-medium">{formatRatio(attestation.ratio)}</span>
          </span>
          <span className="text-xs text-muted-foreground">{formatFloor(attestation.min_ratio)}</span>
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
        {attestation.claimed_ac_coverage.unattested_acs.length > 0 && (
          <div aria-label="Unattested claimed acceptance criteria">
            <p className="text-xs font-medium text-destructive">Claimed acceptance criteria with no attested evidence:</p>
            <ul className="list-disc list-inside text-xs text-muted-foreground">
              {attestation.claimed_ac_coverage.unattested_acs.map((acId) => (
                <li key={acId} className="font-mono">
                  {acId}
                </li>
              ))}
            </ul>
          </div>
        )}
        {declaredScopeCoverage.unattested_acs.length > 0 && (
          <div aria-label="Unattested declared-scope acceptance criteria">
            <p className="text-xs font-medium text-destructive">Declared-scope acceptance criteria with no attested evidence:</p>
            <ul className="list-disc list-inside text-xs text-muted-foreground">
              {declaredScopeCoverage.unattested_acs.map((acId) => (
                <li key={acId} className="font-mono">
                  {acId}
                </li>
              ))}
            </ul>
          </div>
        )}
        {"notApplicable" in declaredScopeVerdict && (
          <p className="text-xs text-muted-foreground" aria-label="Declared scope undeclared notice">
            No evidence-bearing task in this plan declares an <code>ac_scope</code> — the plan-close
            declared-scope conjunct has nothing to audit yet.
          </p>
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
