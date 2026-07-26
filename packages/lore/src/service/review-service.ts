/**
 * ReviewService — human-in-the-loop review workflow for documents.
 * Manages pending review queue, approval, and rejection of draft documents.
 * Source: SPEC-005 §3, SPEC-001 §3.2
 */

import type { DocId, DocRecord, DocType, DocTypeMeta, Slug, SpecKind, Validity } from "@lore/core";
import { err, ok, type LoreError, type Result } from "@lore/core";
import {
  getAllowedTransitions,
  isValidTransition,
  deriveTypeMeta,
  extractValidity,
  isInvalidated,
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
 * @invariant `slug` (SPEC-065 D3) is ALWAYS present, never optional — unlike
 *   `meta`, a doc's slug is never absent/malformed by construction. Added so
 *   `lore pending`'s table can print a resolvable identifier alongside the
 *   truncated 10-char id column (SPEC-065's whole premise: an id a surface
 *   PRINTS must be a valid INPUT to `resolveDoc`'s prefix resolution — the
 *   slug always was, but wasn't SHOWN here before this field existed).
 * @invariant `validity` (SPEC-043 D3 pending-queue extension, task
 *   `task-lore-pending-does-not-filter-invalidated-docs-an`) is the doc's
 *   extracted `extra.validity`, hoisted to a top-level field the SAME way
 *   `SearchHit.validity` is (never a full `extra` blob) — present iff the doc
 *   carries validity metadata at all (regardless of whether it's currently
 *   invalidated), absent for every doc type `ValidityService` never writes to.
 *   It exists so the CLI can render the `[invalid]` badge (`formatValidityBadge`,
 *   the SAME renderer `lore list --include-invalid` uses) without a second
 *   per-doc fetch — `pending()` already holds the full `DocRecord` this is
 *   extracted from.
 */
export interface PendingDoc {
  id: DocId;
  slug: Slug;
  type: DocType;
  title: string;
  status: "draft";
  created_by: string;
  updated_at: string;
  version: number;
  change_summary?: string;
  meta?: DocTypeMeta;
  validity?: Validity;
}

export interface PendingFilters {
  /** Filter by document creator (created_by) */
  author?: string;
  /** Filter by document type */
  type?: DocType;
  /** ISO 8601 — only docs updated at or after this time */
  since?: string;
  /**
   * SPEC-043 D3 — include invalidated docs in the result (excluded by default).
   * Mirrors `ListFilters.include_invalid` (`corpus-service.ts`) — `lore pending`
   * is a review-QUEUE list-surface, the same read-surface class `list`/`search`
   * already apply this filter to. Default `false`/absent: an invalidated draft
   * (e.g. a duplicate superseded by its canonical version) is excluded from the
   * queue rather than sitting there forever — `draft` has no `->archived`
   * lifecycle exit, so filtering is the only way this queue self-cleans.
   */
  include_invalid?: boolean;
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
        // reason: task-spec-promote-base-1-ac-rule-is-spec-kind-agnostic-spec-080
        // AC4 — feedSpecPromote's denial message names the RESOLVED kind, never a
        // hardcoded default; this is the SAME specKind already computed above for
        // verificationProfile, never a second lookup.
        specKind,
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
   *
   * @param filters - author/type/since filters plus SPEC-043 D3's `include_invalid`
   *   escape (default false — see {@link PendingFilters.include_invalid}).
   * @param now - Time seam (D3) — drives the default invalidated-doc exclusion;
   *   defaults to `() => new Date().toISOString()`. Mirrors `CorpusService.list`'s
   *   identical `now` seam so both surfaces flip visibility at the SAME injected
   *   instant in tests, rather than each reading the wall clock independently.
   */
  async pending(
    filters?: PendingFilters,
    now: () => string = defaultNow,
  ): Promise<Result<PendingDoc[], LoreError>> {
    const storeFilters: import("../store/store-interface.js").StoreFilters = {
      status: "draft",
      ...(filters?.author !== undefined ? { created_by: filters.author } : {}),
      ...(filters?.type !== undefined ? { type: filters.type } : {}),
      ...(filters?.since !== undefined ? { since: filters.since } : {}),
    };

    const result = await this.store.findMany(storeFilters);
    if (!result.ok) return result;

    // SPEC-043 D3 — `pending` is a review-QUEUE list-surface, the same read-surface
    // class `CorpusService.list`/`search` already filter: an invalidated draft (e.g.
    // a duplicate superseded by its canonical version) has no lifecycle exit (no
    // draft->archived transition exists) and would otherwise sit in this queue
    // forever. Excluded by default; `include_invalid` restores it, badged by the
    // CLI (`formatValidityBadge`, `lore list --include-invalid`'s own renderer).
    // `isInvalidated` is a structural no-op for any doc type ValidityService never
    // writes `extra.validity` on — this filter naturally scopes itself.
    const nowIso = now();
    const visibleDocs =
      filters?.include_invalid === true
        ? result.value
        : result.value.filter((doc) => !isInvalidated(doc, nowIso));

    const pendingDocs: PendingDoc[] = visibleDocs.map((doc) =>
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
   *
   * @invariant For a `plan` doc, this is write-then-verify, not just gate-then-write
   *   (ASYNC2-002 TOCTOU hardening, BUG-011 precedent — see
   *   `task-workflow-service.ts`'s `claim()`/`rollbackClaim` for the sibling
   *   implementation this mirrors). `enforceApprovalGate`'s `plan-promote` branch
   *   reads the plan's ANCESTOR spec — a DIFFERENT row than the one this method's own
   *   CAS write protects — so a concurrent edit to that spec (e.g. an AC removal, or
   *   the spec being un-approved) landing in the gap between the pre-write gate check
   *   and the CAS commit is invisible to `expected_version: doc.version` (that guard
   *   only serializes writes to the PLAN row). After the CAS write commits, `approve`
   *   re-runs the IDENTICAL gate check against a FRESH ancestor-spec read; a failure
   *   now self-rolls-back the just-committed approval (`rollbackApproval`, itself
   *   CAS-guarded) and returns the SAME gate error a pre-write rejection would have —
   *   never leaves the plan "approved" against an invalidated prerequisite. A `spec`
   *   doc's own `spec-promote` gate does NOT need this: every field
   *   `enforceApprovalGate`'s spec branch reads (`extra.acceptance_criteria`,
   *   `extra.spec_kind`) lives on the SAME row this method's CAS write already
   *   protects — a genuine concurrent edit there already fails the CAS itself as
   *   `STALE_VERSION` (the `expected_version` won't match), so re-checking would be
   *   redundant, not a real gap. The residual window AFTER this post-write re-check
   *   returns clean (a third concurrent edit landing in the instant between this read
   *   and the caller observing success) is an ACCEPTED residual — closing it fully
   *   would need a corpus-level lock/daemon, out of scope (same accepted-residual
   *   shape `task-workflow-service.ts`'s `claim()` documents).
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
      // SPEC-072 D2/D1 — same "state as of this version" convention as
      // content/extra/status/title above; `approve` never changes slug, so
      // this is simply the doc's current (unchanged) slug.
      slug: updatedDoc.slug,
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

    // reason: ASYNC2-002 — plan-only post-write re-check, see the JSDoc @invariant
    // above. Only runs when a gate dependency is wired AND the just-approved doc is a
    // plan (enforceApprovalGate is a no-op for every other combination, but the
    // explicit `doc.type === "plan"` guard here keeps a spec approval's cost/behavior
    // byte-identical — zero extra store round trip, not merely a zero-op call).
    if (this.gate !== undefined && doc.type === "plan") {
      const postGateResult = await this.enforceApprovalGate(updatedDoc);
      if (!postGateResult.ok) {
        const rollbackResult = await this.rollbackApproval(updatedDoc, doc.status, reviewer);
        if (!rollbackResult.ok) {
          return err({
            code: "VALIDATION_ERROR",
            field: "gate:plan-promote",
            message:
              `Plan "${updatedDoc.slug}" was approved but its ancestor spec's approval ` +
              `prerequisites failed a post-write re-check, AND automatic self-rollback ` +
              `failed (${rollbackResult.error.code}) — it was left APPROVED despite the ` +
              `invalidated prerequisite. Manually inspect/re-set its status.`,
            value: { conflict: postGateResult.error, rollback_error: rollbackResult.error },
          });
        }
        return postGateResult;
      }
    }

    return ok(updatedDoc);
  }

  /**
   * ASYNC2-002 self-rollback — reverts a just-committed plan approval back to
   * `fromStatus` (the plan's status immediately before this `approve()` call), CAS-
   * guarded against the approval write's OWN version (`approved.version`): a THIRD
   * concurrent write landing in this narrow window fails loud (`STALE_VERSION`,
   * surfaced to the caller by `approve` above) rather than silently clobbering it.
   * Mirrors `TaskWorkflowService.rollbackClaim` (BUG-011). Writes a `"reject"`-family
   * version + audit entry — there is no dedicated "un-approve" `VersionAction`, and
   * `reject` is the closest existing semantic (status reverts to its pre-approval
   * value) that keeps `AuditService.verify`'s versions⋈audit walk satisfied.
   *
   * @param approved - The DocRecord as returned by this `approve()` call's own CAS
   *   write (i.e. already status "approved" at `approved.version`).
   * @param fromStatus - The plan's status before this `approve()` call ran.
   * @param reviewer - Same actor identity `approve()` resolved (`opts?.reviewer ??
   *   "system"`) — the rollback is an automatic consequence of that reviewer's own
   *   approve call, not a distinct actor.
   */
  private async rollbackApproval(
    approved: DocRecord,
    fromStatus: DocRecord["status"],
    reviewer: string,
  ): Promise<Result<DocRecord, LoreError>> {
    const now = new Date().toISOString();
    const rollbackVersion = approved.version + 1;

    const updateResult = await this.store.update(approved.id, {
      status: fromStatus,
      version: rollbackVersion,
      updated_at: now,
    }, { expected_version: approved.version });
    if (!updateResult.ok) return updateResult;

    const updatedDoc = updateResult.value;

    const versionResult = await this.store.insertVersion({
      doc_id: approved.id,
      version: rollbackVersion,
      content: updatedDoc.content,
      extra: updatedDoc.extra,
      status: fromStatus,
      title: updatedDoc.title,
      action: "reject",
      created_at: now,
      created_by: reviewer,
      // SPEC-072 D1/D2 — rollback never changes slug; carry the current value.
      slug: updatedDoc.slug,
      change_summary:
        "Self-rollback: ancestor spec's approval prerequisites failed a post-write " +
        "re-check (ASYNC2-002 TOCTOU guard)",
    });
    if (!versionResult.ok) return versionResult;

    const auditResult = await this.store.appendAuditEntry({
      timestamp: now,
      actor: reviewer,
      session_id: `review-${approved.id}`,
      action: "reject",
      doc_id: approved.id,
      details: {
        reviewer,
        from_status: "approved",
        to_status: fromStatus,
        version: rollbackVersion,
        rollback: true,
      },
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
 * Default time seam for `pending()`'s SPEC-043 D3 invalidated-doc filter —
 * mirrors `corpus-service.ts`'s identical `defaultNow` (independent copies,
 * both trivial one-liners; not worth a cross-service import for this).
 */
const defaultNow = (): string => new Date().toISOString();

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
  const validity = extractValidity(doc);
  return {
    id: doc.id,
    slug: doc.slug,
    type: doc.type,
    title: doc.title,
    status: "draft",
    created_by: doc.created_by,
    updated_at: doc.updated_at,
    version: doc.version,
    ...(meta !== undefined ? { meta } : {}),
    ...(validity !== undefined ? { validity } : {}),
  };
}
