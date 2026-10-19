/**
 * OutlineSectionsRetireMigrationService — the ONE-TIME migration that removes the stored outline
 * (`prd.extra.outline`) from every stored PRD (`lore migrate outline-sections [--apply]`; the outline write verbs,
 * their reader and BR-985/BR-694/695/696 are retired with it).
 *
 * End state chosen: ARCHIVE, not convert. The outline entries were a bounded summary of knowledge that the baseline tree
 * and the PRD body now carry; converting them to baseline nodes would invent structure nobody reviewed. Instead the
 * removal is an ordinary document write, so the outline stays readable in two places: the PRD's previous version
 * (`lore log <prd>`, `lore diff <prd>`) and the audit row of the removal (`details.removed`, verbatim).
 *
 * Public surface: {@link OutlineSectionsRetireMigrationService} (`preview`, `apply`), {@link OutlineSectionsRetireReport}.
 *
 * Invariants:
 *   - KEY PRESENCE decides, never value shape: a malformed value is migrated too (a shape check would skip it and leave
 *     the very residue this migration exists to remove, in silence).
 *   - Every other `extra` key, the status, the title and the body are untouched.
 *   - Idempotent: a PRD without the key is never written, so a second `apply` writes nothing.
 *   - Writes go through the one write route (`DocWritePort.writeDoc`, `lock: "none"` — an archived PRD is migrated like
 *     any other); a per-PRD write failure is collected into `errors`, never aborts the rest.
 *   - A failing corpus read is RETURNED (`err`), never reported as an empty migration.
 *
 * Side-effect class: IO (store reads; writes only through the injected write route).
 */

import { ok } from "@lore/core";
import type { DocId, DocRecord, LoreError, Result } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import type { DocWritePort } from "./corpus-service.js";

/** The stored key this migration removes. */
const OUTLINE_KEY = "outline";

/** `details.operation` of every audit row this migration writes (grep-friendly, stable). */
export const OUTLINE_SECTIONS_RETIRE_OPERATION = "outline-sections-retire";

/** One PRD the migration lists or migrated. */
export interface OutlineSectionsRetireRow {
  readonly slug: string;
  readonly doc_id: DocId;
}

/** What {@link OutlineSectionsRetireMigrationService.preview} / `apply` report. */
export interface OutlineSectionsRetireReport {
  /** PRDs listed (`preview`) or actually written (`apply`). */
  readonly count: number;
  readonly rows: readonly OutlineSectionsRetireRow[];
  /** Per-PRD write failures (`apply` only); a failed PRD is excluded from `count` and `rows`. */
  readonly errors: readonly string[];
}

export class OutlineSectionsRetireMigrationService {
  /**
   * @param store - read access to the corpus
   * @param writer - the one write route (`CorpusService`), the only way this service writes
   */
  constructor(
    private readonly store: StoreInterface,
    private readonly writer: DocWritePort,
  ) {}

  /**
   * Lists every non-deleted PRD carrying the stored outline. Writes nothing.
   *
   * @returns `ok(report)` with rows sorted by slug; `err` when the corpus read fails
   * @example
   * await service.preview(); // => ok({ count: 1, rows: [{ slug: "prd-a", ... }], errors: [] })
   */
  async preview(): Promise<Result<OutlineSectionsRetireReport, LoreError>> {
    const carriers = await this.findCarriers();
    if (!carriers.ok) return carriers;
    const rows = carriers.value.map((doc) => ({ slug: doc.slug, doc_id: doc.id }));
    return ok({ count: rows.length, rows, errors: [] });
  }

  /**
   * Removes the outline from every PRD {@link preview} lists, one write each, recording the removed value in the audit
   * row.
   *
   * @returns `ok(report)` — `count` is the number of PRDs actually written; a per-PRD failure lands in `errors`; `err`
   *   only when the corpus read itself fails
   * @example
   * await service.apply(); // => ok({ count: 1, rows: [...], errors: [] }); a second call => ok({ count: 0, ... })
   */
  async apply(): Promise<Result<OutlineSectionsRetireReport, LoreError>> {
    const carriers = await this.findCarriers();
    if (!carriers.ok) return carriers;
    const written: OutlineSectionsRetireRow[] = [];
    const errors: string[] = [];
    for (const prd of carriers.value) {
      const { [OUTLINE_KEY]: removed, ...remaining } = prd.extra;
      const result = await this.writer.writeDoc({
        doc: prd,
        patch: { extra: remaining },
        action: "update",
        changeSummary: "Stored outline removed (archived in the previous version and this audit row)",
        auditAction: "update",
        auditDetails: { operation: OUTLINE_SECTIONS_RETIRE_OPERATION, removed },
        lock: "none",
      });
      if (result.ok) written.push({ slug: prd.slug, doc_id: prd.id });
      else errors.push(`${prd.slug}: ${result.error.code}: ${"message" in result.error ? result.error.message : ""}`);
    }
    return ok({ count: written.length, rows: written, errors });
  }

  private async findCarriers(): Promise<Result<DocRecord[], LoreError>> {
    const prds = await this.store.findMany({ type: "prd" });
    if (!prds.ok) return prds;
    const carriers = prds.value
      .filter((doc) => doc.deleted_at === null && OUTLINE_KEY in doc.extra)
      .sort((a, b) => a.slug.localeCompare(b.slug));
    return ok(carriers);
  }
}
