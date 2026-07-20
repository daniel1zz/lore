/**
 * PhaseWorkflowService — evidence, claim lease, and computed readiness for `phase` docs
 * (SPEC-056 §Design Decisions D1/D2/D7). The phase-doc generalization of
 * `TaskWorkflowService` (`./task-workflow-service.js`, UNCHANGED — still the live
 * claim/release/evidence/ready implementation for legacy `task` docs; this is a NEW,
 * parallel file, not a `git mv`), scoped per D2 to claim/release/evidence/ready ONLY —
 * checklist/track mechanics belong to a separate `PhaseChecklistService` (a sibling task
 * in this plan). Owns `phase.extra.claim` and `phase.extra.verification_evidence`
 * exclusively, writing directly through `StoreInterface` (never `CorpusService`) — the
 * same division of labor `TaskWorkflowService`'s own module header documents, and the
 * same reason: cross-service calls are forbidden, and this service never touches
 * content/title/status.
 *
 * Legacy READ tolerance (D2): `ready(planId)` renders a `ReadyRecord` for BOTH `phase`-
 * and legacy `task`-typed children of a plan (a corpus that hasn't run
 * `PhaseMigrationService` yet still gets a complete readiness picture) — but
 * `claim`/`release`/`addEvidence` REFUSE a legacy `task`-typed target with
 * `VALIDATION_ERROR`: write paths do NOT extend the read tolerance (the load-bearing
 * asymmetry D2 names). `PhaseMigrationService` (a later task) is the sole sanctioned
 * task-doc writer after this lands.
 *
 * Public surface:
 *   claim(idOrSlug, opts, now?)            → acquire/refresh/steal the advisory lease
 *                                             (phase docs only)
 *   release(idOrSlug, opts, now?)          → clear the advisory lease (phase docs only)
 *   addEvidence(idOrSlug, entry, now?)     → append one SELF-REPORTED oracle
 *                                             verification record (phase docs only)
 *   recordChecklistVerifiedEvidence(idOrSlug, entry, nowIso) → append a RUNNER-ATTESTED
 *                                             record carrying a REQUIRED checklist_ref
 *                                             (SPEC-056 §Design Decisions D8) — the
 *                                             phase-doc-typed sibling of
 *                                             TaskWorkflowService.recordVerifiedEvidence;
 *                                             NOT registered on any CLI/MCP surface
 *   ready(planIdOrSlug, now?)              → computed readiness report (zero writes) —
 *                                             renders BOTH phase and legacy task children
 *
 * @invariant All public methods return Promise<Result<T, LoreError>> — no thrown exceptions.
 * @invariant Every write carries the read version as a CAS guard (store.update's
 *   expected_version) — a concurrent writer wins the race, the loser gets STALE_VERSION.
 * @invariant Every successful write bumps the phase doc's version and appends one
 *   VersionRecord (action: "update") so `lore log` shows who claimed/released/added
 *   evidence and when.
 * @invariant claim/release/addEvidence touch ONLY extra.claim / extra.verification_evidence
 *   — never content, title, or status.
 * @invariant ready() performs zero writes — readiness is computed, never stored (D3,
 *   inherited from SPEC-025).
 * @invariant Method signatures reuse the EXACT SPEC-025/042 option/result types
 *   (`ClaimOpts`/`ReleaseOpts`/`EvidenceInput`/`ReadyReport`/`AnchorConflict`) imported
 *   FROM `./task-workflow-service.js` rather than redeclared here — D1/P1's "field
 *   shapes carry over VERBATIM" is proven structurally, not just by prose claim (see
 *   this module's own RED test's CONTRACT NOTE §1).
 * @invariant `ready()`'s per-record shape stays `ReadyRecord` from `@lore/core`
 *   (`task-workflow.ts`) UNCHANGED, including the field literally named `.task` — see
 *   the RED test's CONTRACT NOTE §2 for why renaming it to `.phase` is deliberately out
 *   of THIS task's scope (it would ripple into every `ReadyRecord` consumer: CLI
 *   `lore ready`, `lore tree` badges, MCP `lore_ready`).
 * @invariant The `task-claim` gate checkpoint is UNCHANGED (still gates
 *   `TaskWorkflowService.claim` on task docs) — this service instead runs the ADDITIVE
 *   `phase-claim` checkpoint (SPEC-056 D2/D7), registered in `checkpoint-registry.ts`
 *   reusing the SAME checkpoint-agnostic predicate functions `task-claim` uses.
 * @invariant `claim()` is write-then-verify, not just gate-then-write (BUG-011 TOCTOU
 *   hardening, mirrors `TaskWorkflowService.claim`'s identical fix) — a post-write
 *   re-check of the SAME gate against a fresh sibling-claim read self-rolls-back
 *   (`rollbackClaim`, CAS-guarded) a claim that a concurrent write raced into an
 *   anchor-overlap conflict during the pre-write gate check's now-stale snapshot. No
 *   lock table / daemon / mutex row was added — see that method's JSDoc for the full
 *   race analysis and the accepted double-rollback residual.
 *
 * Side-effect class: IO (reads/writes via StoreInterface; emits telemetry).
 * Source: SPEC-056 §Design Decisions D1, D2, D5, D7; §Public Interface; SPEC-025 §3 D2,
 *   D3, D5, D7, D8, D10 (inherited); SPEC-042 §Design Decisions D5 (inherited, checkpoint
 *   renamed); BUG-011 (anchor-overlap gate TOCTOU hardening)
 */

import { z } from "zod";
import { err, ok, type Result } from "@lore/core";
import type { LoreError } from "@lore/core";
import {
  evidenceEntrySchema,
  taskClaimSchema,
  checklistItemSchema,
  isClaimStale,
  evaluateReadiness,
  buildTaskClaim,
  deriveSessions,
  extractFileAnchors,
  anchorsOverlap,
  type EvidenceEntry,
  type TaskClaim,
  type ChecklistItem,
  type BlockerInfo,
} from "@lore/core";
import type { DocId, DocRecord, DocStatus } from "@lore/core";
import { NoOpTelemetry, type Telemetry, type TelemetryEvent, type TaskWorkflowEventName } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { resolveDoc } from "./resolve.js";
import { buildUpstreamSpecContext, buildAnchorGateContext } from "./checkpoint-registry.js";
import type { GateDependencies } from "./gate-enforcer.js";
import type {
  ClaimOpts,
  ReleaseOpts,
  EvidenceInput,
  VerifiedEvidenceInput,
  AnchorConflict,
  ReadyReport,
} from "./task-workflow-service.js";

/**
 * Re-exported verbatim from `./task-workflow-service.js` (SPEC-056 D1/P1) — never
 * redeclared here. See each type's own JSDoc in that module for the full contract;
 * this file's methods below consume them structurally unchanged.
 */
export type { ClaimOpts, ReleaseOpts, EvidenceInput, VerifiedEvidenceInput, AnchorConflict, ReadyReport };

// ─── Internal Helpers ──────────────────────────────────────────────────────
// Small, pure, module-private — duplicated from task-workflow-service.ts rather than
// exported from it (that file is untouched, out of this task's declared anchors, and
// still the live task-doc implementation; SPEC-025/042 precedent already treats each
// claim/evidence service as self-contained — see that module's own header invariants).

const defaultNow = (): string => new Date().toISOString();

/** Reads and validates phase.extra.claim. Returns undefined when absent or malformed. */
function readClaim(doc: DocRecord): TaskClaim | undefined {
  const raw = doc.extra["claim"];
  if (raw === undefined || raw === null) return undefined;
  const parsed = taskClaimSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** Reads and validates phase.extra.verification_evidence. Returns [] when absent or malformed. */
function readEvidence(doc: DocRecord): EvidenceEntry[] {
  const raw = doc.extra["verification_evidence"];
  if (!Array.isArray(raw)) return [];
  const parsed = z.array(evidenceEntrySchema).safeParse(raw);
  return parsed.success ? parsed.data : [];
}

/**
 * Reads and validates phase.extra.checklist. Returns [] when absent or malformed —
 * feeds `appendEvidenceEntry`'s `checklist_ref` cross-validation (SPEC-056 §Design
 * Decisions D8, mirrors `readEvidence`'s own "extract, tolerate malformed" shape).
 */
function readChecklist(doc: DocRecord): ChecklistItem[] {
  const raw = doc.extra["checklist"];
  if (!Array.isArray(raw)) return [];
  const parsed = z.array(checklistItemSchema).safeParse(raw);
  return parsed.success ? parsed.data : [];
}

/** Computes age in whole minutes between two ISO timestamps (nowIso - atIso). */
function ageMinutesBetween(nowIso: string, atIso: string): number {
  return Math.floor((new Date(nowIso).getTime() - new Date(atIso).getTime()) / 60_000);
}

// ─── PhaseWorkflowService ──────────────────────────────────────────────────

export class PhaseWorkflowService {
  private readonly telemetry: Telemetry;
  /** Public — mirrors TaskWorkflowService.claimTtlMinutes's "single TTL, no second thread" rationale. */
  readonly claimTtlMinutes: number;

  private readonly resolveDeclaredAcIds: (
    planId: string,
  ) => Promise<Result<Set<string> | null, LoreError>>;

  /**
   * @param store - Storage abstraction (same instance passed to CorpusService)
   * @param telemetry - Telemetry sink (own wiring, mirrors TaskWorkflowService's D8)
   * @param config - `{ claimTtlMinutes }` — see resolveClaimTtlMinutes in @lore/core
   * @param resolveDeclaredAcIds - SPEC-038 §7 D4 cross-entity port (inherited unchanged);
   *   production wiring is `corpusService.resolveDeclaredAcIds.bind(corpusService)`.
   * @param gate - OPTIONAL gate-enforcement dependency bundle — `{enforcer, getPlanBundle}`.
   *   When present, `claim` runs the `phase-claim` checkpoint (SPEC-056 D2/D7) before
   *   writing the lease. Absent (the default) → ungated, byte-identical shape to
   *   TaskWorkflowService's own optional-gate constructor param.
   */
  constructor(
    private readonly store: StoreInterface,
    telemetry: Telemetry = new NoOpTelemetry(),
    config: { claimTtlMinutes: number },
    resolveDeclaredAcIds: (
      planId: string,
    ) => Promise<Result<Set<string> | null, LoreError>> = async () => ok(null),
    private readonly gate?: GateDependencies,
  ) {
    this.telemetry = telemetry;
    this.claimTtlMinutes = config.claimTtlMinutes;
    this.resolveDeclaredAcIds = resolveDeclaredAcIds;
  }

  // ── addEvidence ───────────────────────────────────────────────────────────

  /**
   * Appends one oracle verification record to phase.extra.verification_evidence.
   * Fails loud (VALIDATION_ERROR, doc unchanged) when the array already holds 50
   * entries or the entry itself fails schema validation, or the target is a legacy
   * `task`-typed doc (write paths do NOT extend the D2 read tolerance).
   *
   * @param idOrSlug - Phase document ULID or slug
   * @param entry - Evidence fields minus recorded_at (set here from `now()`)
   * @param now - Time seam (D10); defaults to `() => new Date().toISOString()`
   * @returns The updated phase DocRecord
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a phase / cap reached / bad entry), STALE_VERSION
   */
  async addEvidence(
    idOrSlug: string,
    entry: EvidenceInput,
    now: () => string = defaultNow,
  ): Promise<Result<DocRecord, LoreError>> {
    const startMs = Date.now();
    const result = await this._addEvidenceImpl(idOrSlug, entry, now);
    this.recordEvent("task.evidence_added", startMs, result, entry.source, {
      oracle: entry.oracle,
      result: entry.result,
    });
    return result;
  }

  private async _addEvidenceImpl(
    idOrSlug: string,
    entry: EvidenceInput,
    now: () => string,
  ): Promise<Result<DocRecord, LoreError>> {
    // reason: SPEC-039 §4 D2 parity — attestation is runner-issued only; addEvidence
    // rejects a raw input carrying the key rather than silently stripping it. The sole
    // injection point for `attestation` on a phase doc is `recordChecklistVerifiedEvidence`
    // below (SPEC-056 §Design Decisions D8), mirroring TaskWorkflowService's
    // addEvidence/recordVerifiedEvidence split exactly.
    if (Object.prototype.hasOwnProperty.call(entry, "attestation")) {
      return err({
        code: "VALIDATION_ERROR",
        field: "attestation",
        message: "attestation is runner-issued; not a valid addEvidence input field",
        value: (entry as Record<string, unknown>)["attestation"],
      });
    }

    return this.appendEvidenceEntry(idOrSlug, entry, entry.recorded_by, now);
  }

  // ── recordChecklistVerifiedEvidence ─────────────────────────────────────

  /**
   * SOLE injection point for `EvidenceEntry.attestation` on a phase doc (SPEC-056
   * §Design Decisions D8 — the phase-doc-typed sibling of
   * `TaskWorkflowService.recordVerifiedEvidence`, SPEC-039 §2 D2). NOT registered on
   * any CLI/MCP surface — the intended production caller is a future checklist-script
   * runner wiring (out of THIS task's scope; this port exists so that wiring has
   * somewhere to land without a second executor or a cross-service import, per the
   * spec's D8 rationale). Requires `entry.checklist_ref` to be set (unlike `ac_ref` on
   * `addEvidence`/`appendEvidenceEntry`, which stays optional) — this port exists
   * SPECIFICALLY to attest a checklist item's script run, so a call with no
   * `checklist_ref` at all is a caller error, checked BEFORE the shared append path
   * (which still re-validates the id exists on this specific phase).
   *
   * @param idOrSlug - Phase document ULID or slug
   * @param entry - Full evidence fields INCLUDING attestation, minus recorded_at;
   *   `checklist_ref` is REQUIRED (checked here, not by the type alone)
   * @param nowIso - Caller-supplied current time (D10) — a resolved ISO string
   * @returns The updated phase DocRecord
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a phase / missing checklist_ref /
   *   unknown checklist_ref / cap reached / bad entry / bad ac_ref), STALE_VERSION
   */
  async recordChecklistVerifiedEvidence(
    idOrSlug: string,
    entry: VerifiedEvidenceInput,
    nowIso: string,
  ): Promise<Result<DocRecord, LoreError>> {
    const startMs = Date.now();

    if (entry.checklist_ref === undefined) {
      return err({
        code: "VALIDATION_ERROR",
        field: "checklist_ref",
        message: "recordChecklistVerifiedEvidence requires entry.checklist_ref",
        value: entry.checklist_ref,
      });
    }

    // reason: same time-seam wrapping trick TaskWorkflowService.recordVerifiedEvidence
    // uses — appendEvidenceEntry takes a `now` THUNK so its cap-check-then-build
    // ordering stays identical to addEvidence's; this method's own public contract
    // stays a plain resolved `nowIso: string` (its intended caller resolves "now" once
    // per run, not per evidence entry).
    const result = await this.appendEvidenceEntry(idOrSlug, entry, entry.recorded_by, () => nowIso);
    this.recordEvent("task.evidence_added", startMs, result, undefined, {
      oracle: entry.oracle,
      result: entry.result,
      attested: entry.attestation !== undefined,
    });
    return result;
  }

  /**
   * Shared append implementation for {@link addEvidence} (self-reported, never carries
   * `attestation` by construction of its caller) and
   * {@link recordChecklistVerifiedEvidence} (runner-attested, SPEC-056 §Design
   * Decisions D8 sole injection point) — cap check, schema validation, `ac_ref` AND
   * `checklist_ref` cross-entity validation, and the writePhaseExtra commit path all
   * live here exactly once. Mirrors `TaskWorkflowService.appendEvidenceEntry`'s
   * time-seam ordering (`now` invoked AFTER resolvePhase + the cap check, immediately
   * before building the candidate) for the same STALE_VERSION test-recipe reason.
   */
  private async appendEvidenceEntry(
    idOrSlug: string,
    entry: VerifiedEvidenceInput,
    actor: string,
    now: () => string,
  ): Promise<Result<DocRecord, LoreError>> {
    const phaseResult = await this.resolvePhase(idOrSlug);
    if (!phaseResult.ok) return phaseResult;
    const phase = phaseResult.value;

    const existing = readEvidence(phase);
    if (existing.length >= 50) {
      return err({
        code: "VALIDATION_ERROR",
        field: "extra.verification_evidence",
        message: "Evidence log is full (50 entries max) — cannot append a 51st entry",
        value: existing.length,
      });
    }

    const nowIso = now();
    const candidate = {
      oracle: entry.oracle,
      command: entry.command,
      result: entry.result,
      recorded_at: nowIso,
      recorded_by: entry.recorded_by,
      ...(entry.output_tail !== undefined ? { output_tail: entry.output_tail } : {}),
      ...(entry.ac_ref !== undefined ? { ac_ref: entry.ac_ref } : {}),
      ...(entry.checklist_ref !== undefined ? { checklist_ref: entry.checklist_ref } : {}),
      ...(entry.attestation !== undefined ? { attestation: entry.attestation } : {}),
    };
    const parsedEntry = evidenceEntrySchema.safeParse(candidate);
    if (!parsedEntry.success) {
      const issue = parsedEntry.error.issues[0];
      return err({
        code: "VALIDATION_ERROR",
        field: issue !== undefined ? `evidence.${issue.path.join(".")}` : "evidence",
        message: issue !== undefined ? issue.message : "Invalid evidence entry",
        value: candidate,
      });
    }

    if (parsedEntry.data.ac_ref !== undefined) {
      if (phase.parent_id === null) {
        return err({
          code: "VALIDATION_ERROR",
          field: "ac_ref",
          message: `ac_ref "${parsedEntry.data.ac_ref}" cannot be validated — phase has no parent plan`,
          value: parsedEntry.data.ac_ref,
        });
      }
      const declaredResult = await this.resolveDeclaredAcIds(phase.parent_id);
      if (!declaredResult.ok) return declaredResult;
      const declared = declaredResult.value;
      if (declared === null || !declared.has(parsedEntry.data.ac_ref)) {
        const available =
          declared !== null && declared.size > 0
            ? Array.from(declared).sort().join(", ")
            : "(none — parent spec has no structured acceptance_criteria)";
        return err({
          code: "VALIDATION_ERROR",
          field: "ac_ref",
          message: `ac_ref "${parsedEntry.data.ac_ref}" is not declared on the parent spec. Available ids: ${available}`,
          value: parsedEntry.data.ac_ref,
        });
      }
    }

    // reason: checklist_ref cross-entity validation (SPEC-056 §Design Decisions D8) —
    // unlike ac_ref (which points at a SIBLING doc's declared set, needing the injected
    // resolveDeclaredAcIds port), a checklist item lives on THIS SAME phase doc, already
    // in hand — no extra IO or injected port needed.
    if (parsedEntry.data.checklist_ref !== undefined) {
      const declaredChecklistIds = new Set(readChecklist(phase).map((item) => item.id));
      if (!declaredChecklistIds.has(parsedEntry.data.checklist_ref)) {
        const available =
          declaredChecklistIds.size > 0
            ? Array.from(declaredChecklistIds).sort().join(", ")
            : "(none — phase has no declared checklist items)";
        return err({
          code: "VALIDATION_ERROR",
          field: "checklist_ref",
          message: `checklist_ref "${parsedEntry.data.checklist_ref}" is not declared on this phase's checklist. Available ids: ${available}`,
          value: parsedEntry.data.checklist_ref,
        });
      }
    }

    const newExtra: Record<string, unknown> = {
      ...phase.extra,
      verification_evidence: [...existing, parsedEntry.data],
    };

    return this.writePhaseExtra(
      phase,
      newExtra,
      nowIso,
      actor,
      `Evidence added: ${entry.oracle} ${entry.result}`,
      "evidence",
      { oracle: entry.oracle, command: entry.command, result: entry.result },
    );
  }

  // ── claim ────────────────────────────────────────────────────────────────

  /**
   * Acquires, refreshes, or steals the advisory execution lease on a phase doc.
   * Semantics inherited from SPEC-025 §8.3 (unchanged):
   *   - No existing claim → acquired.
   *   - Existing claim held by the same `by` → refreshed (`at` updated).
   *   - Existing claim is stale (age > TTL) → claimable without `--steal`.
   *   - Existing claim is fresh and held by someone else → CLAIM_CONFLICT unless `steal`.
   * Refuses a legacy `task`-typed target with VALIDATION_ERROR (D2 write-path asymmetry).
   *
   * @param idOrSlug - Phase document ULID or slug
   * @param opts - `{ by, branch?, steal?, source? }`
   * @param now - Time seam (D10)
   * @returns The updated phase DocRecord
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a phase), CLAIM_CONFLICT, STALE_VERSION
   */
  async claim(
    idOrSlug: string,
    opts: ClaimOpts,
    now: () => string = defaultNow,
  ): Promise<Result<DocRecord, LoreError>> {
    const startMs = Date.now();
    const result = await this._claimImpl(idOrSlug, opts, now);
    this.recordEvent("task.claimed", startMs, result, opts.source, {
      by: opts.by,
      steal: opts.steal === true,
    });
    return result;
  }

  private async _claimImpl(
    idOrSlug: string,
    opts: ClaimOpts,
    now: () => string,
  ): Promise<Result<DocRecord, LoreError>> {
    const phaseResult = await this.resolvePhase(idOrSlug);
    if (!phaseResult.ok) return phaseResult;
    const phase = phaseResult.value;

    // reason: SPEC-042 D5 seam pinning (inherited) — nowIso resolved BEFORE the gate
    // call so the anchor-overlap predicate's sibling staleness and this method's OWN
    // existing-claim staleness check below share the exact same "now".
    const nowIso = now();

    const gateResult = await this.enforceClaimGate(phase, opts.by, nowIso);
    if (!gateResult.ok) return gateResult;

    const existingClaim = readClaim(phase);
    let carryForward = false;

    if (existingClaim !== undefined) {
      const stale = isClaimStale(existingClaim, nowIso, this.claimTtlMinutes);
      const sameHolder = existingClaim.by === opts.by;
      if (!stale && !sameHolder && opts.steal !== true) {
        return err({
          code: "CLAIM_CONFLICT",
          id: phase.id,
          holder: existingClaim.by,
          age_minutes: ageMinutesBetween(nowIso, existingClaim.at),
        });
      }
      carryForward = !stale && sameHolder;
    }

    const newClaim: TaskClaim = buildTaskClaim(
      existingClaim,
      {
        by: opts.by,
        at: nowIso,
        ...(opts.branch !== undefined ? { branch: opts.branch } : {}),
        ...(opts.machine !== undefined ? { machine: opts.machine } : {}),
        ...(opts.worktree !== undefined ? { worktree: opts.worktree } : {}),
      },
      carryForward,
    );
    const newExtra: Record<string, unknown> = { ...phase.extra, claim: newClaim };

    const summary =
      existingClaim !== undefined && existingClaim.by !== opts.by
        ? `Claimed by ${opts.by} (previous holder: ${existingClaim.by})`
        : `Claimed by ${opts.by}`;

    const writeResult = await this.writePhaseExtra(phase, newExtra, nowIso, opts.by, summary, "claim", {
      by: opts.by,
      steal: opts.steal === true,
      ...(existingClaim !== undefined ? { previous_holder: existingClaim.by } : {}),
    });
    if (!writeResult.ok) return writeResult;

    // reason: BUG-011 TOCTOU hardening (write-then-verify, no new lock infra) — the
    // phase-doc-typed sibling of `TaskWorkflowService.claim`'s IDENTICAL fix; see that
    // method's own JSDoc/inline comment for the full race analysis (single-writer-store
    // serialization ⇒ the LATER committer's post-write re-check always observes the
    // earlier committer's already-persisted claim ⇒ at least one side always
    // self-rolls-back; both may roll back on close timing — accepted, loud, retriable).
    const postWriteGateResult = await this.enforceClaimGate(phase, opts.by, nowIso);
    if (!postWriteGateResult.ok) {
      const rollbackResult = await this.rollbackClaim(writeResult.value, existingClaim, opts.by, now);
      if (!rollbackResult.ok) {
        // reason: never swallow a rollback failure — see TaskWorkflowService's
        // identical branch for the full rationale (a THIRD concurrent write racing the
        // rollback itself is surfaced loud, never silently retried).
        return err({
          code: "VALIDATION_ERROR",
          field: "gate:phase-claim:anchor-overlap",
          message:
            `Post-write anchor-overlap conflict detected on phase "${phase.slug}" AND the ` +
            `automatic self-rollback failed (${rollbackResult.error.code}) — its claim was ` +
            `left in the conflicting state. Manually inspect/release "${phase.slug}".`,
          value: { conflict: postWriteGateResult.error, rollback_error: rollbackResult.error },
        });
      }
      return postWriteGateResult;
    }

    return writeResult;
  }

  /**
   * BUG-011 self-rollback — the phase-doc-typed sibling of
   * `TaskWorkflowService.rollbackClaim`; see that method's JSDoc for the full rationale
   * (including why a deterministic tiebreak was evaluated and rejected). Restores
   * `extra.claim` to its value immediately BEFORE the just-committed write, CAS-guarded
   * via {@link writePhaseExtra}'s own CAS against `written.version`.
   */
  private async rollbackClaim(
    written: DocRecord,
    preClaim: TaskClaim | undefined,
    by: string,
    now: () => string,
  ): Promise<Result<DocRecord, LoreError>> {
    const rollbackExtra: Record<string, unknown> = { ...written.extra };
    if (preClaim !== undefined) {
      rollbackExtra["claim"] = preClaim;
    } else {
      delete rollbackExtra["claim"];
    }
    return this.writePhaseExtra(
      written,
      rollbackExtra,
      now(),
      by,
      `Self-rollback by ${by}: anchor-overlap conflict detected after write (BUG-011 TOCTOU guard)`,
      "release",
      { by, rollback: true },
    );
  }

  // ── release ──────────────────────────────────────────────────────────────

  /**
   * Clears the advisory execution lease on a phase doc. Holder-or-`--force` gate:
   * a non-holder release without `force: true` is rejected with CLAIM_CONFLICT.
   * Refuses a legacy `task`-typed target with VALIDATION_ERROR (D2 write-path asymmetry).
   *
   * @param idOrSlug - Phase document ULID or slug
   * @param opts - `{ by, reason?, force?, source? }`
   * @param now - Time seam (D10)
   * @returns The updated phase DocRecord
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a phase / no active claim), CLAIM_CONFLICT, STALE_VERSION
   */
  async release(
    idOrSlug: string,
    opts: ReleaseOpts,
    now: () => string = defaultNow,
  ): Promise<Result<DocRecord, LoreError>> {
    const startMs = Date.now();
    const result = await this._releaseImpl(idOrSlug, opts, now);
    this.recordEvent("task.released", startMs, result, opts.source, {
      by: opts.by,
      force: opts.force === true,
    });
    return result;
  }

  private async _releaseImpl(
    idOrSlug: string,
    opts: ReleaseOpts,
    now: () => string,
  ): Promise<Result<DocRecord, LoreError>> {
    const phaseResult = await this.resolvePhase(idOrSlug);
    if (!phaseResult.ok) return phaseResult;
    const phase = phaseResult.value;

    const existingClaim = readClaim(phase);
    if (existingClaim === undefined) {
      return err({
        code: "VALIDATION_ERROR",
        field: "extra.claim",
        message: "Phase has no active claim to release",
        value: phase.id,
      });
    }

    const nowIso = now();
    const isHolder = existingClaim.by === opts.by;
    if (!isHolder && opts.force !== true) {
      return err({
        code: "CLAIM_CONFLICT",
        id: phase.id,
        holder: existingClaim.by,
        age_minutes: ageMinutesBetween(nowIso, existingClaim.at),
      });
    }

    const newExtra: Record<string, unknown> = { ...phase.extra };
    delete newExtra["claim"];

    const forcedNote = !isHolder ? ` (forced, previous holder: ${existingClaim.by})` : "";
    const reasonNote = opts.reason !== undefined ? `: ${opts.reason}` : "";
    const summary = `Released by ${opts.by}${forcedNote}${reasonNote}`;

    return this.writePhaseExtra(phase, newExtra, nowIso, opts.by, summary, "release", {
      by: opts.by,
      force: opts.force === true,
      previous_holder: existingClaim.by,
      ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
    });
  }

  // ── ready ────────────────────────────────────────────────────────────────

  /**
   * Computed readiness report for every phase (AND legacy task, D2 read tolerance)
   * doc under a plan. Zero writes (D3, inherited).
   *
   * @param planIdOrSlug - Plan document ULID or slug
   * @param now - Time seam (D10) — drives claim staleness computation
   * @returns `ReadyReport` — `{records, sessions, anchor_conflicts}`
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a plan)
   */
  async ready(
    planIdOrSlug: string,
    now: () => string = defaultNow,
  ): Promise<Result<ReadyReport, LoreError>> {
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

    let parentSpecStatus: DocStatus | null = null;
    if (plan.parent_id !== null) {
      const parentResult = await this.store.find(plan.parent_id);
      if (!parentResult.ok) return parentResult;
      if (parentResult.value !== null && parentResult.value.type === "spec") {
        parentSpecStatus = parentResult.value.status;
      }
    }

    const childrenResult = await this.fetchPlanChildren(plan.id);
    if (!childrenResult.ok) return childrenResult;
    const children = childrenResult.value;

    if (children.length === 0) return ok({ records: [], sessions: [], anchor_conflicts: [] });

    const nowIso = now();

    const childIds = children.map((c) => c.id);
    const linksResult = await this.store.findLinksByToIds(childIds, "blocks");
    if (!linksResult.ok) return linksResult;
    const blocksLinks = linksResult.value;

    const blockerIds = new Set(blocksLinks.map((l) => l.from_id));
    const blockerStatuses = new Map<DocId, BlockerInfo>();
    if (blockerIds.size > 0) {
      const allDocsResult = await this.store.findMany({});
      if (!allDocsResult.ok) return allDocsResult;
      for (const doc of allDocsResult.value) {
        if (blockerIds.has(doc.id)) {
          blockerStatuses.set(doc.id, { slug: doc.slug, status: doc.status });
        }
      }
    }

    const records = evaluateReadiness(
      children,
      blocksLinks,
      blockerStatuses,
      nowIso,
      this.claimTtlMinutes,
      parentSpecStatus,
    );

    const { anchorConflicts } = this.computeAnchorAdvisories(children, nowIso);

    return ok({
      records,
      sessions: deriveSessions(children, nowIso, this.claimTtlMinutes),
      anchor_conflicts: anchorConflicts,
    });
  }

  /**
   * Fetches a plan's `phase`-typed children UNION its legacy `task`-typed children
   * (D2 read tolerance) — two type-filtered `findMany` calls (the store interface has
   * no multi-type filter), never a single unfiltered scan (which would risk silently
   * absorbing an unrelated doc type sharing the same `parent_id`, however unlikely).
   */
  private async fetchPlanChildren(planId: DocId): Promise<Result<DocRecord[], LoreError>> {
    const phasesResult = await this.store.findMany({ parent_id: planId, type: "phase" });
    if (!phasesResult.ok) return phasesResult;
    const legacyTasksResult = await this.store.findMany({ parent_id: planId, type: "task" });
    if (!legacyTasksResult.ok) return legacyTasksResult;
    return ok([...phasesResult.value, ...legacyTasksResult.value]);
  }

  /**
   * Computes SPEC-042 D7's `anchor_conflicts` advisory over a plan's phase/legacy-task
   * children — pure computation over already-fetched data, ported unchanged from
   * `TaskWorkflowService`'s identical private helper (doc-type-agnostic by construction:
   * reads only `extra.claim`/`extra.file_anchors`, generic across task/phase docs).
   */
  private computeAnchorAdvisories(
    docs: DocRecord[],
    nowIso: string,
  ): { anchorConflicts: AnchorConflict[] } {
    const anchorConflicts: AnchorConflict[] = [];

    for (const doc of docs) {
      const docAnchors = extractFileAnchors(doc);
      if (docAnchors.length === 0) continue;
      const docClaim = readClaim(doc);

      for (const other of docs) {
        if (other.id === doc.id) continue;
        const otherClaim = readClaim(other);
        if (otherClaim === undefined) continue;
        if (isClaimStale(otherClaim, nowIso, this.claimTtlMinutes)) continue;
        if (docClaim !== undefined && docClaim.by === otherClaim.by) continue;
        const otherAnchors = extractFileAnchors(other);
        if (otherAnchors.length === 0) continue;
        const overlap = anchorsOverlap(docAnchors, otherAnchors);
        if (overlap.overlaps) {
          anchorConflicts.push({
            task_slug: doc.slug,
            holder: otherClaim.by,
            paths: overlap.pairs.map(([a]) => a),
          });
        }
      }
    }

    return { anchorConflicts };
  }

  // ── Private Helpers ──────────────────────────────────────────────────────

  /**
   * Resolves idOrSlug and validates it is a `phase` document — the D2 WRITE-path
   * check. A legacy `task`-typed doc resolves fine at the store layer but is refused
   * HERE with VALIDATION_ERROR (never CLAIM_CONFLICT/etc — the doc-type mismatch is
   * checked before any claim-state logic runs), which is what makes `ready()`'s READ
   * tolerance (a separate code path, `fetchPlanChildren`) and this WRITE refusal the
   * deliberate asymmetry D2 names.
   */
  private async resolvePhase(idOrSlug: string): Promise<Result<DocRecord, LoreError>> {
    const docResult = await resolveDoc(this.store, idOrSlug);
    if (!docResult.ok) return docResult;
    const doc = docResult.value;
    if (doc.type !== "phase") {
      return err({
        code: "VALIDATION_ERROR",
        field: "type",
        message: `Expected a phase document; got type '${doc.type}' (legacy task docs are read-tolerated by ready() only — see PhaseWorkflowService's module header D2)`,
        value: doc.type,
      });
    }
    return ok(doc);
  }

  /**
   * Gates `phase`'s claim via the `phase-claim` checkpoint (SPEC-056 D2/D7 — the
   * task-claim-gate's phase-doc-typed sibling checkpoint, registered additively in
   * `checkpoint-registry.ts` reusing the SAME checkpoint-agnostic predicate functions).
   * Mirrors `TaskWorkflowService.enforceClaimGate` exactly except for the checkpoint id.
   */
  private async enforceClaimGate(
    phase: DocRecord,
    by: string,
    nowIso: string,
  ): Promise<Result<void, LoreError>> {
    if (this.gate === undefined) {
      return ok(undefined);
    }

    if (!this.gate.enforcer.isEnabled("phase-claim")) {
      return ok(undefined);
    }

    let ctx: ReturnType<typeof buildUpstreamSpecContext> &
      Partial<ReturnType<typeof buildAnchorGateContext>>;
    if (phase.parent_id === null) {
      ctx = {
        ...buildUpstreamSpecContext(undefined),
        candidateBy: by,
        candidateAnchors: extractFileAnchors(phase),
        siblingClaims: [],
      };
    } else {
      const bundleResult = await this.gate.getPlanBundle(phase.parent_id);
      if (!bundleResult.ok) return bundleResult;
      const anchorCtx = buildAnchorGateContext(by, phase, bundleResult.value.tasks, nowIso, this.claimTtlMinutes);
      ctx = { ...buildUpstreamSpecContext(bundleResult.value.spec), ...anchorCtx };
    }

    return this.gate.enforcer.enforce("phase-claim", {
      ...ctx,
      targetIdOrSlug: phase.slug,
      // reason: no phase-claim-specific anchor_overlap sub-knob exists yet (only the
      // WHOLE-checkpoint enabled key got the SPEC-056 D7 alias) — reusing
      // isTaskClaimAnchorOverlapEnabled() here is an interim choice (no RED test/AC
      // in this task exercises a phase-claim-scoped disable), not a semantic claim
      // that phase and task share config. A future task can add a dedicated
      // isPhaseClaimAnchorOverlapEnabled() on GateEnforcer if that granularity is
      // ever needed.
      anchorOverlapEnabled: this.gate.enforcer.isTaskClaimAnchorOverlapEnabled(),
    });
  }

  /**
   * Shared write path for addEvidence/claim/release: CAS-guarded store.update on
   * `extra` only, followed by one insertVersion snapshot, followed by one audit entry.
   * Mirrors `TaskWorkflowService.writeTaskExtra` exactly.
   */
  private async writePhaseExtra(
    phase: DocRecord,
    newExtra: Record<string, unknown>,
    nowIso: string,
    actor: string,
    changeSummary: string,
    auditAction: "claim" | "release" | "evidence",
    auditDetails: Record<string, unknown>,
  ): Promise<Result<DocRecord, LoreError>> {
    const newVersion = phase.version + 1;
    const updateResult = await this.store.update(
      phase.id,
      { extra: newExtra, updated_at: nowIso, version: newVersion },
      { expected_version: phase.version },
    );
    if (!updateResult.ok) return updateResult;

    const versionResult = await this.store.insertVersion({
      doc_id: phase.id,
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
      session_id: `${auditAction}-${phase.id}`,
      action: auditAction,
      doc_id: phase.id,
      details: { ...auditDetails, version: newVersion },
    });
    if (!auditResult.ok) return auditResult;

    return ok(updateResult.value);
  }

  /**
   * Records exactly one telemetry event per successful write. Never throws — delegates
   * to Telemetry.record() which swallows IO errors. Failed writes emit nothing.
   */
  private recordEvent<T>(
    eventName: TaskWorkflowEventName,
    startMs: number,
    result: Result<T, LoreError>,
    source: string | undefined,
    meta: Record<string, unknown>,
  ): void {
    if (!result.ok) return;
    const event: TelemetryEvent = {
      ts: new Date().toISOString(),
      service: "PhaseWorkflowService",
      method: eventName,
      ok: true,
      duration_ms: Date.now() - startMs,
      meta: source !== undefined ? { ...meta, source } : meta,
    };
    this.telemetry.record(event);
  }
}
