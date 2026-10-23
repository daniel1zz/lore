/**
 * Plan progress — the pure rules of the plan's stored aggregate `extra.progress`
 * (spec-plans-close-themselves-level-triggered-reconciliation-of §"Plan progress, written with the task transition",
 * BR-1379; reference: Rails `counter_cache`, an aggregate written in the same transaction as the child row).
 *
 * Purpose: decide, from a plan's member rows, what `extra.progress` must be, build the plan's companion write
 * (patch + version row + audit row) and the refusals of the archived-is-terminal rule — with NO IO, so all three
 * stores (SQLite, Turso, InMemory) apply the identical rule inside their own write transaction.
 *
 * Public surface: {@link PlanProgressSchema} / {@link PlanProgress}, {@link computePlanProgress},
 * {@link planIdsAffectedBy}, {@link buildPlanProgressWrite}, {@link withInitialPlanProgress},
 * {@link keepStoredPlanProgress}, {@link refuseArchivedTerminal}, {@link PLAN_MEMBER_TERMINAL_STATUSES}.
 *
 * Invariants:
 *   - A plan's members are its tasks (`extra.plan_id`, the declared membership; see `service/plan-membership.ts`)
 *     and its `phase` docs (`parent_id`), soft-deleted rows excluded. `open` counts members whose status is not
 *     `archived` / `deprecated` (the same terminal set `lore bulk` uses); `total` counts all members.
 *   - `state` is `empty` (no member), `complete` (members, none open) or `in-progress`.
 *   - `at` is the time of the write that last changed `state`, `open` or `total`; a write that leaves the three
 *     unchanged writes nothing (no version churn).
 *   - No standing recompute command exists: progress is maintained by the write path alone (plus the one migration
 *     backfill), so a reader never handles a missing value.
 *
 * Side-effect class: pure.
 */

import type { AuditEntry, DocId, DocRecord, DocStatus, LoreError, VersionRecord } from "@lore/core";
import { z } from "zod";

/** The stored aggregate: SSOT for `extra.progress`. */
export const PlanProgressSchema = z.object({
  state: z.enum(["in-progress", "complete", "empty"]),
  open: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  at: z.string(),
});

/** `plan.extra.progress`. */
export type PlanProgress = z.infer<typeof PlanProgressSchema>;

/** A member in a terminal status is finished work: it is not `open`. */
export const PLAN_MEMBER_TERMINAL_STATUSES: ReadonlySet<DocStatus> = new Set<DocStatus>(["archived", "deprecated"]);

/** The slice of a member row progress is computed from. */
export interface PlanMemberRow {
  readonly status: DocStatus;
}

/**
 * Compute a plan's progress from its current member rows.
 *
 * @param members - every non-deleted task and phase of the plan, read inside the write transaction
 * @param at - timestamp recorded when this value differs from the stored one
 * @returns the progress value
 * @example computePlanProgress([{ status: "archived" }, { status: "active" }], t) // { state: "in-progress", open: 1, total: 2, at: t }
 */
export function computePlanProgress(members: readonly PlanMemberRow[], at: string): PlanProgress {
  const total = members.length;
  const open = members.filter((member) => !PLAN_MEMBER_TERMINAL_STATUSES.has(member.status)).length;
  const state = total === 0 ? "empty" : open === 0 ? "complete" : "in-progress";
  return { state, open, total, at };
}

/** The stored progress of a plan, or `null` when absent or malformed (the migration backfill makes absence a defect). */
export function readStoredPlanProgress(extra: Readonly<Record<string, unknown>>): PlanProgress | null {
  const parsed = PlanProgressSchema.safeParse(extra["progress"]);
  return parsed.success ? parsed.data : null;
}

/** The plan a doc counts toward: a task's declared `extra.plan_id`, a phase's `parent_id`; `null` for any other doc. */
function planIdOf(doc: DocRecord | null): DocId | null {
  if (doc === null) return null;
  if (doc.type === "task") {
    const declared = doc.extra["plan_id"];
    return typeof declared === "string" && declared !== "" ? declared : null;
  }
  if (doc.type === "phase") return doc.parent_id ?? null;
  return null;
}

/**
 * The plans whose progress a write of one doc can change: the plan of the doc before the write and the plan after it
 * (they differ when a task is re-filed), de-duplicated.
 *
 * @param before - the doc as stored before the write (`null` for an insert)
 * @param after - the doc as stored after the write (`null` never; a soft delete passes the pre-delete row as `before`
 *   and `null` as `after`)
 */
export function planIdsAffectedBy(before: DocRecord | null, after: DocRecord | null): DocId[] {
  const ids = [planIdOf(before), planIdOf(after)].filter((id): id is DocId => id !== null);
  return [...new Set(ids)];
}

/** The plan-membership predicate in SQL form: tasks by declared plan, phases by parent. Bound parameters: `[planId, planId]`. */
export const PLAN_MEMBERS_SQL =
  "SELECT status FROM docs WHERE deleted_at IS NULL AND " +
  "((type = 'task' AND json_extract(extra, '$.plan_id') = ?) OR (type = 'phase' AND parent_id = ?))";

/** What a store needs to apply one plan progress write in the transaction it already holds. */
export interface PlanProgressWrite {
  readonly planId: DocId;
  readonly patch: Pick<DocRecord, "extra" | "version" | "updated_at">;
  readonly expectedVersion: number;
  readonly version: VersionRecord;
  readonly audit: AuditEntry;
}

/** Who and when a progress write is attributed to: the run and actor of the write that caused it. */
export interface PlanProgressCause {
  readonly now: string;
  readonly actor: string;
  readonly harnessRun: string | null;
  /** The doc whose write caused the recompute. */
  readonly causeDocId: DocId;
}

/**
 * Build the plan's companion write, or `null` when the stored progress already equals the computed one.
 *
 * @param plan - the plan row as stored now (read inside the transaction)
 * @param members - the plan's member rows, read inside the same transaction AFTER the primary write
 * @param cause - attribution
 */
export function buildPlanProgressWrite(
  plan: DocRecord,
  members: readonly PlanMemberRow[],
  cause: PlanProgressCause,
): PlanProgressWrite | null {
  const stored = readStoredPlanProgress(plan.extra);
  const computed = computePlanProgress(members, cause.now);
  if (stored !== null && stored.state === computed.state && stored.open === computed.open && stored.total === computed.total) {
    return null;
  }
  const extra = { ...plan.extra, progress: computed };
  const nextVersion = plan.version + 1;
  return {
    planId: plan.id,
    patch: { extra, version: nextVersion, updated_at: cause.now },
    expectedVersion: plan.version,
    version: {
      doc_id: plan.id,
      version: nextVersion,
      content: plan.content,
      extra,
      status: plan.status,
      title: plan.title,
      action: "update",
      created_at: cause.now,
      created_by: cause.actor,
      change_summary: `plan progress ${computed.state} (${computed.open} open of ${computed.total})`,
      slug: plan.slug,
      harness_run: cause.harnessRun,
    },
    audit: {
      timestamp: cause.now,
      actor: cause.actor,
      session_id: plan.id,
      action: "update",
      doc_id: plan.id,
      details: {
        operation: "plan-progress",
        caused_by: cause.causeDocId,
        progress: computed,
        version: nextVersion,
        new_version: nextVersion,
      },
      harness_run: cause.harnessRun,
    },
  };
}

/**
 * A new plan is born with its progress (no member yet: `empty`), so no plan ever lacks the field. Applied to the doc
 * and its version-1 snapshot together. Any other doc, and a plan that already carries valid progress, is unchanged.
 */
export function withInitialPlanProgress(
  doc: DocRecord,
  version: VersionRecord,
): { readonly doc: DocRecord; readonly version: VersionRecord } {
  if (doc.type !== "plan" || readStoredPlanProgress(doc.extra) !== null) return { doc, version };
  const progress = computePlanProgress([], doc.created_at);
  return {
    doc: { ...doc, extra: { ...doc.extra, progress } },
    version: { ...version, extra: { ...version.extra, progress } },
  };
}

/**
 * A plan edit that rebuilds `extra` without `progress` must not drop it: the stored value is carried into the patch
 * and the version snapshot. Anything else is returned unchanged.
 */
export function keepStoredPlanProgress(
  stored: DocRecord,
  patch: Partial<DocRecord>,
  version: VersionRecord,
): { readonly patch: Partial<DocRecord>; readonly version: VersionRecord } {
  if (stored.type !== "plan" || patch.extra === undefined) return { patch, version };
  const carried = readStoredPlanProgress(stored.extra);
  if (carried === null || readStoredPlanProgress(patch.extra) !== null) return { patch, version };
  return {
    patch: { ...patch, extra: { ...patch.extra, progress: carried } },
    version: { ...version, extra: { ...version.extra, progress: carried } },
  };
}

/**
 * The archived-is-terminal refusals (BR-1379): `archived` is terminal for a plan and its tasks, so (a) a task or
 * phase may not be created under an archived plan and (b) an archived task may not move to any other status. Both
 * are `VALIDATION_ERROR` (exit 4) and write nothing.
 *
 * @param before - the doc as stored before the write (`null` for an insert)
 * @param after - the doc as it would be after the write
 * @param planStatus - the status of the doc's plan, or `null` when it has no (live) plan
 * @returns the refusal, or `null` when the write is allowed
 */
export function refuseArchivedTerminal(
  before: DocRecord | null,
  after: DocRecord,
  planStatus: DocStatus | null,
): LoreError | null {
  if (before === null) {
    if ((after.type === "task" || after.type === "phase") && planStatus === "archived") {
      return {
        code: "VALIDATION_ERROR",
        field: after.type === "task" ? "extra.plan_id" : "parent_id",
        message:
          `Cannot create a ${after.type} under an archived plan: archived is terminal (BR-1379). ` +
          "Further work in that area is a new task in a new plan. Nothing was written.",
        value: planIdOf(after),
      };
    }
    return null;
  }
  if (before.type === "task" && before.status === "archived" && after.status !== "archived") {
    return {
      code: "VALIDATION_ERROR",
      field: "status",
      message:
        `Cannot move archived task ${before.slug} to ${after.status}: archived is terminal (BR-1379). ` +
        "Further work is a new task in a new plan. Nothing was written.",
      value: after.status,
    };
  }
  return null;
}
