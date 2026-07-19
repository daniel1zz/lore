/**
 * ReviewService — human-in-the-loop review workflow for documents.
 * Manages pending review queue, approval, and rejection of draft documents.
 * Source: SPEC-005 §3, SPEC-001 §3.2
 */

import type { DocId, DocRecord, DocType, DocTypeMeta, SpecKind } from "@lore/core";
import { err, ok, type LoreError, type Result } from "@lore/core";
import {
  getAllowedTransitions,
  isValidTransition,
  deriveTypeMeta,
  specAcceptanceCriteriaSchema,
  SPEC_KINDS,
} from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { resolveDoc } from "./resolve.js";
import { buildUpstreamSpecContext } from "./checkpoint-registry.js";
import type { GateDependencies } from "./gate-enforcer.js";

// ─── Public Types ──────────────────────────────────────────────────────────

/**
 * A document waiting for human review.
 * Subset of DocRecord with review-relevant fields.
 *
 * @invariant `meta` mirrors `DocSummary.meta` (SPEC-036 §2 D3) — derived by the
 *   same single-derivation-point `deriveTypeMeta` fn used by
 *   `CorpusService.toSummary`. Absent (never a fabricated default) for `prd`
 *   docs or when the doc's type-specific `extra` fields are missing/malformed;
 *   `task.claim_stale` is additionally absent whenever this service wasn't
 *   constructed with `claimTtlMinutes`.
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
  meta?: DocTypeMeta;
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
  /**
   * @param store - Storage abstraction (SQLiteStore, TursoStore, or InMemoryStore)
   * @param claimTtlMinutes - Task claim lease TTL in minutes, forwarded to
   *   `deriveTypeMeta` for `PendingDoc.meta`'s `task.claim_stale` computation
   *   (SPEC-036 §2 D3, pending-queue extension). Same DI shape as
   *   `CorpusService`/`TaskWorkflowService`/`AuditService`'s constructor-resolved
   *   config values. Omitted (not defaulted to 120 here) when the caller doesn't
   *   wire it — `deriveTypeMeta` then omits `claim_stale` entirely rather than
   *   computing it against a value this service invented.
   * @param gate - OPTIONAL gate-enforcement dependency bundle (retro follow-up item 8,
   *   defense-in-depth) — `{enforcer, getPlanBundle}`, see `GateDependencies` JSDoc
   *   (`./gate-enforcer.js`) for why both are bundled as one. When present, `approve`
   *   runs the `spec-promote` checkpoint for a `spec` doc (declared acceptance
   *   criteria count) or the `plan-promote` checkpoint for a `plan` doc (ancestor
   *   spec's approval + AC status, via `getPlanBundle`) before writing the transition.
   *   Absent (the default) → ungated, byte-identical to pre-GateEnforcer behavior —
   *   keeps every bare `new ReviewService(store)` unit test construction green.
   */
  constructor(
    private readonly store: StoreInterface,
    private readonly claimTtlMinutes?: number,
    private readonly gate?: GateDependencies,
  ) {}

  private async resolveDoc(idOrSlug: string): Promise<Result<DocRecord, LoreError>> {
    return resolveDoc(this.store, idOrSlug);
  }

  /**
   * Gates `doc`'s draft→approved TRANSITION (retro follow-up item 8, defense-in-depth) —
   * `spec-promote` for a `spec` doc, `plan-promote` for a `plan` doc. Any other doc
   * type has no registered promote-time checkpoint and passes through untouched. A
   * no-op (`ok(undefined)`) when this service wasn't constructed with a `gate`
   * dependency (see constructor JSDoc).
   *
   * @param doc - The doc `approve()` is about to transition to "approved".
   */
  private async enforceApprovalGate(doc: DocRecord): Promise<Result<void, LoreError>> {
    if (this.gate === undefined) {
      return ok(undefined);
    }

    if (doc.type === "spec") {
      const parsed = specAcceptanceCriteriaSchema.safeParse(doc.extra["acceptance_criteria"]);
      const acceptanceCriteriaCount = parsed.success ? parsed.data.length : 0;
      // reason: SPEC-058 D2 — oracleCoverage judges the spec against ITS OWN
      // spec_kind's configured profile; an absent/invalid value falls back to
      // "feature", the same create-time default `_createImpl` applies.
      const specKind = resolveSpecKindOrDefault(doc.extra["spec_kind"]);
      return this.gate.enforcer.enforce("spec-promote", {
        acceptanceCriteriaCount,
        specIdOrSlug: doc.slug,
        ...(parsed.success ? { acceptanceCriteria: parsed.data } : {}),
        acQuantifiableEnabled: this.gate.enforcer.isAcQuantifiableEnabled("spec-promote"),
        verificationProfile: this.gate.enforcer.resolveVerificationProfile(specKind),
        oracleCoverageEnabled: this.gate.enforcer.isOracleCoverageEnabled(),
      });
    }

    if (doc.type === "plan") {
      // reason: check disable BEFORE the getPlanBundle IO below — mirrors gate.ts's
      // isGateDisabledByConfig-before-runPlanPromoteGate order. Without this early-out,
      // a disabled plan-promote gate could still be blocked by a broken ancestor-spec
      // lookup, violating "disabled === byte-identical to pre-GateEnforcer behavior"
      // (adversarial review, retro item 8 follow-up).
      if (!this.gate.enforcer.isEnabled("plan-promote")) {
        return ok(undefined);
      }

      const bundleResult = await this.gate.getPlanBundle(doc.id);
      if (!bundleResult.ok) return bundleResult;
      const parentSpec = bundleResult.value.spec;
      const ctx = buildUpstreamSpecContext(parentSpec);
      // reason: SPEC-058 D4 — requiresUatDeclared judges the plan against its
      // ANCESTOR spec's spec_kind profile, not the plan's own (plans carry no
      // spec_kind). `hasSpecParent === false` already short-circuits
      // checkPlanPromote before this field is ever consulted, so resolving
      // `null` when there's no parent spec is a safe, unread default.
      const verificationProfile =
        parentSpec !== undefined
          ? this.gate.enforcer.resolveVerificationProfile(resolveSpecKindOrDefault(parentSpec.extra["spec_kind"]))
          : null;
      const planRequiresUat = doc.extra["requires_uat"] === true;
      return this.gate.enforcer.enforce("plan-promote", {
        ...ctx,
        targetIdOrSlug: doc.slug,
        verificationProfile,
        planRequiresUat,
        requiresUatEnabled: this.gate.enforcer.isRequiresUatEnabled(),
      });
    }

    return ok(undefined);
  }

  /**
   * Return all documents with status='draft' matching optional filters.
   * Source: SPEC-005 §3, AC row 1.
   */
  async pending(filters?: PendingFilters): Promise<Result<PendingDoc[], LoreError>> {
    const storeFilters: import("../store/store-interface.js").StoreFilters = {
      status: "draft",
      ...(filters?.author !== undefined ? { created_by: filters.author } : {}),
      ...(filters?.type !== undefined ? { type: filters.type } : {}),
      ...(filters?.since !== undefined ? { since: filters.since } : {}),
    };

    const result = await this.store.findMany(storeFilters);
    if (!result.ok) return result;

    const pendingDocs: PendingDoc[] = result.value.map((doc) =>
      toPendingDoc(
        doc,
        this.claimTtlMinutes !== undefined ? { claimTtlMinutes: this.claimTtlMinutes } : undefined,
      ),
    );

    return ok(pendingDocs);
  }

  /**
   * Approve a document — transition status to 'approved'.
   * Creates a version snapshot and audit entry.
   * Source: SPEC-005 §3, §4, AC rows 2, 6.
   */
  async approve(
    id: string,
    opts?: ApproveOpts,
  ): Promise<Result<DocRecord, LoreError>> {
    const findResult = await this.resolveDoc(id);
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

    const gateResult = await this.enforceApprovalGate(doc);
    if (!gateResult.ok) return gateResult;

    const reviewer = opts?.reviewer ?? "system";
    const now = new Date().toISOString();
    const nextVersion = doc.version + 1;

    const updateResult = await this.store.update(doc.id, {
      status: "approved",
      version: nextVersion,
      updated_at: now,
    }, { expected_version: doc.version });
    if (!updateResult.ok) return updateResult;

    const updatedDoc = updateResult.value;

    const versionResult = await this.store.insertVersion({
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

    const auditResult = await this.store.appendAuditEntry({
      timestamp: now,
      actor: reviewer,
      session_id: `review-${doc.id}`,
      action: "approve",
      doc_id: doc.id,
      // reason: SPEC-035 §2 — join key for AuditService.verify's versions⋈audit walk.
      details: { reviewer, from_status: doc.status, to_status: "approved", version: nextVersion },
    });
    if (!auditResult.ok) return auditResult;

    return ok(updatedDoc);
  }

  /**
   * Reject a document — status stays 'draft', reason recorded in audit.
   * Source: SPEC-005 §3, §4, AC rows 4, table row "draft|reject|draft".
   * Only docs in 'draft' or 'in-review' can be rejected.
   */
  async reject(
    id: string,
    opts?: RejectOpts,
  ): Promise<Result<DocRecord, LoreError>> {
    const findResult = await this.resolveDoc(id);
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
    const updateResult = await this.store.update(doc.id, {
      status: "draft",
      updated_at: now,
    }, { expected_version: doc.version });
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
    // reason: SPEC-035 §2 — additive for writer-coverage consistency. reject() never
    // calls insertVersion (status stays 'draft', no version bump) so no versions row
    // with action "reject" exists for AuditService.verify to require this against —
    // this is purely for parity/future-proofing, not oracle-load-bearing.
    auditDetails["version"] = doc.version;

    const auditResult = await this.store.appendAuditEntry({
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

/**
 * Coerces a raw `extra.spec_kind` value to a valid {@link SpecKind}, falling
 * back to `"feature"` (SPEC-058 D2) — the SAME default `CorpusService.
 * _createImpl` applies at spec-creation time when the field is absent, never a
 * second, independently-invented default. A malformed value (wrong type, or a
 * string outside {@link SPEC_KINDS}) is treated identically to absent — this
 * helper never throws or returns an error; it's a read-side coercion for gate
 * ctx-building only, not a validator (write-time validation already happened
 * in `CorpusService._createImpl`/`set`).
 */
function resolveSpecKindOrDefault(raw: unknown): SpecKind {
  return typeof raw === "string" && (SPEC_KINDS as readonly string[]).includes(raw)
    ? (raw as SpecKind)
    : "feature";
}

/**
 * Projects a full DocRecord to the {@link PendingDoc} row shape, wrapping
 * `deriveTypeMeta` (`@lore/core`) for the `meta` field — mirrors
 * `CorpusService.toSummary`'s DocSummary projection (SPEC-036 §2 D3).
 *
 * @param opts - `{ claimTtlMinutes? }` forwarded verbatim to `deriveTypeMeta`;
 *   `undefined` when this service wasn't constructed with a TTL, in which case
 *   `deriveTypeMeta` omits `task.claim_stale` rather than fabricating a value.
 */
function toPendingDoc(doc: DocRecord, opts?: { claimTtlMinutes?: number }): PendingDoc {
  const meta = deriveTypeMeta(doc, opts);
  return {
    id: doc.id,
    type: doc.type,
    title: doc.title,
    status: "draft",
    created_by: doc.created_by,
    updated_at: doc.updated_at,
    version: doc.version,
    ...(meta !== undefined ? { meta } : {}),
  };
}
