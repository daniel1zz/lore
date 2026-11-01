/**
 * LegacyClassificationService: decide once which documents are completed (legacy-frozen) and which are open.
 *
 * Purpose: AC-ST-7 of spec-every-document-is-stored-as-structured-fields-validated-by. `lore migrate legacy --apply`
 *   stores `extra.legacy` on every completed document of a templated type; `lore convert --list` reads what is left.
 * Public surface: {@link LegacyClassificationService} (`classify`, `apply`, `listOpen`), {@link isCompletedDocument},
 *   {@link LegacyCorpusPort}, {@link OpenDocumentRow}, {@link LegacyClassificationReport}.
 * Invariants:
 *   - Completed = status archived or deprecated; or a LOCKED spec/adr (status approved or active) with at least one
 *     implementing plan (a plan whose parent is the record) and every such plan archived. A locked record with no plan
 *     is OPEN: its work has not started. A plan that is deprecated or still open keeps the record open.
 *   - Templated types are the `doc_type`s of the corpus's approved templates; a document of another type is never
 *     classified, and the template type itself never is (it is validated by the core meta-schema).
 *   - Open = templated type, not deleted, no `template_ref`, no legacy marker, not completed. A document that completes
 *     after the last `apply` is excluded from the open list at once (it is waiting for the next `apply`, not for a conversion).
 *   - `apply` is idempotent: a marked document is never written again, so a second run writes nothing. Writes go through
 *     the one write route with `lock: "none"` (a locked or archived record is classified like any other); one failing
 *     document is collected into `errors` and never aborts the rest.
 * Side-effect class: IO (corpus reads; writes only through the injected write route, none in `classify` / `listOpen`).
 */

import { ok, type DocRecord, type LoreError, type Result } from "@lore/core";
import type { DocWritePort } from "./corpus-service.js";
import { buildLegacyMarker, isLegacyFrozen } from "./legacy-freeze.js";

/** The corpus reads this service needs (structural: `CorpusService` satisfies it). */
export interface LegacyCorpusPort extends Pick<DocWritePort, "writeDoc"> {
  listFull(filters: { type?: DocRecord["type"] }): Promise<Result<{ docs: DocRecord[]; total: number }, LoreError>>;
  /** The doc types that have an approved template (so are "templated"). */
  templatedTypes(): Promise<Result<ReadonlySet<string>, LoreError>>;
}

/** One open legacy document: what `lore convert --list` prints. */
export interface OpenDocumentRow {
  readonly slug: string;
  readonly type: string;
  readonly owner: string;
  readonly status: string;
}

/** What `classify` / `apply` report. */
export interface LegacyClassificationReport {
  /** Completed documents `classify` would freeze, or that `apply` froze. */
  readonly frozen: readonly { readonly slug: string; readonly type: string }[];
  /** Open documents left for `lore convert`. */
  readonly open: readonly OpenDocumentRow[];
  /** Per-document write failures (`apply` only). */
  readonly errors: readonly string[];
}

const LOCKED_RECORD_TYPES: readonly string[] = ["spec", "adr"];
const LOCKED_STATUSES: readonly string[] = ["approved", "active"];
const TERMINAL_STATUSES: readonly string[] = ["archived", "deprecated"];

/**
 * @param doc - a stored document
 * @param plansOf - every non-deleted plan whose parent is `doc` (only read for a locked spec/adr)
 * @returns true when the document is completed under the AC-ST-7 definition
 * @example
 * isCompletedDocument(approvedSpec, []); // => false (a locked record with no plan is open)
 */
export function isCompletedDocument(doc: DocRecord, plansOf: readonly DocRecord[]): boolean {
  if (TERMINAL_STATUSES.includes(doc.status)) return true;
  if (!LOCKED_RECORD_TYPES.includes(doc.type) || !LOCKED_STATUSES.includes(doc.status)) return false;
  return plansOf.length > 0 && plansOf.every((plan) => plan.status === "archived");
}

export class LegacyClassificationService {
  constructor(private readonly corpus: LegacyCorpusPort) {}

  /**
   * Classify every templated, unconverted, unmarked document without writing.
   *
   * @returns the documents that would be frozen and the open ones, both sorted by slug; or the read failure
   */
  async classify(): Promise<Result<LegacyClassificationReport, LoreError>> {
    const scanned = await this.scan();
    if (!scanned.ok) return scanned;
    return ok({ frozen: scanned.value.completed.map((doc) => ({ slug: doc.slug, type: doc.type })), open: scanned.value.open, errors: [] });
  }

  /**
   * Freeze every completed document `classify` lists, one write each.
   *
   * @param opts - `by` names the acting identity on the version and audit rows
   * @param opts.now - timestamp seam for the marker (default now)
   * @returns the frozen documents (those actually written), the open ones, and per-document failures
   */
  async apply(opts: { by?: string; now?: string } = {}): Promise<Result<LegacyClassificationReport, LoreError>> {
    const scanned = await this.scan();
    if (!scanned.ok) return scanned;
    const now = opts.now ?? new Date().toISOString();
    const frozen: { slug: string; type: string }[] = [];
    const errors: string[] = [];
    for (const doc of scanned.value.completed) {
      const written = await this.corpus.writeDoc({
        doc,
        patch: { extra: { ...doc.extra, legacy: buildLegacyMarker(now) } },
        action: "update",
        changeSummary: "Classified legacy-frozen (completed before structured templates)",
        auditAction: "update",
        auditDetails: { operation: "legacy-freeze" },
        lock: "none",
        now,
        ...(opts.by !== undefined ? { by: opts.by } : {}),
      });
      if (written.ok) frozen.push({ slug: doc.slug, type: doc.type });
      else errors.push(`${doc.slug}: ${written.error.code}: ${"message" in written.error ? written.error.message : ""}`);
    }
    return ok({ frozen, open: scanned.value.open, errors });
  }

  /**
   * The open legacy documents (`lore convert --list`).
   *
   * @returns open rows sorted by slug, or the read failure
   */
  async listOpen(): Promise<Result<readonly OpenDocumentRow[], LoreError>> {
    const scanned = await this.scan();
    return scanned.ok ? ok(scanned.value.open) : scanned;
  }

  /**
   * Whether one document is completed right now (the live rule, not the stored marker).
   *
   * @param doc - a stored document
   * @returns true when completed or already marked frozen
   */
  async isCompleted(doc: DocRecord): Promise<Result<boolean, LoreError>> {
    if (isLegacyFrozen(doc)) return ok(true);
    if (!LOCKED_RECORD_TYPES.includes(doc.type) || !LOCKED_STATUSES.includes(doc.status)) return ok(isCompletedDocument(doc, []));
    const plans = await this.corpus.listFull({ type: "plan" });
    if (!plans.ok) return plans;
    return ok(isCompletedDocument(doc, plans.value.docs.filter((plan) => plan.parent_id === doc.id && plan.deleted_at === null)));
  }

  private async scan(): Promise<Result<{ completed: DocRecord[]; open: OpenDocumentRow[] }, LoreError>> {
    const types = await this.corpus.templatedTypes();
    if (!types.ok) return types;
    const plans = await this.corpus.listFull({ type: "plan" });
    if (!plans.ok) return plans;
    const plansByParent = new Map<string, DocRecord[]>();
    for (const plan of plans.value.docs) {
      if (plan.deleted_at !== null || plan.parent_id === null) continue;
      plansByParent.set(plan.parent_id, [...(plansByParent.get(plan.parent_id) ?? []), plan]);
    }
    const completed: DocRecord[] = [];
    const open: OpenDocumentRow[] = [];
    for (const type of [...types.value].filter((candidate) => candidate !== "template").sort()) {
      const docs = await this.corpus.listFull({ type: type as DocRecord["type"] });
      if (!docs.ok) return docs;
      for (const doc of docs.value.docs) {
        if (doc.deleted_at !== null || isLegacyFrozen(doc) || typeof doc.extra["template_ref"] === "string") continue;
        if (isCompletedDocument(doc, plansByParent.get(doc.id) ?? [])) completed.push(doc);
        else open.push({ slug: doc.slug, type: doc.type, owner: doc.created_by, status: doc.status });
      }
    }
    const bySlug = (a: { slug: string }, b: { slug: string }): number => a.slug.localeCompare(b.slug);
    return ok({ completed: completed.sort(bySlug), open: open.sort(bySlug) });
  }
}
