/**
 * ValidityService — the SOLE write path for `knowledge`/`adr` bi-temporal validity
 * metadata (`extra.validity`, SPEC-043 §Design Decisions D2). Stateless, store-injected,
 * read-modify-write via the `TaskWorkflowService.writeTaskExtra` pattern (CAS-guarded
 * `store.update`, one `insertVersion`, one `appendAuditEntry`).
 *
 * Public surface:
 *   invalidate(idOrSlug, opts, now?) → mark a doc invalid (or clear it via opts.undo)
 *
 * @invariant `CorpusService.set` closes the OTHER side door onto `extra.validity`
 *   (D10) — this service is the only path that may CHANGE it; `set` rejects any patch
 *   whose `extra.validity` differs from the doc's current value.
 * @invariant Ordering (D2, non-atomicity stated honestly — no store transactions exist
 *   anywhere in this codebase): (1) doc-extra update + version + audit FIRST — the
 *   higher-value invariant; (2) the `supersedes` link (successor → old) SECOND. A
 *   failure between (1) and (2) leaves validity set with a missing link; re-running the
 *   SAME `invalidate` call is idempotent and repairs the link (checks for an existing
 *   `supersedes` link before writing one).
 * @invariant "First signal wins" (AC-MH-10) — re-invalidating an already-invalidated
 *   doc keeps the ORIGINAL `invalid_at` while refreshing `reason`/`invalidated_by` from
 *   the new call's `opts` (when supplied this call; otherwise the prior value is
 *   preserved).
 * @invariant `--undo` clears `invalid_at`/`invalidated_by`/`reason` (keeping `valid_at`
 *   untouched) but NEVER reverts `extra.decision_status` on an `adr` doc — the
 *   asymmetry is surfaced structurally via `InvalidateResult.decision_status_unchanged`
 *   (D2, review U7 — MCP agents never read help text).
 * @invariant `supersededBy` is resolved via `resolveDoc` and the RESOLVED ULID is what
 *   gets persisted to `invalidated_by`/`superseded_by` — never the raw id-or-slug input
 *   (review S7).
 * @invariant Doc `status` (the workflow lifecycle field) is NEVER touched by this
 *   service (D5 — temporal validity ⊥ workflow status).
 *
 * Side-effect class: IO (reads/writes via StoreInterface; emits telemetry).
 * Source: SPEC-043 §Design Decisions D1, D2, D5; §Acceptance Criteria AC-MH-2, AC-MH-3,
 *         AC-MH-4, AC-MH-10
 */

import {
  err,
  ok,
  extractValidity,
  validitySchema,
  type DocRecord,
  type LoreError,
  type Result,
  type Telemetry,
  type TelemetryEvent,
} from "@lore/core";
import { NoOpTelemetry } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { resolveDoc, resolveDocId } from "./resolve.js";

const defaultNow = (): string => new Date().toISOString();

/** Doc types this service is legal to operate on (D1 — validity is scoped to these two). */
const VALIDITY_ELIGIBLE_TYPES: ReadonlySet<DocRecord["type"]> = new Set(["knowledge", "adr"]);

/** Options for {@link ValidityService.invalidate}. */
export interface InvalidateOpts {
  /** Resolved actor identity. */
  by: string;
  /** ID or slug of the successor doc, when this invalidation is a supersede. Resolved
   *  to a ULID before persisting (review S7) — never the raw input. */
  supersededBy?: string;
  reason?: string;
  /** Clear the invalidation instead of setting one — see class @invariant. */
  undo?: boolean;
  /**
   * Override the `invalid_at` instant written on a FIRST invalidation (rare — testing /
   * explicit backdating). Defaults to `now()`. Rejected when it resolves to a moment
   * after `now()` (D1's "not in the future" service-seam rule).
   */
  invalidAt?: string;
  /** Caller-surface discriminator, forwarded to telemetry (mirrors ClaimOpts.source). */
  source?: string;
}

/**
 * Result of {@link ValidityService.invalidate}.
 */
export interface InvalidateResult {
  doc: DocRecord;
  /**
   * Present (`"superseded"`) iff this was an `undo` on an `adr` doc whose
   * `decision_status` was `"superseded"` — surfaces the D2 asymmetry structurally
   * (CLI `--json` / MCP payload) instead of leaving it discoverable only via help text.
   */
  decision_status_unchanged?: "superseded";
}

export class ValidityService {
  private readonly telemetry: Telemetry;

  constructor(
    private readonly store: StoreInterface,
    telemetry: Telemetry = new NoOpTelemetry(),
  ) {
    this.telemetry = telemetry;
  }

  /**
   * Marks `idOrSlug` invalid (or undoes a prior invalidation, `opts.undo: true`).
   *
   * @param idOrSlug - Target `knowledge`/`adr` document ULID or slug
   * @param opts - `{ by, supersededBy?, reason?, undo?, invalidAt?, source? }`
   * @param now - Time seam (D1/D10 convention); defaults to `() => new Date().toISOString()`
   * @returns `{doc, decision_status_unchanged?}` — the updated document
   * @throws DOC_NOT_FOUND (target or supersededBy don't resolve), VALIDATION_ERROR
   *   (non-knowledge/adr target; future invalid_at; malformed validity; undo on a
   *   never-invalidated doc), STALE_VERSION
   */
  async invalidate(
    idOrSlug: string,
    opts: InvalidateOpts,
    now: () => string = defaultNow,
  ): Promise<Result<InvalidateResult, LoreError>> {
    const startMs = Date.now();
    const result = await this._invalidateImpl(idOrSlug, opts, now);
    this.recordEvent(startMs, result, opts.source, { undo: opts.undo === true });
    return result;
  }

  private async _invalidateImpl(
    idOrSlug: string,
    opts: InvalidateOpts,
    now: () => string,
  ): Promise<Result<InvalidateResult, LoreError>> {
    const docResult = await resolveDoc(this.store, idOrSlug);
    if (!docResult.ok) return docResult;
    const doc = docResult.value;

    if (!VALIDITY_ELIGIBLE_TYPES.has(doc.type)) {
      return err({
        code: "VALIDATION_ERROR",
        field: "type",
        message: `Validity metadata only applies to knowledge/adr documents; got type "${doc.type}"`,
        value: doc.type,
      });
    }

    const existingValidity = extractValidity(doc);
    const nowIso = now();

    if (opts.undo === true) {
      return this.applyUndo(doc, existingValidity, nowIso, opts);
    }

    return this.applyInvalidate(doc, existingValidity, nowIso, opts);
  }

  // ── Undo ─────────────────────────────────────────────────────────────────

  private async applyUndo(
    doc: DocRecord,
    existingValidity: ReturnType<typeof extractValidity>,
    nowIso: string,
    opts: InvalidateOpts,
  ): Promise<Result<InvalidateResult, LoreError>> {
    if (existingValidity?.invalid_at === undefined) {
      return err({
        code: "VALIDATION_ERROR",
        field: "extra.validity",
        message: "Document is not currently invalidated — nothing to undo",
        value: doc.id,
      });
    }

    // reason: D2 — undo clears invalid_at/invalidated_by/reason but keeps valid_at
    // untouched (a doc's "valid since" instant is orthogonal to whether it's currently
    // invalidated).
    const newValidity = existingValidity.valid_at !== undefined ? { valid_at: existingValidity.valid_at } : {};
    const newExtra: Record<string, unknown> = { ...doc.extra };
    if (Object.keys(newValidity).length > 0) {
      newExtra["validity"] = newValidity;
    } else {
      delete newExtra["validity"];
    }

    // reason: D2 — decision_status is NEVER auto-reverted by undo; surface the
    // asymmetry structurally so MCP callers (who never read help text) can see it.
    let decisionStatusUnchanged: "superseded" | undefined;
    if (doc.type === "adr" && doc.extra["decision_status"] === "superseded") {
      decisionStatusUnchanged = "superseded";
    }

    const commitResult = await this.commitValidityExtra(
      doc,
      newExtra,
      nowIso,
      opts.by,
      `Invalidation undone by ${opts.by}`,
      { by: opts.by, undo: true },
    );
    if (!commitResult.ok) return commitResult;

    return ok({
      doc: commitResult.value,
      ...(decisionStatusUnchanged !== undefined ? { decision_status_unchanged: decisionStatusUnchanged } : {}),
    });
  }

  // ── Invalidate ───────────────────────────────────────────────────────────

  private async applyInvalidate(
    doc: DocRecord,
    existingValidity: ReturnType<typeof extractValidity>,
    nowIso: string,
    opts: InvalidateOpts,
  ): Promise<Result<InvalidateResult, LoreError>> {
    let resolvedSupersededById: string | undefined;
    if (opts.supersededBy !== undefined) {
      const resolvedResult = await resolveDocId(this.store, opts.supersededBy);
      if (!resolvedResult.ok) return resolvedResult;
      resolvedSupersededById = resolvedResult.value;
    }

    // "First signal wins" (AC-MH-10): a prior invalid_at is never overwritten.
    const effectiveInvalidAt = existingValidity?.invalid_at ?? (opts.invalidAt ?? nowIso);

    if (new Date(effectiveInvalidAt).getTime() > new Date(nowIso).getTime()) {
      return err({
        code: "VALIDATION_ERROR",
        field: "invalid_at",
        message: "invalid_at cannot be in the future",
        value: effectiveInvalidAt,
      });
    }

    const effectiveInvalidatedBy = resolvedSupersededById ?? existingValidity?.invalidated_by;
    const effectiveReason = opts.reason ?? existingValidity?.reason;

    const candidateValidity: Record<string, unknown> = {};
    if (existingValidity?.valid_at !== undefined) candidateValidity["valid_at"] = existingValidity.valid_at;
    candidateValidity["invalid_at"] = effectiveInvalidAt;
    if (effectiveInvalidatedBy !== undefined) candidateValidity["invalidated_by"] = effectiveInvalidatedBy;
    if (effectiveReason !== undefined) candidateValidity["reason"] = effectiveReason;

    const parsedValidity = validitySchema.safeParse(candidateValidity);
    if (!parsedValidity.success) {
      const issue = parsedValidity.error.issues[0];
      return err({
        code: "VALIDATION_ERROR",
        field: issue !== undefined ? `validity.${issue.path.join(".")}` : "validity",
        message: issue !== undefined ? issue.message : "Invalid validity payload",
        value: candidateValidity,
      });
    }

    const newExtra: Record<string, unknown> = { ...doc.extra, validity: parsedValidity.data };

    // ADR convergence (AC-MH-3, D2): decision_status/superseded_by track the SAME
    // supersede/deprecate distinction as this CALL's own opts.supersededBy — never the
    // merged/effective value, so a re-invalidate that omits supersededBy this time
    // deliberately falls back to "deprecated" (matching the AC's literal wording).
    if (doc.type === "adr") {
      delete newExtra["superseded_by"];
      if (opts.supersededBy !== undefined) {
        newExtra["decision_status"] = "superseded";
        newExtra["superseded_by"] = resolvedSupersededById;
      } else {
        newExtra["decision_status"] = "deprecated";
      }
    }

    const commitResult = await this.commitValidityExtra(
      doc,
      newExtra,
      nowIso,
      opts.by,
      `Invalidated by ${opts.by}${effectiveReason !== undefined ? `: ${effectiveReason}` : ""}`,
      {
        by: opts.by,
        ...(resolvedSupersededById !== undefined ? { superseded_by: resolvedSupersededById } : {}),
        ...(effectiveReason !== undefined ? { reason: effectiveReason } : {}),
      },
    );
    if (!commitResult.ok) return commitResult;
    const updatedDoc = commitResult.value;

    // Link write SECOND (D2 pinned ordering) — only when this call names a successor.
    if (opts.supersededBy !== undefined && resolvedSupersededById !== undefined) {
      const linkResult = await this.ensureSupersedesLink(resolvedSupersededById, doc.id, nowIso, opts.by);
      if (!linkResult.ok) return linkResult;
    }

    return ok({ doc: updatedDoc });
  }

  /**
   * Idempotent link-add: checks the successor's existing outbound links for a
   * `supersedes` edge already targeting `oldDocId` before writing one — repairs a
   * missing link on re-run without duplicating an already-present one (D2). A genuine
   * write failure (e.g. a forced/simulated store error) is PROPAGATED to the caller
   * (never swallowed) — the doc half is already committed by the time this runs, so
   * the caller can safely re-invoke `invalidate` with the same args to repair it.
   */
  private async ensureSupersedesLink(
    successorId: string,
    oldDocId: string,
    nowIso: string,
    by: string,
  ): Promise<Result<void, LoreError>> {
    const existingLinksResult = await this.store.findLinks(successorId, "out");
    if (existingLinksResult.ok) {
      const alreadyLinked = existingLinksResult.value.some(
        (l) => l.link_type === "supersedes" && l.to_id === oldDocId,
      );
      if (alreadyLinked) return ok(undefined);
    }

    const linkResult = await this.store.addLink({
      from_id: successorId,
      to_id: oldDocId,
      link_type: "supersedes",
      created_at: nowIso,
      created_by: by,
    });
    if (!linkResult.ok && linkResult.error.code !== "DUPLICATE_LINK") {
      return linkResult;
    }
    return ok(undefined);
  }

  /**
   * Shared commit path (D2 step 1: doc-extra update + version + audit) — CAS-guarded
   * `store.update` on `extra` only, one `insertVersion` snapshot, one `appendAuditEntry`
   * with `action: "invalidate"` (`details.version` per SPEC-035 audit-continuity
   * convention). Mirrors `TaskWorkflowService.writeTaskExtra`.
   */
  private async commitValidityExtra(
    doc: DocRecord,
    newExtra: Record<string, unknown>,
    nowIso: string,
    actor: string,
    changeSummary: string,
    auditDetails: Record<string, unknown>,
  ): Promise<Result<DocRecord, LoreError>> {
    const newVersion = doc.version + 1;
    const updateResult = await this.store.update(
      doc.id,
      { extra: newExtra, updated_at: nowIso, version: newVersion },
      { expected_version: doc.version },
    );
    if (!updateResult.ok) return updateResult;

    const versionResult = await this.store.insertVersion({
      doc_id: doc.id,
      version: newVersion,
      content: updateResult.value.content,
      extra: updateResult.value.extra,
      status: updateResult.value.status,
      title: updateResult.value.title,
      action: "update",
      created_at: nowIso,
      created_by: actor,
      change_summary: changeSummary,
    });
    if (!versionResult.ok) return versionResult;

    const auditResult = await this.store.appendAuditEntry({
      timestamp: nowIso,
      actor,
      session_id: `invalidate-${doc.id}`,
      action: "invalidate",
      doc_id: doc.id,
      details: { ...auditDetails, version: newVersion },
    });
    if (!auditResult.ok) return auditResult;

    return ok(updateResult.value);
  }

  /** Records exactly one telemetry event per successful write. Never throws. */
  private recordEvent(
    startMs: number,
    result: Result<InvalidateResult, LoreError>,
    source: string | undefined,
    meta: Record<string, unknown>,
  ): void {
    if (!result.ok) return;
    const event: TelemetryEvent = {
      ts: new Date().toISOString(),
      service: "ValidityService",
      method: "invalidate",
      ok: true,
      duration_ms: Date.now() - startMs,
      meta: source !== undefined ? { ...meta, source } : meta,
    };
    this.telemetry.record(event);
  }
}
