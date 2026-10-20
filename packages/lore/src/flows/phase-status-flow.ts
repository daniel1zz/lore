/**
 * Phase scorecard assembly (SPEC-056 task-skill-implement-cli-mcp-surfaces-checklist-ref-evidence,
 * "CLI + MCP surfaces + checklist_ref evidence") — the single derivation site for `lore
 * phase status <phase>`'s payload, mirroring the `flows/staleness-flow.ts` /
 * `flows/phase-feed-flow.ts` precedent: a NARROW injected dependency bundle
 * (`PhaseStatusFlowDeps`), never the full `App`, so CLI and MCP build the IDENTICAL
 * payload by construction — both call `buildPhaseStatusPayload` through the same
 * `phase-wiring.ts` deps binder, never two independently-authored renderers.
 *
 * Contract:
 *   - `deps.getPhase(phaseId)` failing (DOC_NOT_FOUND, or resolves but wrong type) is
 *     FATAL — propagated verbatim.
 *   - `deps.getPlanBundle(planId)` failing is FATAL — propagated verbatim (the plan
 *     bundle carries the parent spec's declared AC set, needed for coverage).
 *   - AC-scope coverage is computed via `computeAcCoverage` (SPEC-038, `@lore/core`)
 *     scoped to THIS PHASE'S OWN evidence only (`[phase]`, not the whole plan bundle's
 *     tasks) — a phase's contract projection is satisfied by ITS OWN attested runs,
 *     never a sibling's.
 *   - Completion state/blocking/dropped/manual-selfattested all come from
 *     `computePhaseCompletion` (`@lore/core`, SPEC-056 §Design Decisions D3) — this
 *     module never re-derives that logic, only assembles its inputs and renders its
 *     output into a presentation-ready payload.
 *   - `exit_code` distinguishes done (0) / not-done — pending or active (1) / vacuous
 *     (2) — a business-outcome code, not a `LoreError` mapping (mirrors `lore verify`'s
 *     exit-1-vs-LoreError-exit split, `adapters/cli/commands/verify.ts`'s header note).
 *
 * Side-effect class: none (pure over the injected `PhaseStatusFlowDeps` — no direct IO)
 * Source: spec-spec-056-phase-execution-model-phase-doc-type-computed-comp §Design
 *   Decisions D3; task-skill-implement-cli-mcp-surfaces-checklist-ref-evidence
 */

import {
  ok,
  err,
  computeAcCoverage,
  computePhaseCompletion,
  phaseExtraSchema,
  specAcceptanceCriteriaSchema,
  isClaimStale,
  type PhaseCompletionState,
} from "@lore/core";
import type { DocRecord, LoreError, PlanBundle, Result } from "@lore/core";

/** Narrow injected dependency bundle — mirrors `PhaseFeedFlowDeps` (never the full `App`). */
export interface PhaseStatusFlowDeps {
  /** Resolves `phaseIdOrSlug` into its DocRecord (any doc type — the flow validates it's a phase). */
  getPhase: (phaseIdOrSlug: string) => Promise<Result<DocRecord, LoreError>>;
  /** Same port `PhaseWorkflowService`'s claim gate and `PhaseFeedFlowDeps` use — `CorpusService.getPlanBundle`. */
  getPlanBundle: (planId: string) => Promise<Result<PlanBundle, LoreError>>;
  /** Claim staleness TTL in minutes — same resolved value every other claim-aware surface uses. */
  claimTtlMinutes: number;
}

/** AC-scope coverage summary — one row for the phase's whole `ac_scope` set (not per-id). */
export interface PhaseStatusAcSummary {
  /** `ac_scope.length` — total declared AC ids in this phase's contract projection. */
  total: number;
  /** Count of `ac_scope` ids with `attested_pass > 0` (SPEC-039 attested, not self-reported). */
  attested: number;
  /** `ac_scope` ids NOT yet attested-passing — the AC-side subset of `blocking`. */
  blocking: string[];
}

/** Checklist state summary. */
export interface PhaseStatusChecklistSummary {
  /** Total declared checklist items (including dropped ones). */
  total: number;
  /** Items satisfied — manual-checked or script-passed, excluding dropped. */
  satisfied: number;
  /** Non-dropped, unsatisfied item ids — the checklist-side subset of `blocking`. */
  blocking: string[];
  /** Dropped item ids (any bind kind). */
  dropped_named: string[];
  /** Manual items that ARE checked. */
  manual_selfattested: string[];
}

/** The `lore phase status <phase>` scorecard payload — CLI text render + `--json` + MCP `lore_phase_status` all consume this SAME shape. */
export interface PhaseStatusPayload {
  phase_id: string;
  phase_slug: string;
  phase_title: string;
  plan_slug: string;
  state: PhaseCompletionState;
  ac_scope: PhaseStatusAcSummary;
  checklist: PhaseStatusChecklistSummary;
  /** Full blocking list from `computePhaseCompletion` — AC ids followed by checklist item ids. */
  blocking: string[];
  claim: { by: string; at: string; stale: boolean } | null;
  /** 0 = done, 1 = not done (pending/active), 2 = vacuous. */
  exit_code: 0 | 1 | 2;
}

/**
 * Extracts a spec's declared acceptance criteria — [] when absent/malformed, mirrors
 * `AcService`'s private `extractCriteria`. Exported so `adapters/cli/phase-wiring.ts`'s
 * `PhaseFeedFlowDeps` binding can reuse the identical extraction for sibling-phase
 * completion states, rather than a second hand-rolled copy.
 */
export function extractSpecCriteria(spec: DocRecord) {
  const parsed = specAcceptanceCriteriaSchema.safeParse(spec.extra["acceptance_criteria"]);
  return parsed.success ? parsed.data : [];
}

/**
 * Assembles the `lore phase status <phaseIdOrSlug>` scorecard payload. See module
 * header for the full fatal-failure and exit-code contract.
 *
 * @param deps - Narrow injected port bundle.
 * @param phaseIdOrSlug - The target phase's id or slug.
 * @param nowIso - Caller-supplied current time (D10 time-seam convention) — drives
 *   claim-staleness and `computePhaseCompletion`'s own state derivation.
 * @returns `ok(PhaseStatusPayload)`, or `err(LoreError)` when the target doesn't
 *   resolve, isn't a phase doc, or has no parent plan.
 */
export async function buildPhaseStatusPayload(
  deps: PhaseStatusFlowDeps,
  phaseIdOrSlug: string,
  nowIso: string,
): Promise<Result<PhaseStatusPayload, LoreError>> {
  const phaseResult = await deps.getPhase(phaseIdOrSlug);
  if (!phaseResult.ok) return phaseResult;
  const phase = phaseResult.value;

  if (phase.type !== "phase") {
    return err({
      code: "VALIDATION_ERROR",
      field: "type",
      message: `Expected a phase document; got type '${phase.type}'`,
      value: phase.type,
    });
  }
  if (phase.parent_id === null) {
    return err({
      code: "VALIDATION_ERROR",
      field: "parent_id",
      message: `Phase '${phase.slug}' has no parent plan`,
      value: phase.id,
    });
  }

  const extraParsed = phaseExtraSchema.safeParse(phase.extra);
  const acScope = extraParsed.success ? (extraParsed.data.ac_scope ?? []) : [];
  const checklist = extraParsed.success ? (extraParsed.data.checklist ?? []) : [];
  const claim = extraParsed.success ? extraParsed.data.claim : undefined;

  const bundleResult = await deps.getPlanBundle(phase.parent_id);
  if (!bundleResult.ok) return bundleResult;
  const bundle = bundleResult.value;

  const criteria = bundle.spec !== undefined ? extractSpecCriteria(bundle.spec) : [];
  // reason: coverage is scoped to THIS phase's OWN evidence only (`[phase]`) — a
  // sibling phase's attested run never satisfies this phase's contract projection.
  const coverage = computeAcCoverage(criteria, [phase]);

  const now = new Date(nowIso);
  const completionResult = computePhaseCompletion({
    acScope,
    coverage,
    checklist,
    claim,
    claimTtlMinutes: deps.claimTtlMinutes,
    now,
  });
  if (!completionResult.ok) return completionResult;
  const completion = completionResult.value;

  const coverageByAcId = new Map(coverage.map((fact) => [fact.ac_id, fact]));
  const acScopeSet = new Set(acScope);
  const acAttested = acScope.filter((id) => (coverageByAcId.get(id)?.attested_pass ?? 0) > 0).length;
  const acBlocking = completion.blocking.filter((id) => acScopeSet.has(id));
  const checklistBlocking = completion.blocking.filter((id) => !acScopeSet.has(id));
  const checklistSatisfied = checklist.length - checklistBlocking.length - completion.dropped_named.length;

  const exitCode: 0 | 1 | 2 =
    completion.state === "done" ? 0 : completion.state === "vacuous" ? 2 : 1;

  return ok({
    phase_id: phase.id,
    phase_slug: phase.slug,
    phase_title: phase.title,
    plan_slug: bundle.plan.slug,
    state: completion.state,
    ac_scope: { total: acScope.length, attested: acAttested, blocking: acBlocking },
    checklist: {
      total: checklist.length,
      satisfied: checklistSatisfied,
      blocking: checklistBlocking,
      dropped_named: completion.dropped_named,
      manual_selfattested: completion.manual_selfattested,
    },
    blocking: completion.blocking,
    claim:
      claim !== undefined
        ? { by: claim.by, at: claim.at, stale: isClaimStale(claim, nowIso, deps.claimTtlMinutes) }
        : null,
    exit_code: exitCode,
  });
}
