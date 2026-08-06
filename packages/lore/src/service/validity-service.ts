/**
 * ValidityService — the SOLE write path for `knowledge`/`adr`/`task` bi-temporal
 * validity metadata (`extra.validity`, SPEC-043 §Design Decisions D2). Stateless,
 * store-injected, read-modify-write via the `TaskWorkflowService.writeTaskExtra`
 * pattern (CAS-guarded `store.update`, one `insertVersion`, one `appendAuditEntry`).
 *
 * Public surface:
 *   invalidate(idOrSlug, opts, now?) → mark a doc invalid (or clear it via opts.undo)
 *   projectValidityStatus / selectLiveDocs / withValidityStatus /
 *   withPreGatedLiveStatus → the READ-surface counterparts (D3's data half): pure,
 *   store-free helpers a read surface applies so validity is carried as DATA on every
 *   emitted record instead of being re-derived (or forgotten) per command.
 *
 * @invariant `VALIDITY_ELIGIBLE_TYPES` amended (task-a-task-cannot-be-retracted-
 *   supersedes-emits-a-repair, Defect 2) to ALSO accept `task` — a task had no
 *   retraction path visible to `list`/`ready`/`search` at all before this: its
 *   `VALID_TRANSITIONS` only reaches `deprecated` from `approved`/`active`, so a
 *   task caught wrong while still `draft` (the normal case) could never be
 *   deprecated, and editing its body to say "RETRACTED" is invisible to every
 *   read surface. Extending validity metadata was chosen over adding a
 *   `draft -> deprecated` lifecycle edge specifically because `isInvalidated`/
 *   `renderValidityBanner`/list()'s and search()'s D3 default-exclusion are ALL
 *   already type-agnostic pure functions (`@lore/core/validity.ts` never branches
 *   on `doc.type`) — reusing them costs zero new read-side code, where a
 *   status-based mechanism would need a brand-new default-exclusion filter (list/
 *   search currently apply NO default status filter at all) and a parallel banner
 *   implementation. Deliberately NOT reachable via the `--supersedes` CREATE-time
 *   compose flag, which stays scoped to knowledge/adr by its OWN, narrower,
 *   independently-declared constant (`SUPERSEDE_CREATE_ELIGIBLE_TYPES`,
 *   `adapters/cli/commands/create.ts`) — see that constant's doc comment for why
 *   the two sets are intentionally different, not an accidental SSOT fork.
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
 * @invariant Calibration write THIRD, optional (SPEC-044 §Design Decisions D12) — when
 *   the OPTIONAL `stalenessCalibration` port is wired (app.ts, T2) and this doc's latest
 *   `kind="staleness"` judgment is a `stale_candidate` escalate, `invalidate` writes ONE
 *   calibration record confirming the probe (`maybeRecordStalenessCalibration`). Bare
 *   `new ValidityService(store)` (no port) writes NONE and never errors — same
 *   optional-DI shape as `GateEnforcer`/`resolveDeclaredAcIds` elsewhere in this codebase.
 * @invariant The read-surface helpers below are PURE and store-free (side-effect class:
 *   pure), unlike the class. They live here — beside the sole WRITE path for
 *   `extra.validity` — because the defect they fix
 *   (task-an-invalidated-doc-is-indistinguishable-from-a-live-one-in) was exactly that
 *   validity had a write path and a single human RENDER site but no shared DATA
 *   projection, so every list-shaped read surface either forgot the D3 exclusion or
 *   emitted records with no validity-bearing field at all. Keeping the projection in
 *   the same module as the writer makes "what a read surface must carry" impossible to
 *   miss when the write shape changes.
 *
 * Side-effect class: IO for the class (reads/writes via StoreInterface; emits
 * telemetry); PURE for the four read-surface helpers.
 * Source: SPEC-043 §Design Decisions D1, D2, D5; §Acceptance Criteria AC-MH-2, AC-MH-3,
 *         AC-MH-4, AC-MH-10; SPEC-044 §Design Decisions D12, §Acceptance Criteria AC-SP-9
 */

import {
  err,
  ok,
  extractValidity,
  extractClaim,
  isInvalidated,
  validitySchema,
  type DocRecord,
  type DocStatus,
  type LoreError,
  type Result,
  type ReviewJudgment,
  type Telemetry,
  type TelemetryEvent,
  type ValidityCarrier,
} from "@lore/core";
import { NoOpTelemetry } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { resolveDoc, resolveDocId } from "./resolve.js";

const defaultNow = (): string => new Date().toISOString();

/**
 * Doc types this service is legal to operate on. `knowledge`/`adr` (D1,
 * SPEC-043 original scope); `task` added by task-a-task-cannot-be-retracted-
 * supersedes-emits-a-repair (Defect 2, see this file's class-level
 * @invariant for the full rationale). Exported so a caller that genuinely
 * needs to reference "what `lore invalidate` accepts" — as opposed to a
 * DELIBERATELY narrower business rule like `--supersedes`'s create-time
 * eligibility — has one place to import it from instead of re-declaring the
 * literal set.
 */
export const VALIDITY_ELIGIBLE_TYPES: ReadonlySet<DocRecord["type"]> = new Set([
  "knowledge",
  "adr",
  "task",
]);

// ─── Read-surface projection (SPEC-043 D3's DATA half) ──────────────────────
//
// task-an-invalidated-doc-is-indistinguishable-from-a-live-one-in measured that a
// RETRACTED doc was byte-identical to a live one in `lore list` (human AND --json),
// and that `--include-invalid` was SILENTLY INERT there (604 rows both ways, identical
// slug sets, zero validity-bearing key on any record). Root cause: validity was a
// RENDERING concern (one human banner in `lore get`) instead of a DATA concern, so
// (a) a read surface that fetched full records could silently skip the D3 exclusion,
// and (b) a machine consumer had no field to filter on even when it wanted to.
// These four helpers are the shared answer: a read surface SELECTS live docs with one
// named predicate and CARRIES the verdict on every record it emits.

/**
 * The evaluated validity verdict a read surface attaches to every doc record it
 * emits — the machine-readable counterpart of `renderValidityBanner`'s human line.
 *
 * ⛔ An ABSENT `validity_status` on a payload and a PRESENT one with
 * `invalidated: false` are DIFFERENT facts: absent means "this surface never probed
 * validity" (the pre-fix state of every list payload), present means "probed, and the
 * answer was live". The field's PRESENCE is the probe signal. Never collapse the two —
 * a consumer that cannot tell them apart is back to guessing, which is the whole defect.
 *
 * ⛔ There is deliberately NO `checked_at`/evaluation-instant field here, and adding
 * one is a REGRESSION, not an improvement. It was measured: a wall-clock instant echoed
 * onto every record made `lore list --json` differ between two consecutive runs over an
 * untouched corpus, breaking the read-idempotence contract pinned by
 * `tests/integration/cli/list-plan-membership.test.ts` ("two consecutive runs … are
 * byte-identical"). That determinism is load-bearing for every diff-, cache- and
 * oracle-shaped consumer. The instant stays an INJECTED PARAMETER of the projection
 * (never a second clock read) and the stored `invalid_at` travels on the record, so a
 * consumer that needs to re-evaluate at a different "now" already has everything it
 * needs — without paying nondeterminism on every read.
 */
export interface ValidityStatus {
  /** The SSOT `isInvalidated(doc, nowIso)` verdict — never a re-derivation. */
  invalidated: boolean;
  /** Present iff `invalidated` — the stored `extra.validity.invalid_at`. */
  invalid_at?: string;
  /**
   * Present iff `invalidated` AND a successor was recorded — the ULID stored in
   * `extra.validity.invalidated_by`. Named `superseded_by` on this projection (not
   * `invalidated_by`) because that is the question a consumer asks of a dead doc:
   * "what do I read instead?". Resolve it with `lore get <ulid>`.
   */
  superseded_by?: string;
  /** Present iff `invalidated` AND a reason was recorded. */
  reason?: string;
  /**
   * Present (`true`) iff `extra.validity` EXISTS but does not parse against
   * `validitySchema`. The `invalidated` verdict above then rests on unreadable
   * metadata, not on absent metadata — `extractValidity`'s documented
   * degrade-to-undefined contract makes those two indistinguishable otherwise, and
   * a corrupted row silently reading as "live" is the same silence class this whole
   * projection exists to remove. Advisory only: it never changes the verdict (that
   * would fork the SSOT predicate), it names it.
   */
  metadata_unreadable?: true;
}

/** A record of type `T` carrying its evaluated {@link ValidityStatus}. */
export type WithValidityStatus<T> = T & { validity_status: ValidityStatus };

/**
 * Projects one doc's evaluated validity verdict. Pure — `nowIso` is always injected
 * (same convention as `isInvalidated`, whose verdict this wraps verbatim).
 *
 * @param carrier - A DocRecord-shaped (`extra.validity` nested) or SearchHit-shaped
 *   (`validity` hoisted) input — the same union {@link isInvalidated} accepts
 * @param nowIso - The instant to evaluate against. NOT echoed into the result — see
 *   {@link ValidityStatus}'s no-`checked_at` invariant for the measured reason.
 * @returns The verdict plus, when invalidated, the stored successor/reason
 * @example
 * projectValidityStatus({ extra: {} }, "2026-08-06T00:00:00.000Z");
 * // => { invalidated: false }
 * @example
 * projectValidityStatus(
 *   { extra: { validity: { invalid_at: "2026-08-01T00:00:00.000Z", invalidated_by: "01K…", reason: "retracted" } } },
 *   "2026-08-06T00:00:00.000Z",
 * );
 * // => { invalidated: true, invalid_at: "2026-08-01T…", superseded_by: "01K…", reason: "retracted" }
 */
export function projectValidityStatus(carrier: ValidityCarrier, nowIso: string): ValidityStatus {
  const validity = carrier.validity !== undefined ? carrier.validity : extractValidity({ extra: carrier.extra ?? {} });
  // reason: distinguishes "no metadata" from "metadata present but unparseable" —
  // `extractValidity` returns undefined for BOTH (its documented defensive
  // contract), so the raw field has to be consulted directly to tell them apart.
  const rawValidity = carrier.extra?.["validity"];
  const metadataUnreadable = validity === undefined && rawValidity !== undefined && rawValidity !== null;

  const invalidated = isInvalidated(carrier, nowIso);
  return {
    invalidated,
    // reason: the three detail fields are emitted ONLY for an invalidated doc — a
    // live doc's record must not carry a half-populated retraction payload that a
    // consumer could mistake for a retraction (`invalid_at` alone is legal on a
    // FUTURE-dated invalidation, which `isInvalidated` correctly reads as live).
    ...(invalidated && validity?.invalid_at !== undefined ? { invalid_at: validity.invalid_at } : {}),
    ...(invalidated && validity?.invalidated_by !== undefined ? { superseded_by: validity.invalidated_by } : {}),
    ...(invalidated && validity?.reason !== undefined ? { reason: validity.reason } : {}),
    ...(metadataUnreadable ? { metadata_unreadable: true as const } : {}),
  };
}

/**
 * The D3 default exclusion as ONE named predicate application — returns only the docs
 * that are live at `nowIso`, preserving input order.
 *
 * ⛔ Apply this BEFORE paging, never after: `limit`/`offset` pushed into the store and
 * then filtered here yields a short page (the store bounded the row count before the
 * exclusion ran). `CorpusService.list`'s own JSDoc documents that residual for its
 * summary path; a full-record read surface has no reason to inherit it.
 *
 * @param docs - Records carrying validity (DocRecord- or SearchHit-shaped)
 * @param nowIso - The instant to evaluate against
 * @returns A new array (never mutated in place) of the live records
 * @example
 * selectLiveDocs([liveDoc, retractedDoc], nowIso); // => [liveDoc]
 */
export function selectLiveDocs<T extends ValidityCarrier>(docs: readonly T[], nowIso: string): T[] {
  return docs.filter((doc) => !isInvalidated(doc, nowIso));
}

/**
 * Attaches the COMPUTED {@link ValidityStatus} to each record — for records that
 * actually carry the metadata (`extra.validity` or a hoisted `validity`).
 *
 * ⛔ Never call this on a projection that CANNOT carry validity (e.g. `DocSummary`,
 * which has no `extra`): every such record would silently project as
 * `invalidated: false` on absent-metadata grounds, manufacturing exactly the false
 * "this is live" signal this projection exists to prevent. Use
 * {@link withPreGatedLiveStatus} for those, which says in its name that the caller —
 * not this function — established liveness.
 *
 * @param docs - Records carrying validity metadata
 * @param nowIso - The instant to evaluate every record against (one injected instant
 *   for the whole batch, so a single listing can never straddle two "now"s)
 * @returns New objects, spread-copied, each with `validity_status` added
 */
export function withValidityStatus<T extends ValidityCarrier>(
  docs: readonly T[],
  nowIso: string,
): WithValidityStatus<T>[] {
  return docs.map((doc) => ({ ...doc, validity_status: projectValidityStatus(doc, nowIso) }));
}

/**
 * Stamps `{ invalidated: false }` on records a validity-EXCLUDING query already gated —
 * the narrow case where the verdict is sound but the record shape cannot prove it.
 *
 * Sole legitimate caller: a surface reading `CorpusService.list(filters, () => nowIso)`
 * WITHOUT `include_invalid`, whose returned `DocSummary` rows have no `extra` to
 * re-derive from. That call applies `!isInvalidated(doc, nowIso)` to every row it
 * returns, so "live" is ENTAILED by the query contract, not guessed — but the
 * entailment lives at the CALL SITE, which is why this function is named for the
 * assumption instead of hiding it inside {@link withValidityStatus}.
 *
 * ⛔ Passing records from a query that did NOT exclude invalidated docs makes this
 * function lie. If you cannot name the excluding query, use
 * {@link withValidityStatus} on full records instead.
 *
 * ⛔ Takes no instant BY DESIGN: it has no verdict to compute (the caller's query
 * already did), and echoing one would only re-introduce the nondeterminism
 * {@link ValidityStatus} documents. The caller still pins the exclusion's instant by
 * injecting it into the query itself.
 *
 * @param docs - Records already filtered to "live" by the caller's excluding query
 * @returns New objects, spread-copied, each with a live `validity_status`
 */
export function withPreGatedLiveStatus<T>(docs: readonly T[]): WithValidityStatus<T>[] {
  return docs.map((doc) => ({ ...doc, validity_status: { invalidated: false } }));
}

/** `doc.status` values that were already terminal (workflow-closed) BEFORE an
 *  invalidate call — used only for the task-scoped `task_already_terminal`
 *  advisory below; not a validity concept itself (D5). */
const TERMINAL_TASK_STATUSES: ReadonlySet<DocStatus> = new Set(["archived", "deprecated"]);

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
  /**
   * BOUNDARY advisory (task-a-task-cannot-be-retracted-supersedes-emits-a-
   * repair AC6) — present iff `doc.type === "task"` and its `status` was
   * ALREADY `"archived"`/`"deprecated"` (terminal) at the moment THIS call
   * ran, carrying that prior status verbatim. Retraction still applies (D5 —
   * bi-temporal validity is orthogonal to workflow status) but the caller is
   * told, rather than silently succeeding as if the task were still open
   * work. Never populated for `undo` or for a non-task target.
   */
  task_already_terminal?: DocStatus;
  /**
   * BOUNDARY advisory (task-a-task-cannot-be-retracted-supersedes-emits-a-
   * repair AC6) — present iff `doc.type === "task"` and it carried a
   * recorded `extra.claim` held by a DIFFERENT actor than `opts.by` at the
   * moment THIS call ran (ANY claim, fresh or stale — a claim lease is a
   * workflow-domain fact this service does not otherwise consult, so
   * freshness is not re-derived here). Retraction still proceeds
   * unconditionally (naming the fact is the whole point — a blocking
   * refusal would strand an operator retracting a genuinely wrong task
   * whose holder is unreachable). Never populated for `undo` or for a
   * non-task target.
   */
  task_claim_holder?: string;
}

/**
 * Narrow, ValidityService-local port for wiring into `JudgmentService`'s calibration
 * capability (SPEC-044 §Design Decisions D12) WITHOUT importing `JudgmentService`
 * directly — services don't call each other (`packages/lore/src/service/CLAUDE.md`).
 * Structurally compatible with `judgmentService.latestFor.bind(judgmentService)`
 * (partially applied to `kind: "staleness"` by the app.ts wiring) and
 * `judgmentService.recordCalibration.bind(judgmentService)` — the production
 * composition root (T2) binds the real implementations; bare unit-test construction of
 * `ValidityService` simply omits this argument (OPTIONAL DI, mirrors `GateEnforcer`/
 * `resolveDeclaredAcIds`'s precedent).
 */
export interface StalenessCalibrationPort {
  /** The doc's LATEST `kind="staleness"` judgment, or `null`. Bind to
   *  `(docId) => judgmentService.latestFor(docId, "staleness")`. */
  latestStalenessJudgment(docId: string): Promise<Result<ReviewJudgment | null, LoreError>>;
  /** Bind directly to `judgmentService.recordCalibration.bind(judgmentService)`. */
  recordCalibration(input: {
    judgment: ReviewJudgment;
    docType: DocRecord["type"];
    currentDocVersion: number;
    humanOutcome: "confirmed" | "overridden";
    deltaReasons: string[];
    actor: string;
  }): Promise<Result<{ recorded: boolean }, LoreError>>;
}

export class ValidityService {
  private readonly telemetry: Telemetry;

  constructor(
    private readonly store: StoreInterface,
    telemetry: Telemetry = new NoOpTelemetry(),
    /**
     * OPTIONAL calibration port (SPEC-044 D12) — when absent (every bare
     * `new ValidityService(store)` unit-test construction), `invalidate` writes NO
     * calibration record and never errors; when wired (app.ts, T2), a stale_candidate
     * probe that a human then confirms via `invalidate` writes exactly ONE calibration
     * record FK'd to that judgment (AC-SP-9).
     */
    private readonly stalenessCalibration?: StalenessCalibrationPort,
  ) {
    this.telemetry = telemetry;
  }

  /**
   * Marks `idOrSlug` invalid (or undoes a prior invalidation, `opts.undo: true`).
   *
   * @param idOrSlug - Target `knowledge`/`adr`/`task` document ULID or slug
   *   (see {@link VALIDITY_ELIGIBLE_TYPES})
   * @param opts - `{ by, supersededBy?, reason?, undo?, invalidAt?, source? }`
   * @param now - Time seam (D1/D10 convention); defaults to `() => new Date().toISOString()`
   * @returns `{doc, decision_status_unchanged?, task_already_terminal?, task_claim_holder?}`
   *   — the updated document plus task-scoped BOUNDARY advisories (AC6)
   * @throws DOC_NOT_FOUND (target or supersededBy don't resolve), VALIDATION_ERROR
   *   (target type outside {@link VALIDITY_ELIGIBLE_TYPES}; future invalid_at;
   *   malformed validity; undo on a never-invalidated doc), STALE_VERSION
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
        message:
          `Validity metadata only applies to ${[...VALIDITY_ELIGIBLE_TYPES].join("/")} documents; ` +
          `got type "${doc.type}"`,
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

    // ADR convergence (AC-MH-3, D2, fixed post-review B4): decision_status/superseded_by
    // track the SAME merged `effectiveInvalidatedBy` value persisted to
    // `extra.validity.invalidated_by` above — NOT `opts.supersededBy !== undefined` for
    // just this call. Keying decision_status off the current call alone let a
    // reason-only re-invalidate (call 2, no supersededBy) flip decision_status to
    // "deprecated" while `invalidated_by` stayed "first signal wins"-preserved at the
    // prior call's successor — the persisted document then contradicted itself: the
    // validity banner (`lore get`/export-docs/feed, which renders off `invalidated_by`
    // alone) says "superseded by X" while `decision_status` says "deprecated". Deriving
    // both from the SAME `effectiveInvalidatedBy` keeps them in lockstep across any
    // number of calls; a reason-only invalidate on a doc with no prior supersededBy
    // still yields "deprecated" (effectiveInvalidatedBy is undefined in that case).
    if (doc.type === "adr") {
      delete newExtra["superseded_by"];
      if (effectiveInvalidatedBy !== undefined) {
        newExtra["decision_status"] = "superseded";
        newExtra["superseded_by"] = effectiveInvalidatedBy;
      } else {
        newExtra["decision_status"] = "deprecated";
      }
    }

    // BOUNDARY advisories (AC6, task-a-task-cannot-be-retracted-supersedes-
    // emits-a-repair) — computed from the ORIGINAL (pre-commit) `doc`, task-
    // scoped only, NAMED-not-silent per the task's requirement. Neither
    // blocks the write: an already-terminal task is still retractable (D5),
    // and a foreign claim holder is surfaced, not enforced against, so a
    // genuinely wrong task stays retractable even when its holder is
    // unreachable.
    const taskAlreadyTerminal: DocStatus | undefined =
      doc.type === "task" && TERMINAL_TASK_STATUSES.has(doc.status) ? doc.status : undefined;
    const existingClaim = doc.type === "task" ? extractClaim(doc) : undefined;
    const taskClaimHolder: string | undefined =
      existingClaim !== undefined && existingClaim.by !== opts.by ? existingClaim.by : undefined;

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

    // Calibration write THIRD (SPEC-044 D12) — only when the port is wired; uses the
    // ORIGINAL (pre-commit) `doc.version` as the version-pin, since that's the version
    // the staleness judgment (if any) was made against.
    const calibrationResult = await this.maybeRecordStalenessCalibration(doc, opts.by);
    if (!calibrationResult.ok) return calibrationResult;

    return ok({
      doc: updatedDoc,
      ...(taskAlreadyTerminal !== undefined ? { task_already_terminal: taskAlreadyTerminal } : {}),
      ...(taskClaimHolder !== undefined ? { task_claim_holder: taskClaimHolder } : {}),
    });
  }

  /**
   * D12 calibration join: when `stalenessCalibration` is wired AND the doc's latest
   * `kind="staleness"` judgment is a `stale_candidate` (`decision: "escalate"`) verdict,
   * writes ONE calibration record (`human_outcome: "confirmed"` — invalidating a doc a
   * probe flagged stale IS the human confirming the probe was right; there is no
   * observable outcome for a `holds` verdict, D12) FK'd to that judgment. No-ops
   * (returns `ok(undefined)`, never an error) when: the port is absent (bare
   * construction); no staleness judgment exists yet for this doc; or the latest
   * staleness judgment's decision is `"approve"` (holds).
   */
  private async maybeRecordStalenessCalibration(
    originalDoc: DocRecord,
    by: string,
  ): Promise<Result<void, LoreError>> {
    if (this.stalenessCalibration === undefined) return ok(undefined);

    const latestResult = await this.stalenessCalibration.latestStalenessJudgment(originalDoc.id);
    if (!latestResult.ok) return latestResult;
    const judgment = latestResult.value;
    if (judgment === null || judgment.decision !== "escalate") return ok(undefined);

    const outcomeResult = await this.stalenessCalibration.recordCalibration({
      judgment,
      docType: originalDoc.type,
      currentDocVersion: originalDoc.version,
      humanOutcome: "confirmed",
      deltaReasons: [],
      actor: by,
    });
    if (!outcomeResult.ok) return outcomeResult;

    return ok(undefined);
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
      // SPEC-072 D1/D2 — this write path only touches `extra`; carry the
      // current (unchanged) slug.
      slug: updateResult.value.slug,
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
