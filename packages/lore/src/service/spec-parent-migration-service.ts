/**
 * SpecParentMigrationService — one-shot, idempotent, reversible clearing of every spec's `parent_id`
 * (`lore migrate spec-parents [--apply | --revert]`; BR-1009, BR-798, BR-801; AC-BLS3B-7).
 *
 * Public surface: {@link SpecParentMigrationService.preview}, {@link SpecParentMigrationService.apply},
 * {@link SpecParentMigrationService.revert}.
 *
 * Invariants:
 *  1. A spec belongs to the baseline trees through citations, not a `parent_id` (BR-1009). `apply` clears
 *     the parent of every non-deleted spec that still has one, ONE `setDocParentWithProvenance`
 *     transaction per spec: the column, any `parent` link row, and ONE `migrate_spec_parent` audit entry
 *     naming `old_parent_id` land together or not at all.
 *  2. No `versions` row, no `status`/`version` change — an approved spec stays approved and its review
 *     judgment stays current (the store method guarantees this; this service never calls `update`).
 *  3. Idempotent: `apply` selects only specs whose parent is still set, so a second run writes nothing.
 *     `revert` selects only specs whose parent is null AND whose LATEST `migrate_spec_parent` entry names
 *     an old parent, so a second run writes nothing (the restored parent makes the spec ineligible).
 *  4. `revert` never restores a dangling parent: when the recorded old parent is missing or soft-deleted
 *     the spec is reported in `skipped` with the reason, not silently restored.
 *  5. `preview` performs zero writes and returns the exact set `apply` would write.
 *
 * Side-effect class: IO (StoreInterface reads/writes; no AI, no telemetry, no gate — a one-shot migration
 * path, same precedent as `OrdinalMigrationService`/`PhaseMigrationService`).
 */

import { z } from "zod";
import { ok } from "@lore/core";
import type { DocId, DocRecord, LoreError, Result } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { bareDocWriter, type DocWritePort } from "./corpus-service.js";

/** Audit action written by {@link SpecParentMigrationService.apply}; `revert` reads it back. */
export const MIGRATE_SPEC_PARENT_ACTION = "migrate_spec_parent";
/** Audit action written by {@link SpecParentMigrationService.revert}. */
export const REVERT_SPEC_PARENT_ACTION = "revert_spec_parent";

const migrateDetailsSchema = z.object({ old_parent_id: z.string().min(1) });

/** One spec the migration would touch (preview) or did touch (apply/revert). */
export interface SpecParentRow {
  readonly slug: string;
  readonly doc_id: DocId;
  /** The parent id cleared by apply / restored by revert. */
  readonly parent_id: DocId;
}

/** A spec revert declined to restore, with the reason — never silently dropped. */
export interface SpecParentSkip {
  readonly slug: string;
  readonly reason: string;
}

/** Result of preview / apply / revert. `count === rows.length`. */
export interface SpecParentReport {
  readonly count: number;
  readonly rows: readonly SpecParentRow[];
  readonly skipped: readonly SpecParentSkip[];
  /** Per-spec write failures; a failure never aborts the remaining specs. */
  readonly errors: readonly string[];
}

export class SpecParentMigrationService {
  constructor(
    private readonly store: StoreInterface,
    // reason: AC-DCL-5 — the ONE write route (`CorpusService`); `app.ts` passes the composed one, a bare test gets a
    // bare writer. This service never calls a store `*WithProvenance` write itself.
    writer?: DocWritePort,
  ) {
    this.writer = writer ?? bareDocWriter(store);
  }

  private readonly writer: DocWritePort;

  /**
   * List the specs `apply` would clear — every non-deleted spec with a `parent_id`. Writes nothing.
   *
   * @returns `ok(report)` with `rows` sorted by slug; `err` when the store read fails
   */
  async preview(): Promise<Result<SpecParentReport, LoreError>> {
    const specs = await this.store.findMany({ type: "spec" });
    if (!specs.ok) return specs;
    const rows = specs.value
      .filter((doc): doc is DocRecord & { parent_id: DocId } => doc.parent_id !== null)
      .map((doc) => ({ slug: doc.slug, doc_id: doc.id, parent_id: doc.parent_id }))
      .sort((a, b) => a.slug.localeCompare(b.slug));
    return ok({ count: rows.length, rows, skipped: [], errors: [] });
  }

  /**
   * Clear the parent of every spec {@link preview} lists, one transaction and one audit entry each.
   *
   * @returns `ok(report)` — `count` is the number of specs actually written; a per-spec failure is
   *   collected into `errors` (and excluded from `count`/`rows`), never thrown
   */
  async apply(): Promise<Result<SpecParentReport, LoreError>> {
    const planned = await this.preview();
    if (!planned.ok) return planned;
    const written: SpecParentRow[] = [];
    const errors: string[] = [];
    for (const row of planned.value.rows) {
      const result = await this.writer.setDocParent({
        docId: row.doc_id,
        parentId: null,
        auditAction: MIGRATE_SPEC_PARENT_ACTION,
        auditSessionId: `spec-parent-migration-${row.doc_id}`,
        auditDetails: { old_parent_id: row.parent_id },
      });
      if (result.ok) written.push(row);
      else errors.push(`${row.slug}: ${describeError(result.error)}`);
    }
    return ok({ count: written.length, rows: written, skipped: [], errors });
  }

  /**
   * Restore `parent_id` on every spec whose parent is null and whose latest `migrate_spec_parent` audit
   * entry names an old parent, one transaction and one `revert_spec_parent` entry each.
   *
   * @returns `ok(report)` — `count` is the number of specs restored; specs that cannot be restored
   *   (missing or deleted old parent, malformed audit details) land in `skipped`
   */
  async revert(): Promise<Result<SpecParentReport, LoreError>> {
    const specs = await this.store.findMany({ type: "spec" });
    if (!specs.ok) return specs;
    const restored: SpecParentRow[] = [];
    const skipped: SpecParentSkip[] = [];
    const errors: string[] = [];

    for (const doc of specs.value) {
      if (doc.parent_id !== null) continue;
      const audit = await this.store.queryAudit({ doc_id: doc.id, action: MIGRATE_SPEC_PARENT_ACTION, limit: 1 });
      if (!audit.ok) return audit;
      const latest = audit.value[0];
      if (latest === undefined) continue;

      const details = migrateDetailsSchema.safeParse(latest.details);
      if (!details.success) {
        skipped.push({ slug: doc.slug, reason: `latest ${MIGRATE_SPEC_PARENT_ACTION} entry has no old_parent_id` });
        continue;
      }
      const oldParentId = details.data.old_parent_id;
      const parent = await this.store.find(oldParentId);
      if (!parent.ok) return parent;
      if (parent.value === null || parent.value.deleted_at !== null) {
        skipped.push({ slug: doc.slug, reason: `old parent ${oldParentId} is missing or deleted` });
        continue;
      }

      const result = await this.writer.setDocParent({
        docId: doc.id,
        parentId: oldParentId,
        auditAction: REVERT_SPEC_PARENT_ACTION,
        auditSessionId: `spec-parent-revert-${doc.id}`,
        auditDetails: { restored_parent_id: oldParentId },
      });
      if (result.ok) restored.push({ slug: doc.slug, doc_id: doc.id, parent_id: oldParentId });
      else errors.push(`${doc.slug}: ${describeError(result.error)}`);
    }
    restored.sort((a, b) => a.slug.localeCompare(b.slug));
    return ok({ count: restored.length, rows: restored, skipped, errors });
  }
}

function describeError(error: LoreError): string {
  return "message" in error && typeof error.message === "string" ? `${error.code}: ${error.message}` : error.code;
}
