/**
 * VerificationProjectionService — assembles the dashboard adjudication
 * workbench's Evidence-tab projection for one doc (SPEC-075 §Module Boundary
 * D1). Read-only, stateless.
 *
 * Public surface:
 *   evidencePanel(idOrSlug) → EvidencePanelProjection (discriminated union by
 *     doc_type: task | spec | plan | other)
 *
 * @invariant ZERO local derivation math (SPEC-075 D3/AC-075-10) — every
 *   coverage/counting/ratio computation is imported from `@lore/core`
 *   (`computeAcCoverage`, `buildTaskAttestationInfos`, `deriveAttestationSummary`).
 *   This file declares no function named `derive*`/`compute*` — the AC-075-10
 *   grep oracle pins that.
 * @invariant `resolvePlanTasks` (D9) fails loud (`VALIDATION_ERROR`) when a plan
 *   has ≥1 `phase`-typed child and ZERO `task`-typed children — a raw
 *   `type: "task"` `findMany` filter would otherwise silently return `[]` for a
 *   plan the SPEC-056 migration has already moved onto `phase` docs, and this
 *   projection has no way to distinguish "genuinely zero children yet" from
 *   "migrated out from under a task-centric filter" without the explicit check.
 *
 * Side-effect class: IO (reads via the injected `StoreInterface`).
 * Source: SPEC-075 §Module Boundary D1/D3/D9, §Public Interface.
 */

import { err, ok, type Result } from "@lore/core";
import type { DocId, DocRecord, LoreError } from "@lore/core";
import {
  buildTaskAttestationInfos,
  computeAcCoverage,
  deriveAttestationSummary,
  extractEvidence,
  specAcceptanceCriteriaSchema,
  type AcceptanceCriterion,
  type EvidencePanelProjection,
} from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { resolveDoc } from "./resolve.js";

/**
 * Reads a spec's declared `extra.acceptance_criteria`, schema-validated via
 * `specAcceptanceCriteriaSchema`. Returns `[]` when absent or malformed —
 * mirrors `ac-service.ts::extractCriteria`'s identical fail-closed shape (a
 * spec with no/invalid AC declarations projects as "zero criteria", never a
 * thrown error).
 */
function extractSpecCriteria(spec: DocRecord): AcceptanceCriterion[] {
  const parsed = specAcceptanceCriteriaSchema.safeParse(spec.extra["acceptance_criteria"]);
  return parsed.success ? parsed.data : [];
}

/**
 * Resolves one plan's task children — the D9 hierarchy-assumption checkpoint
 * (SPEC-075 §Module Boundary, "Spec→tasks resolution"). A raw `type: "task"`
 * filter alone cannot tell "this plan genuinely has no children yet" apart
 * from "the SPEC-056 phase migration already moved this plan's children onto
 * `type: "phase"` docs" — both read back as an empty task array. This function
 * makes that ambiguity explicit: when the task filter is empty AND the plan
 * has ≥1 `phase` child, it fails loud instead of silently reporting zero
 * evidence for a plan that actually has execution-tier children.
 *
 * @param store - Storage abstraction (same instance injected into this service).
 * @param planId - The plan doc's id (never a slug — callers already hold a
 *   resolved `DocRecord` by the time they call this).
 * @returns The plan's `task`-typed children (possibly `[]`, when there are
 *   genuinely none and no `phase` children either).
 * @throws (as a `Result` error, never a real throw) `VALIDATION_ERROR` when
 *   the plan has ≥1 `phase` child and zero `task` children.
 * @example
 * resolvePlanTasks(store, planWithNoChildrenAtAll.id); // => ok([])
 * @example
 * resolvePlanTasks(store, migratedPlanWithPhaseChildren.id);
 * // => err({code: "VALIDATION_ERROR", field: "plan_id", ...})
 */
async function resolvePlanTasks(
  store: StoreInterface,
  planId: DocId,
): Promise<Result<DocRecord[], LoreError>> {
  const tasksResult = await store.findMany({ parent_id: planId, type: "task" });
  if (!tasksResult.ok) return tasksResult;
  if (tasksResult.value.length > 0) return ok(tasksResult.value);

  // reason: SPEC-075 D9 — an empty task[] is ambiguous by itself. Check whether
  // this plan has been migrated onto phase docs (SPEC-056) before accepting
  // "zero tasks" as a fact rather than a stale-filter artifact.
  const phasesResult = await store.findMany({ parent_id: planId, type: "phase" });
  if (!phasesResult.ok) return phasesResult;
  if (phasesResult.value.length > 0) {
    return err({
      code: "VALIDATION_ERROR",
      field: "plan_id",
      value: planId,
      message:
        `Plan ${planId} has ${phasesResult.value.length} phase child(ren) and zero task children — ` +
        "this projection assumes the pre-SPEC-056 task-centric hierarchy (resolvePlanTasks, SPEC-075 D9); " +
        "a raw type=task filter silently returns empty for a plan the phase migration has already run on. " +
        "See SPEC-056 (phase execution model) and SPEC-075 §Module Boundary for the documented assumption.",
    });
  }

  return ok([]);
}

/**
 * Assembles the Evidence-tab projection for one doc (SPEC-075 §Public
 * Interface). Read-only, stateless service — depends only on an injected
 * `StoreInterface` plus the resolved `workflow.attestation.min_ratio` floor
 * (the same value `GateEnforcer.resolveAttestationMinRatio` feeds `attestationFloor`,
 * threaded here at construction time so the dashboard's plan attestation panel
 * and the `plan-close` gate never disagree on which floor a plan is measured
 * against).
 */
export class VerificationProjectionService {
  /**
   * @param store - Storage abstraction (same instance passed to every other
   *   service).
   * @param minRatio - The configured `workflow.attestation.min_ratio` floor
   *   (`resolveAttestationMinRatio(config)`, `@lore/core`) — resolved ONCE by
   *   the composition root (`app.ts`), never re-read from config here.
   */
  constructor(
    private readonly store: StoreInterface,
    private readonly minRatio: number,
  ) {}

  /**
   * Assemble the Evidence-tab projection for one doc, discriminated by its
   * `doc_type` (SPEC-075 §Public Interface `EvidencePanelProjection`):
   *   - `task` → its own evidence log + distinct declared `ac_ref`s.
   *   - `spec` → aggregated AC coverage across every child plan's tasks
   *     (`resolvePlanTasks` per plan, D9 fail-loud propagates through).
   *   - `plan` → plan-wide attestation summary + per-task attestation facts.
   *   - anything else (prd/adr/knowledge/phase) → `{doc_type: "other"}`
   *     (no evidence surface — the dashboard hides the Evidence tab).
   *
   * @param idOrSlug - Doc ULID, slug, or unique ID prefix (via `resolveDoc`).
   * @returns The assembled projection, or `DOC_NOT_FOUND` / a propagated
   *   store error, or `VALIDATION_ERROR` (D9 hierarchy-assumption violation
   *   on a `spec`'s or `plan`'s child-plan resolution).
   * @example
   * evidencePanel("task-add-login-form");
   * // => ok({doc_type: "task", evidence: [...], ac_refs: ["AC-1", "AC-2"]})
   */
  async evidencePanel(idOrSlug: string): Promise<Result<EvidencePanelProjection, LoreError>> {
    const docResult = await resolveDoc(this.store, idOrSlug);
    if (!docResult.ok) return docResult;
    const doc = docResult.value;

    switch (doc.type) {
      case "task": {
        const evidence = extractEvidence(doc);
        const acRefs = Array.from(
          new Set(
            evidence
              .map((entry) => entry.ac_ref)
              .filter((ref): ref is string => ref !== undefined),
          ),
        );
        return ok({ doc_type: "task", evidence, ac_refs: acRefs });
      }

      case "spec": {
        const plansResult = await this.store.findMany({ parent_id: doc.id, type: "plan" });
        if (!plansResult.ok) return plansResult;

        const allTasks: DocRecord[] = [];
        for (const plan of plansResult.value) {
          const planTasksResult = await resolvePlanTasks(this.store, plan.id);
          if (!planTasksResult.ok) return planTasksResult;
          allTasks.push(...planTasksResult.value);
        }

        const criteria = extractSpecCriteria(doc);
        const coverage = computeAcCoverage(criteria, allTasks);
        return ok({ doc_type: "spec", criteria, coverage, task_count: allTasks.length });
      }

      case "plan": {
        const tasksResult = await resolvePlanTasks(this.store, doc.id);
        if (!tasksResult.ok) return tasksResult;

        const taskAttestationInfos = buildTaskAttestationInfos(tasksResult.value);
        const attestation = deriveAttestationSummary(taskAttestationInfos, this.minRatio);
        return ok({ doc_type: "plan", attestation, tasks: taskAttestationInfos });
      }

      default:
        return ok({ doc_type: "other" });
    }
  }
}
