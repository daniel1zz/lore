/**
 * PhaseService — manages declared phases on plan documents.
 *
 * Phases are soft groupings stored in plan.extra.phases (array of {name, description?}).
 * They are NOT a doc type — no id, no lifecycle, no status of their own. Tasks
 * reference phases by name via task.extra.phase.
 *
 * ⛔ WRITE CONTRACT, decided by
 * `adr-phase-writes-log-a-version-row-and-do-not-demote-the-plan` — which overturns
 * ONLY SPEC-023's "phase history is dispensable" clause and keeps its soft-grouping
 * model intact. The three phase-set writers below (`addPhase`, `removePhase`,
 * `renamePhase`) each LOG exactly one version row, so a phase-set mutation is visible
 * in `lore log`/`lore diff`; and each leaves the plan's `status` UNTOUCHED — adding a
 * phase to an `approved` plan keeps it `approved`. This is the shape `lore ac add`
 * already has (see `ac-service.ts`'s own header for the sibling contract).
 *
 * ⛔ The demotion half is explicitly OUT. The status-after-contract-edit helper that
 * `lore ac set` calls — exported from `@lore/core`'s schemas.ts, consumed by
 * `ac-service.ts`, which is this file's green control for it — has NO caller here by
 * decision, and its identifier is deliberately absent from this file so that the
 * decision is greppable as an absence (the ADR above names it in full). A future reader
 * who notices that phase writes now log a version but do not demote is looking at the
 * DECIDED behaviour, not an unfinished migration — ⛔ do not "complete" it by adding a
 * demotion.
 *
 * ⛔ The back-catalogue is unrecoverable: every phase mutation applied before that
 * decision landed left no version row, and no migration can reconstruct them. Anywhere
 * a plan's version history is presented as complete, that limit MUST be stated.
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
 * @invariant {@link PhaseService.writePhases} is the ONLY writer of `plan.extra.phases`
 *   in this file — one CAS-guarded composite write (doc patch + version row + audit
 *   entry) per mutation, never a bare `store.update`. `migratePhases` is deliberately
 *   NOT routed through it: it rewrites the LEGACY singular `extra.phase` key, not the
 *   declared `phases[]` array, and is outside the ADR's scope.
 *
 * Side-effect class: IO (reads and writes via StoreInterface).
 * Source: SPEC-023 §4, §9.1, as amended by the ADR cited above.
 */

import { err, ok, type Result } from "@lore/core";
import type { LoreError } from "@lore/core";
import type { PlanPhase } from "@lore/core";
import type { DocId, DocRecord } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { resolveDoc } from "./resolve.js";
import { isPlanMember } from "./plan-membership.js";

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
    const writeResult = await this.writePhases(plan, updatedPhases, {
      operation: "add",
      change_summary: `Phase added — "${trimmedName}" (${updatedPhases.length} declared)`,
      details: { phase: trimmedName },
    });
    if (!writeResult.ok) return writeResult;

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
    const writeResult = await this.writePhases(plan, updatedPhases, {
      operation: "remove",
      change_summary: `Phase removed — "${name}" (${updatedPhases.length} declared)`,
      details: { phase: name },
    });
    if (!writeResult.ok) return writeResult;

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

    const planWriteResult = await this.writePhases(plan, updatedPhases, {
      operation: "rename",
      change_summary: `Phase renamed — "${oldName}" → "${trimmedNew}" (${updatedPhases.length} declared)`,
      details: { phase: trimmedNew, previous_phase: oldName },
    });
    if (!planWriteResult.ok) return planWriteResult;

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
   * Find all of a PLAN's member tasks (never a bare `parent_id` match — see
   * {@link isPlanMember}) that have `extra.phase === phaseName`. Used by
   * `removePhase` (guard: refuses removal while any member still references
   * the phase) AND `renamePhase` (bulk-update: WRITES `extra.phase` on every
   * matched task). The `renamePhase` consumer makes this a WRITE-adjacent
   * site, not merely a read (task-eight-more-plan-member-queries-still-key-
   * on-parent-id): a `parent_id`-keyed miss on a diverged member would leave
   * that task's `extra.phase` referencing a name the plan's own `phases[]`
   * no longer has, post-rename — an orphaned reference `removePhase`'s own
   * guard could then never find either.
   */
  private async findTasksByPhase(
    planId: DocId,
    phaseName: string,
  ): Promise<Result<DocRecord[], LoreError>> {
    const allTasksResult = await this.store.findMany({ type: "task" });
    if (!allTasksResult.ok) return allTasksResult;
    const matched = allTasksResult.value.filter(
      (doc) => isPlanMember(doc, planId) && doc.extra["phase"] === phaseName,
    );
    return ok(matched);
  }

  // ── writePhases ────────────────────────────────────────────────────

  /**
   * The single write path for `plan.extra.phases` — shared by `addPhase`,
   * `removePhase` and `renamePhase`. Bumps the plan's `version`, snapshots that
   * version, and audits it, per
   * `adr-phase-writes-log-a-version-row-and-do-not-demote-the-plan`.
   *
   * ⛔ `status` is passed through UNCHANGED and is never computed here. reason: the
   * ADR decided the `lore ac add` shape — log, do NOT demote — and explicitly ruled the
   * demotion half out (this file's header explains why the helper's identifier is absent
   * here rather than merely uncalled). An `approved` plan is still `approved` after a
   * phase write. Reintroducing a demotion would force re-approval on every phase edit,
   * which the ADR rejected by name as a coordination cost under many-concurrent-sessions.
   *
   * reason: ONE composite `updateWithProvenance` rather than
   * `update` + `insertVersion` + `appendAuditEntry` as three independent awaits, on two
   * grounds neither of which is optional here:
   *   1. BUG-002 — three separate awaits leave the doc PERSISTED with a missing
   *      version/audit row when step 2 or 3 fails, with no signal to the caller.
   *      `updateWithProvenance` commits or rolls back all three together.
   *   2. The `versions` table's real PK is `(doc_id, version)`, so two concurrent phase
   *      writes that both computed `plan.version + 1` would collide on the version
   *      insert AFTER one of them had already mutated the doc. The
   *      `expected_version` CAS below turns that race into a clean `STALE_VERSION` for
   *      the loser, before any row is written.
   *
   * The audit entry's `details.version` is load-bearing, not decoration: it is the join
   * key `AuditService.verify` reconciles versions rows against (SPEC-035 §2,
   * `VERSION_ACTION_AUDIT_FAMILY`). A version row with `action: "update"` and no audit
   * entry carrying the same `(doc_id, version)` is reported as an unexplained row and
   * makes `lore audit --verify` return `clean: false` (MEASURED: dropping the audit
   * entry and keeping only the version row puts one miss per phase write in that
   * command's `misses[]` and exits 4, while the whole SPEC-148 parity suite stays
   * green — the suite does not read the audit trail). That is why the audit half is
   * written here and not left to callers.
   *
   * `actor`/`created_by` are the literal `"system"`, matching `AcService`'s sibling
   * `extra` write path: `PhaseService` is constructed with a store and nothing else, so
   * there is no invoking actor to resolve. Attribution of phase writes to a real actor
   * needs `by`-plumbing through `phase-wiring.ts`, which no decision has asked for yet.
   *
   * @param plan - The resolved plan doc, read BEFORE the mutation; its `version` is
   *   both the CAS expectation and the base for the new version number.
   * @param phases - The complete post-mutation phases array (this method never merges).
   * @param opts.operation - Which writer called, for `change_summary`/audit `details`.
   * @param opts.change_summary - Human-readable one-liner stored on the version row.
   * @param opts.details - Operation-specific audit `details` keys merged in alongside
   *   the mandatory `operation`/`phase_count`/`version`.
   * @returns The updated plan record, or the store's own error — `STALE_VERSION` when a
   *   concurrent writer moved the plan's version, never a silently-lost write.
   */
  private async writePhases(
    plan: DocRecord,
    phases: PlanPhase[],
    opts: {
      operation: "add" | "remove" | "rename";
      change_summary: string;
      details: Record<string, unknown>;
    },
  ): Promise<Result<DocRecord, LoreError>> {
    const now = new Date().toISOString();
    const newVersion = plan.version + 1;
    const newExtra: Record<string, unknown> = { ...plan.extra, phases };

    return this.store.updateWithProvenance(
      plan.id,
      { extra: newExtra, updated_at: now, version: newVersion },
      { expected_version: plan.version },
      {
        doc_id: plan.id,
        version: newVersion,
        content: plan.content,
        extra: newExtra,
        // ⛔ The ADR's non-demotion half, expressed as data: the snapshot carries the
        // plan's CURRENT status, never a recomputed one.
        status: plan.status,
        title: plan.title,
        action: "update",
        created_at: now,
        created_by: "system",
        change_summary: opts.change_summary,
        // SPEC-072 D1/D2 — this write path only touches `extra`; carry the
        // current (unchanged) slug.
        slug: plan.slug,
      },
      {
        timestamp: now,
        actor: "system",
        session_id: plan.id,
        action: "update",
        doc_id: plan.id,
        details: {
          ...opts.details,
          operation: opts.operation,
          phase_count: phases.length,
          version: newVersion,
        },
      },
    );
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
