/**
 * ReviewService — human-in-the-loop review workflow for documents.
 * Manages pending review queue, approval, and rejection of draft documents.
 * Source: SPEC-005 §3, SPEC-001 §3.2
 */

import type { DocId, DocRecord, DocType } from "../core/types.js";
import { err, ok, type LoreError, type Result } from "../core/errors.js";
import { getAllowedTransitions, isValidTransition } from "../core/schemas.js";
import type { StoreInterface } from "../store/store-interface.js";

const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

// ─── Public Types ──────────────────────────────────────────────────────────

/**
 * A document waiting for human review.
 * Subset of DocRecord with review-relevant fields.
 */
export interface PendingDoc {
  id: DocId;
  type: DocType;
  title: string;
  status: "draft";
  created_by: string;
  updated_at: string;
  version: number;
  change_summary?: string;
}

export interface PendingFilters {
  /** Filter by document creator (created_by) */
  author?: string;
  /** Filter by document type */
  type?: DocType;
  /** ISO 8601 — only docs updated at or after this time */
  since?: string;
}

export interface ApproveOpts {
  /** Reviewer identity — defaults to "system" if omitted */
  reviewer?: string;
}

export interface RejectOpts {
  /** Reviewer identity — defaults to "system" if omitted */
  reviewer?: string;
  /** Reason for rejection — stored in audit entry */
  reason?: string;
}

// ─── ReviewService ─────────────────────────────────────────────────────────

/**
 * ReviewService — stateless service, all state in StoreInterface.
 * All methods return Result<T, LoreError> — never throw.
 */
export class ReviewService {
  constructor(private readonly store: StoreInterface) {}

  private resolveDoc(idOrSlug: string): Result<DocRecord, LoreError> {
    const isUlid = ULID_REGEX.test(idOrSlug);
    const findResult = isUlid
      ? this.store.find(idOrSlug)
      : this.store.findBySlug(idOrSlug);
    if (!findResult.ok) return findResult;
    if (findResult.value === null) {
      return err({ code: "DOC_NOT_FOUND", id: idOrSlug });
    }
    return ok(findResult.value);
  }

  /**
   * Return all documents with status='draft' matching optional filters.
   * Source: SPEC-005 §3, AC row 1.
   */
  pending(filters?: PendingFilters): Result<PendingDoc[], LoreError> {
    const storeFilters: import("../store/store-interface.js").StoreFilters = {
      status: "draft",
      ...(filters?.author !== undefined ? { created_by: filters.author } : {}),
      ...(filters?.type !== undefined ? { type: filters.type } : {}),
      ...(filters?.since !== undefined ? { since: filters.since } : {}),
    };

    const result = this.store.findMany(storeFilters);
    if (!result.ok) return result;

    const pendingDocs: PendingDoc[] = result.value.map((doc) =>
      toPendingDoc(doc),
    );

    return ok(pendingDocs);
  }

  /**
   * Approve a document — transition status to 'approved'.
   * Creates a version snapshot and audit entry.
   * Source: SPEC-005 §3, §4, AC rows 2, 6.
   */
  approve(
    id: string,
    opts?: ApproveOpts,
  ): Result<DocRecord, LoreError> {
    const findResult = this.resolveDoc(id);
    if (!findResult.ok) return findResult;

    const doc = findResult.value;

    if (!isValidTransition(doc.status, "approved")) {
      return err({
        code: "INVALID_TRANSITION",
        from: doc.status,
        to: "approved",
        allowed: getAllowedTransitions(doc.status),
      });
    }

    const reviewer = opts?.reviewer ?? "system";
    const now = new Date().toISOString();
    const nextVersion = doc.version + 1;

    const updateResult = this.store.update(doc.id, {
      status: "approved",
      version: nextVersion,
      updated_at: now,
    });
    if (!updateResult.ok) return updateResult;

    const updatedDoc = updateResult.value;

    const versionResult = this.store.insertVersion({
      doc_id: doc.id,
      version: nextVersion,
      content: updatedDoc.content,
      extra: updatedDoc.extra,
      status: "approved",
      title: updatedDoc.title,
      action: "approve",
      created_at: now,
      created_by: reviewer,
    });
    if (!versionResult.ok) return versionResult;

    const auditResult = this.store.appendAuditEntry({
      timestamp: now,
      actor: reviewer,
      session_id: `review-${doc.id}`,
      action: "approve",
      doc_id: doc.id,
      details: { reviewer, from_status: doc.status, to_status: "approved" },
    });
    if (!auditResult.ok) return auditResult;

    return ok(updatedDoc);
  }

  /**
   * Reject a document — status stays 'draft', reason recorded in audit.
   * Source: SPEC-005 §3, §4, AC rows 4, table row "draft|reject|draft".
   * Only docs in 'draft' or 'in-review' can be rejected.
   */
  reject(
    id: string,
    opts?: RejectOpts,
  ): Result<DocRecord, LoreError> {
    const findResult = this.resolveDoc(id);
    if (!findResult.ok) return findResult;

    const doc = findResult.value;

    // Only 'draft' and 'in-review' can be rejected (they can transition back to draft)
    const canReject =
      doc.status === "draft" || doc.status === "in-review";

    if (!canReject) {
      return err({
        code: "INVALID_TRANSITION",
        from: doc.status,
        to: "draft",
        allowed: getAllowedTransitions(doc.status),
      });
    }

    const reviewer = opts?.reviewer ?? "system";
    const reason = opts?.reason;
    const now = new Date().toISOString();

    // Status stays 'draft' — just update updated_at
    const updateResult = this.store.update(doc.id, {
      status: "draft",
      updated_at: now,
    });
    if (!updateResult.ok) return updateResult;

    const updatedDoc = updateResult.value;

    const auditDetails: Record<string, unknown> = {
      reviewer,
      from_status: doc.status,
      to_status: "draft",
    };
    if (reason !== undefined) {
      auditDetails["reason"] = reason;
    }

    const auditResult = this.store.appendAuditEntry({
      timestamp: now,
      actor: reviewer,
      session_id: `review-${doc.id}`,
      action: "reject",
      doc_id: doc.id,
      details: auditDetails,
    });
    if (!auditResult.ok) return auditResult;

    return ok(updatedDoc);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function toPendingDoc(doc: DocRecord): PendingDoc {
  return {
    id: doc.id,
    type: doc.type,
    title: doc.title,
    status: "draft",
    created_by: doc.created_by,
    updated_at: doc.updated_at,
    version: doc.version,
  };
}
