/**
 * PlanExemptionService — the SOLE writer of a plan's audited, required-reason
 * exemptions from the two OPT-OUT plan-close predicates:
 *
 *   - `attestationFloor` (SPEC-069 §Design Decisions D1) →
 *     `extra.attestation_exempt` + `extra.attestation_exempt_reason` +
 *     `extra.attestation_exempt_kind` (typed taxonomy, spec-verify-
 *     reachability-plan-promote-early-warning §Scope M3 / D3).
 *   - `assessmentFreshness` (SPEC-106 §Design Decisions D4) →
 *     `extra.assessment_freshness_exempt` +
 *     `extra.assessment_freshness_exempt_reason` (no kind taxonomy for this
 *     one — D4 mirrors the flag+reason shape only).
 *
 * Public surface:
 *   exemptAttestation(planIdOrSlug, {reason, kind, by})        → AttestationExemption
 *   exemptAssessmentFreshness(planIdOrSlug, {reason, by})      → PlanExemption
 *
 * Why this service exists at all — the defect it closes: both field families
 * were GATE-READ WITH NO WRITER. `CorpusService.set`'s plan-close block
 * consulted them; no CLI or MCP surface could author them. That is the exact
 * shape the project records as failing SILENT ("a gate demanding a field no
 * surface can author"), and it has already produced an incident: with the only
 * sanctioned opt-out unreachable, four plans were archived by riding a vacuous
 * predicate instead of declaring an auditable exemption. Recommended by name on
 * 2026-07-24, re-escalated, built here.
 *
 * @invariant READ-MERGE-WRITE, never wholesale replacement. `lore set` replaces
 *   `extra` in full, which is precisely why a dedicated writer is required —
 *   the same reasoning behind `lore anchor add` vs `lore set --anchor` and
 *   the retired outline exemption verb vs a `prd_sync_exempt` patch. Every `extra` key this
 *   service does not own is carried through byte-identical.
 * @invariant An exemption with a blank/missing reason is REFUSED
 *   (`VALIDATION_ERROR`), never persisted as a bare flag. The gate treats a
 *   reason-less `attestation_exempt: true` as NOT exempt, so persisting one
 *   would write a field that silently does nothing — a lie in the corpus.
 * @invariant An `attestation_exempt_kind` outside `attestationExemptKindSchema`
 *   is REFUSED. Validity is sourced from that schema via `.safeParse`, never a
 *   locally restated literal union (same rule `attestationExemptKindValid`
 *   follows in `gate-predicates.ts`).
 * @invariant The audit entry carries the RESOLVED ACTOR and the REASON. This
 *   deliberately diverges from the retired outline exemption writer, which recorded
 *   `actor: "system"` and omits the reason — an exemption whose audit trail
 *   cannot answer "who exempted this, and why" is not auditable, which is the
 *   whole point of preferring a written exemption over a synthesized artifact.
 *
 * Side-effect class: store IO only (doc update + version insert + audit append).
 * No wall-clock reads beyond the single `now` timestamp stamped per write.
 *
 * Source: SPEC-069 §Design Decisions D1 (AC-069-8, AC-069-9, AC-069-10);
 *         spec-verify-reachability-plan-promote-early-warning §Scope M3 (kind);
 *         SPEC-106 §Design Decisions D4 (assessment-freshness sibling)
 */

import { attestationExemptKindSchema, err, ok } from "@lore/core";
import type { AttestationExemptKind, DocRecord, LoreError, Result } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { bareDocWriter, type DocWritePort } from "./corpus-service.js";
import { resolveDoc } from "./resolve.js";

// ─── Field names (the ONE definition site for what this service owns) ────────

/** `extra` keys the attestation exemption owns. */
export const ATTESTATION_EXEMPT_FIELD = "attestation_exempt";
export const ATTESTATION_EXEMPT_REASON_FIELD = "attestation_exempt_reason";
export const ATTESTATION_EXEMPT_KIND_FIELD = "attestation_exempt_kind";

/** `extra` keys the assessment-freshness exemption owns. */
export const ASSESSMENT_FRESHNESS_EXEMPT_FIELD = "assessment_freshness_exempt";
export const ASSESSMENT_FRESHNESS_EXEMPT_REASON_FIELD = "assessment_freshness_exempt_reason";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Options common to every exemption verb. */
export interface PlanExemptOpts {
  /** Required justification — must be non-blank. */
  readonly reason: string;
  /** Actor identity recording the exemption (already resolved by the caller). */
  readonly by: string;
}

/** {@link PlanExemptionService.exemptAttestation} options. */
export interface AttestationExemptOpts extends PlanExemptOpts {
  /** Required typed taxonomy member — validated against `attestationExemptKindSchema`. */
  readonly kind: AttestationExemptKind;
}

/** A persisted flag+reason exemption. */
export interface PlanExemption {
  readonly exempt: true;
  readonly reason: string;
  readonly by: string;
  readonly at: string;
}

/** A persisted attestation exemption — {@link PlanExemption} plus its typed kind. */
export interface AttestationExemption extends PlanExemption {
  readonly kind: AttestationExemptKind;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class PlanExemptionService {
  constructor(
    private readonly store: StoreInterface,
    // reason: AC-DCL-5 — the ONE write route (`CorpusService`); `app.ts` passes the composed one, a bare test gets a
    // bare writer. This service never calls `store.update` / `insertVersion` / `appendAuditEntry` itself.
    writer?: DocWritePort,
  ) {
    this.writer = writer ?? bareDocWriter(store);
  }

  private readonly writer: DocWritePort;

  /**
   * Record an audited, typed, required-reason exemption from the plan-close
   * ATTESTATION FLOOR.
   *
   * @param planIdOrSlug - Plan document ULID or slug
   * @param opts - `{reason, kind, by}` — `reason` non-blank, `kind` a
   *   `attestationExemptKindSchema` member
   * @returns The persisted exemption `{exempt, reason, kind, by, at}`
   * @throws (as `Result`) DOC_NOT_FOUND, VALIDATION_ERROR (blank reason,
   *   off-taxonomy kind, non-plan target), STALE_VERSION
   */
  async exemptAttestation(
    planIdOrSlug: string,
    opts: AttestationExemptOpts,
  ): Promise<Result<AttestationExemption, LoreError>> {
    const reason = validateReason(opts.reason);
    if (!reason.ok) return reason;

    // reason: validity sourced from the schema, never a restated union — the
    // same rule `attestationExemptKindValid` (gate-predicates.ts) follows, so
    // the writer and the gate can never disagree about what a valid kind is.
    const parsedKind = attestationExemptKindSchema.safeParse(opts.kind);
    if (!parsedKind.success) {
      return err({
        code: "VALIDATION_ERROR",
        field: ATTESTATION_EXEMPT_KIND_FIELD,
        message:
          `attestation_exempt_kind must be one of: ` +
          `${attestationExemptKindSchema.options.join(", ")} (got '${String(opts.kind)}')`,
        value: opts.kind,
      });
    }

    const at = new Date().toISOString();
    const exemption: AttestationExemption = {
      exempt: true,
      reason: reason.value,
      kind: parsedKind.data,
      by: opts.by,
      at,
    };

    const written = await this.mergeExemptionIntoExtra(planIdOrSlug, {
      at,
      by: opts.by,
      fields: {
        [ATTESTATION_EXEMPT_FIELD]: true,
        [ATTESTATION_EXEMPT_REASON_FIELD]: reason.value,
        [ATTESTATION_EXEMPT_KIND_FIELD]: parsedKind.data,
      },
      operation: "exempt-attestation",
      changeSummary: `Plan-close attestation exemption recorded (${parsedKind.data}): ${reason.value}`,
      auditDetails: {
        reason: reason.value,
        [ATTESTATION_EXEMPT_KIND_FIELD]: parsedKind.data,
      },
    });
    if (!written.ok) return written;
    return ok(exemption);
  }

  /**
   * Record an audited, required-reason exemption from the plan-close
   * ASSESSMENT-FRESHNESS predicate (SPEC-106 D4). No `kind` taxonomy — that
   * predicate's exemption is flag+reason only.
   *
   * @param planIdOrSlug - Plan document ULID or slug
   * @param opts - `{reason, by}` — `reason` must be non-blank
   * @returns The persisted exemption `{exempt, reason, by, at}`
   * @throws (as `Result`) DOC_NOT_FOUND, VALIDATION_ERROR, STALE_VERSION
   */
  async exemptAssessmentFreshness(
    planIdOrSlug: string,
    opts: PlanExemptOpts,
  ): Promise<Result<PlanExemption, LoreError>> {
    const reason = validateReason(opts.reason);
    if (!reason.ok) return reason;

    const at = new Date().toISOString();
    const written = await this.mergeExemptionIntoExtra(planIdOrSlug, {
      at,
      by: opts.by,
      fields: {
        [ASSESSMENT_FRESHNESS_EXEMPT_FIELD]: true,
        [ASSESSMENT_FRESHNESS_EXEMPT_REASON_FIELD]: reason.value,
      },
      operation: "exempt-assessment-freshness",
      changeSummary: `Plan-close assessment-freshness exemption recorded: ${reason.value}`,
      auditDetails: { reason: reason.value },
    });
    if (!written.ok) return written;
    return ok({ exempt: true, reason: reason.value, by: opts.by, at });
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /**
   * The read-merge-write core shared by both verbs: resolve the plan, spread
   * the caller's owned fields over the CURRENT `extra`, persist with an
   * optimistic-concurrency guard, log the version, and append the audit entry.
   *
   * @param planIdOrSlug - Plan document ULID or slug
   * @param write - The owned fields plus the audit/version metadata for this write
   */
  private async mergeExemptionIntoExtra(
    planIdOrSlug: string,
    write: {
      readonly at: string;
      readonly by: string;
      readonly fields: Readonly<Record<string, unknown>>;
      readonly operation: string;
      readonly changeSummary: string;
      readonly auditDetails: Readonly<Record<string, unknown>>;
    },
  ): Promise<Result<DocRecord, LoreError>> {
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

    // THE invariant: spread the existing extra FIRST, so every key this service
    // does not own survives byte-identical. Never `{ ...write.fields }` alone.
    const newExtra: Record<string, unknown> = { ...plan.extra, ...write.fields };
    // reason: the RESOLVED actor (`write.by`), not "system" — AC-069-10. An exemption whose audit row cannot answer
    // "who, and why" defeats the purpose of preferring a written exemption over a synthesized artifact.
    const written = await this.writer.writeDoc({
      doc: plan,
      patch: { extra: newExtra },
      action: "update",
      changeSummary: write.changeSummary,
      auditAction: "update",
      auditDetails: { operation: write.operation, ...write.auditDetails },
      lock: "none",
      by: write.by,
      now: write.at,
    });
    if (!written.ok) return written;
    return ok(written.value.doc);
  }
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

/**
 * Fail-loud non-blank reason check. Returns the reason VERBATIM (untrimmed) on
 * success — the corpus records what the author wrote; only the blankness TEST
 * trims.
 */
function validateReason(raw: unknown): Result<string, LoreError> {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return err({
      code: "VALIDATION_ERROR",
      field: "reason",
      message: "reason is required and must not be blank",
      value: raw,
    });
  }
  return ok(raw);
}
