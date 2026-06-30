/**
 * PhaseService — manages declared phases on plan documents.
 *
 * Phases are soft groupings stored in plan.extra.phases (array of {name, description?}).
 * They are NOT a doc type — no ID, no lifecycle, no version history.
 * Tasks reference phases by name via task.extra.phase.
 *
 * Public surface:
 *   listPhases(planIdOrSlug)                       → PlanPhase[]
 *   addPhase(planIdOrSlug, name, description?)      → PlanPhase[] (updated list)
 *   removePhase(planIdOrSlug, name)                 → PlanPhase[] (updated list)
 *   renamePhase(planIdOrSlug, oldName, newName)     → PlanPhase[] (updated list)
 *   migratePhases(opts)                             → PhaseMigrationReport
 *
 * @invariant All methods return Promise<Result<T, LoreError>> — no thrown exceptions.
 * @invariant Names are trimmed at write time and matched case-sensitively (SPEC-023 §8 Q-extra).
 * @invariant removePhase fails if any child task still references the phase (AC-PHASE-9).
 * @invariant migratePhases is idempotent — rerunning is a no-op (AC-PHASE-10).
 *
 * Side-effect class: IO (reads and writes via StoreInterface).
 * Source: SPEC-023 §4, §9.1
 */

import { err, ok, type Result } from "@lore/core";
import type { LoreError } from "@lore/core";
import type { PlanPhase } from "@lore/core";
import type { DocId, DocRecord } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { resolveDoc } from "./resolve.js";

// ─── Public Types ──────────────────────────────────────────────────────────

/**
 * Result of a `lore migrate phases [--dry-run]` invocation.
 * @example { touched: 3, skipped: 10, dryRun: true }
 */
export interface PhaseMigrationReport {
  /** Number of plan rows where extra.phase was promoted to extra.legacy_phase. */
  touched: number;
  /** Number of plan rows that needed no change (no legacy extra.phase). */
  skipped: number;
  /** When true, no writes were performed — report shows what would happen. */
  dryRun: boolean;
}

// ─── PhaseService ──────────────────────────────────────────────────────────

export class PhaseService {
  /**
   * @param store - Storage abstraction (same instance passed to CorpusService)
   */
  constructor(private readonly store: StoreInterface) {}

  // ── listPhases ────────────────────────────────────────────────────────────

  /**
   * Return the declared phases for a plan.
   * Returns an empty array when the plan exists but has no extra.phases.
   *
   * @param planIdOrSlug - Plan document ULID or slug
   * @returns Ordered array of declared phases (may be empty)
   * @throws VALIDATION_ERROR if resolved doc is not a plan
   * @throws DOC_NOT_FOUND if the doc does not exist
   */
  async listPhases(planIdOrSlug: string): Promise<Result<PlanPhase[], LoreError>> {
    const planResult = await resolveDoc(this.store, planIdOrSlug);
    if (!planResult.ok) return planResult;
    const plan = planResult.value;

    if (plan.type !== "plan") {
      return err({
        code: "VALIDATION_ERROR",
        field: "type",
        message: `Expected a plan document; got type '${plan.type}'`,
        value: plan.type,
      });
    }

    return ok(extractPhases(plan));
  }

  // ── addPhase ──────────────────────────────────────────────────────────────

  /**
   * Append a new phase to a plan's extra.phases.
   * Name is trimmed before writing (SPEC-023 §8 Q-extra).
   * Duplicate names → VALIDATION_ERROR with exit 4 (AC-PHASE-8).
   *
   * @param planIdOrSlug - Plan document ULID or slug
   * @param name - Phase name (trimmed, must be non-empty after trim)
   * @param description - Optional human-readable description
   * @returns Updated phases array after adding
   * @throws VALIDATION_ERROR if name is empty after trim or already exists
   * @throws VALIDATION_ERROR if resolved doc is not a plan
   */
  async addPhase(
    planIdOrSlug: string,
    name: string,
    description?: string,
  ): Promise<Result<PlanPhase[], LoreError>> {
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      return err({
        code: "VALIDATION_ERROR",
        field: "name",
        message: "Phase name must not be empty after trimming whitespace",
        value: name,
      });
    }

    const planResult = await resolveDoc(this.store, planIdOrSlug);
    if (!planResult.ok) return planResult;
    const plan = planResult.value;

    if (plan.type !== "plan") {
      return err({
        code: "VALIDATION_ERROR",
        field: "type",
        message: `Expected a plan document; got type '${plan.type}'`,
        value: plan.type,
      });
    }

    const existing = extractPhases(plan);
    if (existing.some((p) => p.name === trimmedName)) {
      return err({
        code: "VALIDATION_ERROR",
        field: "phases[].name",
        message: `Phase "${trimmedName}" already exists on this plan`,
        value: trimmedName,
      });
    }

    const newPhase: PlanPhase = { name: trimmedName };
    if (description !== undefined) {
      newPhase.description = description.trim() || undefined;
    }

    const updatedPhases: PlanPhase[] = [...existing, newPhase];
    const updateResult = await this.store.update(plan.id, {
      extra: { ...plan.extra, phases: updatedPhases },
      updated_at: new Date().toISOString(),
    });
    if (!updateResult.ok) return updateResult;

    return ok(updatedPhases);
  }

  // ── removePhase ───────────────────────────────────────────────────────────

  /**
   * Remove a declared phase from a plan.
   * Fails if any child task still has extra.phase set to that name (AC-PHASE-9).
   * User must first clear or reassign those tasks.
   *
   * @param planIdOrSlug - Plan document ULID or slug
   * @param name - Phase name to remove (case-sensitive exact match)
   * @returns Updated phases array after removal
   * @throws VALIDATION_ERROR if name not found or tasks still reference it
   */
  async removePhase(
    planIdOrSlug: string,
    name: string,
  ): Promise<Result<PlanPhase[], LoreError>> {
    const planResult = await resolveDoc(this.store, planIdOrSlug);
    if (!planResult.ok) return planResult;
    const plan = planResult.value;

    if (plan.type !== "plan") {
      return err({
        code: "VALIDATION_ERROR",
        field: "type",
        message: `Expected a plan document; got type '${plan.type}'`,
        value: plan.type,
      });
    }

    const existing = extractPhases(plan);
    if (!existing.some((p) => p.name === name)) {
      return err({
        code: "VALIDATION_ERROR",
        field: "phases[].name",
        message: `Phase "${name}" does not exist on this plan`,
        value: name,
      });
    }

    // Guard: reject if any child task still references this phase (AC-PHASE-9).
    const blockingTasksResult = await this.findTasksByPhase(plan.id, name);
    if (!blockingTasksResult.ok) return blockingTasksResult;
    if (blockingTasksResult.value.length > 0) {
      const slugs = blockingTasksResult.value.map((t) => t.slug).join(", ");
      return err({
        code: "VALIDATION_ERROR",
        field: "extra.phase",
        message: `Cannot remove phase "${name}" — ${blockingTasksResult.value.length} task(s) still reference it: ${slugs}. Clear or move them first.`,
        value: name,
      });
    }

    const updatedPhases = existing.filter((p) => p.name !== name);
    const updateResult = await this.store.update(plan.id, {
      extra: { ...plan.extra, phases: updatedPhases },
      updated_at: new Date().toISOString(),
    });
    if (!updateResult.ok) return updateResult;

    return ok(updatedPhases);
  }

  // ── renamePhase ───────────────────────────────────────────────────────────

  /**
   * Rename a phase: updates the plan's phases array AND all child tasks that
   * reference the old name — all in a single logical operation (best-effort,
   * not a true SQL transaction via StoreInterface).
   *
   * @param planIdOrSlug - Plan document ULID or slug
   * @param oldName - Current phase name (case-sensitive)
   * @param newName - New phase name (trimmed, must not collide with existing names)
   * @returns Updated phases array after rename
   * @throws VALIDATION_ERROR if oldName not found, newName collides, or newName is empty
   */
  async renamePhase(
    planIdOrSlug: string,
    oldName: string,
    newName: string,
  ): Promise<Result<PlanPhase[], LoreError>> {
    const trimmedNew = newName.trim();
    if (trimmedNew.length === 0) {
      return err({
        code: "VALIDATION_ERROR",
        field: "name",
        message: "New phase name must not be empty after trimming whitespace",
        value: newName,
      });
    }
    if (trimmedNew === oldName) {
      return err({
        code: "VALIDATION_ERROR",
        field: "name",
        message: "New phase name is identical to the current name",
        value: newName,
      });
    }

    const planResult = await resolveDoc(this.store, planIdOrSlug);
    if (!planResult.ok) return planResult;
    const plan = planResult.value;

    if (plan.type !== "plan") {
      return err({
        code: "VALIDATION_ERROR",
        field: "type",
        message: `Expected a plan document; got type '${plan.type}'`,
        value: plan.type,
      });
    }

    const existing = extractPhases(plan);
    if (!existing.some((p) => p.name === oldName)) {
      return err({
        code: "VALIDATION_ERROR",
        field: "phases[].name",
        message: `Phase "${oldName}" does not exist on this plan`,
        value: oldName,
      });
    }
    if (existing.some((p) => p.name === trimmedNew)) {
      return err({
        code: "VALIDATION_ERROR",
        field: "phases[].name",
        message: `Phase "${trimmedNew}" already exists on this plan`,
        value: trimmedNew,
      });
    }

    const updatedPhases = existing.map((p) =>
      p.name === oldName ? { ...p, name: trimmedNew } : p,
    );

    const planUpdateResult = await this.store.update(plan.id, {
      extra: { ...plan.extra, phases: updatedPhases },
      updated_at: new Date().toISOString(),
    });
    if (!planUpdateResult.ok) return planUpdateResult;

    // Update all child tasks that reference the old phase name.
    // reason: best-effort sequential updates — StoreInterface has no transaction primitive.
    // Idempotent on re-run if partially applied (tasks already updated are skipped naturally).
    const tasksResult = await this.findTasksByPhase(plan.id, oldName);
    if (!tasksResult.ok) return tasksResult;
    for (const task of tasksResult.value) {
      const taskUpdateResult = await this.store.update(task.id, {
        extra: { ...task.extra, phase: trimmedNew },
        updated_at: new Date().toISOString(),
      });
      if (!taskUpdateResult.ok) return taskUpdateResult;
    }

    return ok(updatedPhases);
  }

  // ── migratePhases ─────────────────────────────────────────────────────────

  /**
   * Proactive one-sweep migration: for every plan row with a legacy singular
   * extra.phase string, copies it to extra.legacy_phase and removes extra.phase.
   * Idempotent — rows without extra.phase (or already migrated) are skipped.
   *
   * @example
   *   Before: { extra: { phase: "Track A" } }
   *   After:  { extra: { legacy_phase: "Track A" } }
   *
   * @param opts.dryRun - When true, reports what would be changed without writing
   * @returns PhaseMigrationReport with touched/skipped counts
   *
   * Source: SPEC-023 §4 AC-PHASE-10, §8 Q2
   */
  async migratePhases(opts: { dryRun?: boolean } = {}): Promise<Result<PhaseMigrationReport, LoreError>> {
    const dryRun = opts.dryRun ?? false;

    const plansResult = await this.store.findMany({ type: "plan" });
    if (!plansResult.ok) return plansResult;

    let touched = 0;
    let skipped = 0;

    for (const plan of plansResult.value) {
      const legacyPhase = plan.extra["phase"];
      // Only migrate rows that have a non-empty legacy singular `extra.phase` string.
      // reason: typeof check guards against `phase: undefined` (passthrough schema allowed it)
      // and against `phase` being an array (would indicate an already-migrated-but-misnamed row).
      if (typeof legacyPhase !== "string" || legacyPhase.trim() === "") {
        skipped++;
        continue;
      }

      touched++;
      if (!dryRun) {
        const newExtra: Record<string, unknown> = { ...plan.extra };
        // Move singular phase to legacy_phase, clear the old key.
        delete newExtra["phase"];
        newExtra["legacy_phase"] = legacyPhase;
        const updateResult = await this.store.update(plan.id as DocId, {
          extra: newExtra,
          updated_at: new Date().toISOString(),
        });
        if (!updateResult.ok) return updateResult;
      }
    }

    return ok({ touched, skipped, dryRun });
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  /**
   * Find all child tasks of a plan that have extra.phase === phaseName.
   * Used by removePhase (guard) and renamePhase (bulk-update).
   */
  private async findTasksByPhase(
    planId: DocId,
    phaseName: string,
  ): Promise<Result<DocRecord[], LoreError>> {
    const allChildrenResult = await this.store.findMany({ parent_id: planId, type: "task" });
    if (!allChildrenResult.ok) return allChildrenResult;
    const matched = allChildrenResult.value.filter(
      (doc) => doc.extra["phase"] === phaseName,
    );
    return ok(matched);
  }
}

// ─── Private Helpers ─────────────────────────────────────────────────────────

/**
 * Extract the phases array from a plan DocRecord.
 * Returns [] when extra.phases is absent, null, or not an array.
 * Each entry is validated to have at least a string `name` field.
 */
function extractPhases(plan: DocRecord): PlanPhase[] {
  const raw = plan.extra["phases"];
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (p): p is PlanPhase =>
      typeof p === "object" && p !== null && typeof (p as PlanPhase).name === "string",
  );
}
