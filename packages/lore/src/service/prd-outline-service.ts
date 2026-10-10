/**
 * PrdOutlineService — READ-ONLY reader of the root PRD's stored outline (`prd.extra.outline[]`,
 * SPEC-080 C1). Its writers (`outlineSet`, `outlineRm`) and the plan-close exemption writer
 * (`exempt`, `plan.extra.prd_sync_exempt`) were retired by slice 3a (BR-985): the outline is
 * superseded by the baseline tree (`lore baseline add`), and plan-close now reads cited rule state
 * instead of a domain-document edit (BR-984). Existing entries stay readable.
 *
 * Public surface:
 *   outlineList(prdIdOrSlug) → OutlineEntry[]
 *
 * @invariant `outlineList` only operates on a `type: "prd"` document — a spec/task/etc. target
 *   fails loud (`VALIDATION_ERROR` naming "prd").
 * @invariant An absent or schema-invalid `extra.outline` reads as `[]` (schema-based, not
 *   duck-typed — mirrors `AcService`'s `extractCriteria`).
 *
 * Side-effect class: IO (reads via StoreInterface; never writes).
 * Source: SPEC-080 C1; spec-baseline-slice-3a-architecture-tree-baseline-root (Design "Outline")
 */

import {
  err,
  ok,
  outlineEntrySchema,
  type OutlineEntry,
  type Result,
  type LoreError,
  type DocRecord,
} from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { resolveDoc } from "./resolve.js";

export class PrdOutlineService {
  /**
   * @param store - Storage abstraction (same instance passed to AcService/RequirementService)
   */
  constructor(private readonly store: StoreInterface) {}

  /**
   * Return the stored outline entries for a PRD, in declaration order.
   *
   * @param prdIdOrSlug - PRD document ULID or slug
   * @returns The outline array
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a prd)
   */
  async outlineList(prdIdOrSlug: string): Promise<Result<OutlineEntry[], LoreError>> {
    const prdResult = await this.resolvePrd(prdIdOrSlug);
    if (!prdResult.ok) return prdResult;
    return ok(extractOutline(prdResult.value));
  }

  /** Resolves idOrSlug and validates it is a prd document. */
  private async resolvePrd(idOrSlug: string): Promise<Result<DocRecord, LoreError>> {
    const docResult = await resolveDoc(this.store, idOrSlug);
    if (!docResult.ok) return docResult;
    const doc = docResult.value;
    if (doc.type !== "prd") {
      return err({
        code: "VALIDATION_ERROR",
        field: "type",
        message: `Expected a prd document; got type '${doc.type}'`,
        value: doc.type,
      });
    }
    return ok(doc);
  }
}

/**
 * Extract the validated outline array from a PRD DocRecord. Returns [] when `extra.outline` is
 * absent or fails schema validation.
 */
function extractOutline(prd: DocRecord): OutlineEntry[] {
  const parsed = outlineEntrySchema.array().safeParse(prd.extra["outline"]);
  return parsed.success ? parsed.data : [];
}
