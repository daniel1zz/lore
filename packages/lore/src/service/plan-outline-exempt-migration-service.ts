/**
 * PlanOutlineExemptMigrationService — the ONE-TIME migration that removes the legacy outline-sync exemption
 * field (`plan.extra.prd_sync_exempt`) from every stored plan (`lore migrate plan-outline-exempt [--apply]`;
 * BL-D2, baseline-close-a-plan BR-250).
 *
 * Purpose: the exemption's writer (the retired outline exemption verb) and its reader (the plan-close outline-sync predicate)
 * were retired by slice 3a (BR-985); what remained was inert stored data plus a refusal of edits to it and a
 * `lore status` listing of it. This migration deletes the data so the refusal and listing could be deleted too.
 *
 * Public surface: {@link PlanOutlineExemptMigrationService} (`preview`, `apply`), {@link PlanOutlineExemptReport}.
 *
 * Invariants:
 *   - KEY PRESENCE decides, never value shape: a malformed value is migrated too (a shape check here would
 *     skip it and leave the very residue this migration exists to remove, in silence).
 *   - Every other `extra` key, the status and the title are untouched; the removed value is recorded verbatim in
 *     the audit row (`details.removed`), so nothing is lost without a trace.
 *   - Idempotent: a plan without the key is never written, so a second `apply` writes nothing.
 *   - Writes go through the one write route (`DocWritePort.writeDoc`, `lock: "none"` — an archived plan is
 *     migrated like any other); a per-plan write failure is collected into `errors`, never aborts the rest.
 *   - A failing corpus read is RETURNED (`err`), never reported as an empty migration.
 *
 * Side-effect class: IO (store reads; writes only through the injected write route).
 */

import { ok } from "@lore/core";
import type { DocId, DocRecord, LoreError, Result } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import type { DocWritePort } from "./corpus-service.js";

/** The legacy `extra` key this migration removes. */
const LEGACY_EXEMPT_KEY = "prd_sync_exempt";

/** `details.operation` of every audit row this migration writes (grep-friendly, stable). */
export const PLAN_OUTLINE_EXEMPT_MIGRATE_OPERATION = "plan-outline-exempt-migrate";

/** One plan the migration lists or migrated. */
export interface PlanOutlineExemptRow {
  readonly slug: string;
  readonly doc_id: DocId;
}

/** What {@link PlanOutlineExemptMigrationService.preview} / `apply` report. */
export interface PlanOutlineExemptReport {
  /** Plans listed (`preview`) or actually written (`apply`). */
  readonly count: number;
  readonly rows: readonly PlanOutlineExemptRow[];
  /** Per-plan write failures (`apply` only); a failed plan is excluded from `count` and `rows`. */
  readonly errors: readonly string[];
}

export class PlanOutlineExemptMigrationService {
  /**
   * @param store - read access to the corpus
   * @param writer - the one write route (`CorpusService`), the only way this service writes
   */
  constructor(
    private readonly store: StoreInterface,
    private readonly writer: DocWritePort,
  ) {}

  /**
   * Lists every non-deleted plan carrying the legacy key. Writes nothing.
   *
   * @returns `ok(report)` with rows sorted by slug; `err` when the corpus read fails
   * @example
   * await service.preview(); // => ok({ count: 2, rows: [{ slug: "plan-a", ... }, ...], errors: [] })
   */
  async preview(): Promise<Result<PlanOutlineExemptReport, LoreError>> {
    const carriers = await this.findCarriers();
    if (!carriers.ok) return carriers;
    const rows = carriers.value.map((doc) => ({ slug: doc.slug, doc_id: doc.id }));
    return ok({ count: rows.length, rows, errors: [] });
  }

  /**
   * Removes the legacy key from every plan {@link preview} lists, one write each, recording the removed value in
   * the audit row.
   *
   * @returns `ok(report)` — `count` is the number of plans actually written; a per-plan failure lands in
   *   `errors`; `err` only when the corpus read itself fails
   * @example
   * await service.apply(); // => ok({ count: 2, rows: [...], errors: [] }); a second call => ok({ count: 0, ... })
   */
  async apply(): Promise<Result<PlanOutlineExemptReport, LoreError>> {
    const carriers = await this.findCarriers();
    if (!carriers.ok) return carriers;
    const written: PlanOutlineExemptRow[] = [];
    const errors: string[] = [];
    for (const plan of carriers.value) {
      const { [LEGACY_EXEMPT_KEY]: removed, ...remaining } = plan.extra;
      const result = await this.writer.writeDoc({
        doc: plan,
        patch: { extra: remaining },
        action: "update",
        changeSummary: `Legacy outline-sync exemption (${LEGACY_EXEMPT_KEY}) removed`,
        auditAction: "update",
        auditDetails: { operation: PLAN_OUTLINE_EXEMPT_MIGRATE_OPERATION, removed },
        lock: "none",
      });
      if (result.ok) written.push({ slug: plan.slug, doc_id: plan.id });
      else errors.push(`${plan.slug}: ${result.error.code}`);
    }
    return ok({ count: written.length, rows: written, errors });
  }

  private async findCarriers(): Promise<Result<DocRecord[], LoreError>> {
    const plans = await this.store.findMany({ type: "plan" });
    if (!plans.ok) return plans;
    const carriers = plans.value
      .filter((doc) => doc.deleted_at === null && LEGACY_EXEMPT_KEY in doc.extra)
      .sort((a, b) => a.slug.localeCompare(b.slug));
    return ok(carriers);
  }
}
