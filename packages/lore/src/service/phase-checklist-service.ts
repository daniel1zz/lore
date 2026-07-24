/**
 * PhaseChecklistService — manages the checklist/track verbs on a phase document's
 * `extra.checklist` / `extra.track` arrays (SPEC-056 §Module Boundary D2).
 *
 * A "phase" doc splits the phase execution model into two independent write surfaces
 * per the D2 split: this service owns checklist/track authoring, while
 * `PhaseWorkflowService` (a sibling task in this plan, NOT touched here) owns
 * claim/evidence. Mirrors `AcService`'s shape — store-only, CAS-guarded writes, one
 * `insertVersion` snapshot + one `appendAuditEntry` per write.
 *
 * Public surface:
 *   addChecklistItem(phaseIdOrSlug, item)                    → ChecklistItem[]
 *   listChecklist(phaseIdOrSlug)                              → ChecklistItem[]
 *   dropChecklistItem(phaseIdOrSlug, itemId, {by, reason})    → ChecklistItem[]
 *   checkChecklistItem(phaseIdOrSlug, itemId, {by})           → ChecklistItem[]
 *   editChecklistStatement(phaseIdOrSlug, itemId, statement)  → ChecklistItem[]
 *   addTrackNote(phaseIdOrSlug, note)                         → TrackItem[]
 *   listTrack(phaseIdOrSlug)                                  → TrackItem[]
 *
 * @invariant All methods return Promise<Result<T, LoreError>> — no thrown exceptions.
 * @invariant `addChecklistItem`/`addTrackNote` validate the FULL candidate array
 *   (existing + new) via `phaseExtraSchema.shape.checklist`/`.shape.track` in one
 *   `safeParse` call — covers the new entry's own shape (including the checklist
 *   schema's `checked` manual-bind-only superRefine) AND the 100/200-entry cap
 *   simultaneously. Mirrors `AcService.addCriterion`'s single-shot validation.
 * @invariant `dropChecklistItem` fails loud (VALIDATION_ERROR) with NO write when
 *   `reason` is missing or empty — checked BEFORE resolving the target item, so a
 *   caller never partially validates then silently drops the requirement.
 * @invariant `checkChecklistItem` rejects (VALIDATION_ERROR) a target item whose
 *   `bind.kind !== "manual"` — the service-level enforcement of "script items never
 *   carry checked" (the schema's own superRefine is the second, defense-in-depth
 *   layer that would also reject the resulting write).
 * @invariant `editChecklistStatement` VOIDS (removes) a currently-`checked` item's
 *   `checked` field as part of the same write — the write-time invariant `phase.ts`'s
 *   own module header assigns to this service ("checked being voided by a statement
 *   edit... PhaseChecklistService... is the sole writer responsible").
 * @invariant Every write (`addChecklistItem`/`dropChecklistItem`/`checkChecklistItem`/
 *   `editChecklistStatement`/`addTrackNote`) is CAS-guarded (`store.update`'s
 *   `expected_version`) and produces exactly ONE `insertVersion` snapshot + ONE
 *   `appendAuditEntry` (action "update", actor "system") — byte-identical shape to
 *   `AcService`'s `writeCriteria` private helper.
 * @invariant `resolvePhase` rejects a resolvable-but-wrong-type target with
 *   `VALIDATION_ERROR` field `"type"` (mirrors `AcService.resolveSpec`) and an
 *   unresolvable id/slug with `DOC_NOT_FOUND` (via `resolveDoc`).
 * @invariant The `phase` doc type is NOT yet a registered `DocType` (see `phase.ts`'s
 *   own module header) — `doc.type` comparisons against the literal `"phase"` go
 *   through an explicit `as string` cast, matching the fixture-construction cast the
 *   paired RED test file uses.
 *
 * Side-effect class: IO (reads and writes via StoreInterface).
 * Source: spec-spec-056-phase-execution-model-phase-doc-type-computed-comp
 *   §Module Boundary, §Design Decisions D2.
 */

import { err, ok, type Result } from "@lore/core";
import type { LoreError } from "@lore/core";
import {
  phaseExtraSchema,
  type ChecklistItem,
  type TrackItem,
} from "@lore/core";
import type { DocRecord } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { resolveDoc } from "./resolve.js";

// reason: `phaseExtraSchema.shape.checklist`/`.shape.track` are `.optional()` (the
// field may be absent on the doc at rest) — `.unwrap()` yields the inner non-optional
// array schema so a defined candidate array's parsed type never carries a spurious
// `| undefined`, while still being byte-identical validation logic to the SSOT schema.
const checklistArraySchema = phaseExtraSchema.shape.checklist.unwrap();
const trackArraySchema = phaseExtraSchema.shape.track.unwrap();

/** Options for {@link PhaseChecklistService.dropChecklistItem}. `reason` is required. */
export interface DropChecklistItemOpts {
  by: string;
  reason?: string;
}

/** Options for {@link PhaseChecklistService.checkChecklistItem}. */
export interface CheckChecklistItemOpts {
  by: string;
}

export class PhaseChecklistService {
  /**
   * @param store - Storage abstraction (same instance passed to CorpusService)
   */
  constructor(private readonly store: StoreInterface) {}

  // ── addChecklistItem ────────────────────────────────────────────────────

  /**
   * Append a new checklist item to a phase's `extra.checklist`. The FULL candidate
   * array (existing + new) is validated via `phaseExtraSchema.shape.checklist` before
   * writing — malformed shape, a script-bound item carrying `checked`, or exceeding
   * the 100-entry cap all fail loud with the doc left unchanged.
   *
   * @param phaseIdOrSlug - Phase document ULID or slug
   * @param item - Untrusted candidate checklist item
   * @returns Updated checklist array after appending
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a phase / malformed item / 101st
   *   entry), STALE_VERSION
   */
  async addChecklistItem(
    phaseIdOrSlug: string,
    item: unknown,
  ): Promise<Result<ChecklistItem[], LoreError>> {
    const phaseResult = await this.resolvePhase(phaseIdOrSlug);
    if (!phaseResult.ok) return phaseResult;
    const phase = phaseResult.value;

    const existing = extractChecklist(phase);
    const candidate = [...existing, item];
    const parsed = checklistArraySchema.safeParse(candidate);
    if (!parsed.success) {
      return validationErrorFromZodIssue("checklist", parsed.error.issues[0], item);
    }

    const writeResult = await this.writePhaseExtra(
      phase,
      { checklist: parsed.data },
      `Checklist updated — ${parsed.data.length} entries`,
    );
    if (!writeResult.ok) return writeResult;
    return ok(parsed.data);
  }

  // ── listChecklist ───────────────────────────────────────────────────────

  /**
   * Return a phase's declared checklist, in declaration order.
   *
   * @param phaseIdOrSlug - Phase document ULID or slug
   * @returns Declared checklist array
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a phase)
   */
  async listChecklist(phaseIdOrSlug: string): Promise<Result<ChecklistItem[], LoreError>> {
    const phaseResult = await this.resolvePhase(phaseIdOrSlug);
    if (!phaseResult.ok) return phaseResult;
    return ok(extractChecklist(phaseResult.value));
  }

  // ── dropChecklistItem ───────────────────────────────────────────────────

  /**
   * Mark a checklist item as dropped (`dropped: {by, at, reason}`) without removing
   * it from the array. `opts.reason` is REQUIRED and checked before any write.
   *
   * @param phaseIdOrSlug - Phase document ULID or slug
   * @param itemId - Target checklist item id
   * @param opts - `{ by, reason }` — `reason` is required (fail-loud, no default)
   * @returns Updated checklist array (item retained, now carrying `dropped`)
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a phase / missing reason / unknown
   *   item id), STALE_VERSION
   */
  async dropChecklistItem(
    phaseIdOrSlug: string,
    itemId: string,
    opts: DropChecklistItemOpts,
  ): Promise<Result<ChecklistItem[], LoreError>> {
    if (opts.reason === undefined || opts.reason.trim().length === 0) {
      return err({
        code: "VALIDATION_ERROR",
        field: "reason",
        message: "dropChecklistItem requires a non-empty reason",
        value: opts.reason,
      });
    }

    const phaseResult = await this.resolvePhase(phaseIdOrSlug);
    if (!phaseResult.ok) return phaseResult;
    const phase = phaseResult.value;

    const existing = extractChecklist(phase);
    const idx = existing.findIndex((candidate) => candidate.id === itemId);
    if (idx === -1) {
      return err({
        code: "VALIDATION_ERROR",
        field: "checklist[].id",
        message: `Checklist item "${itemId}" does not exist on this phase`,
        value: itemId,
      });
    }

    const now = new Date().toISOString();
    const target = existing[idx];
    if (target === undefined) {
      return err({
        code: "VALIDATION_ERROR",
        field: "checklist[].id",
        message: `Checklist item "${itemId}" does not exist on this phase`,
        value: itemId,
      });
    }
    const updatedItem: ChecklistItem = {
      ...target,
      dropped: { by: opts.by, at: now, reason: opts.reason },
    };
    const updated = existing.map((candidate, i) => (i === idx ? updatedItem : candidate));

    const parsed = checklistArraySchema.safeParse(updated);
    if (!parsed.success) {
      return validationErrorFromZodIssue("checklist", parsed.error.issues[0], updatedItem);
    }

    const writeResult = await this.writePhaseExtra(
      phase,
      { checklist: parsed.data },
      `Checklist item "${itemId}" dropped`,
    );
    if (!writeResult.ok) return writeResult;
    return ok(parsed.data);
  }

  // ── checkChecklistItem ──────────────────────────────────────────────────

  /**
   * Set `checked: {by, at}` on a manual-bind checklist item. Rejects a script-bind
   * target — script items signal completion via `result`, never `checked`.
   *
   * @param phaseIdOrSlug - Phase document ULID or slug
   * @param itemId - Target checklist item id
   * @param opts - `{ by }`
   * @returns Updated checklist array
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a phase / unknown item id /
   *   script-bind item), STALE_VERSION
   */
  async checkChecklistItem(
    phaseIdOrSlug: string,
    itemId: string,
    opts: CheckChecklistItemOpts,
  ): Promise<Result<ChecklistItem[], LoreError>> {
    const phaseResult = await this.resolvePhase(phaseIdOrSlug);
    if (!phaseResult.ok) return phaseResult;
    const phase = phaseResult.value;

    const existing = extractChecklist(phase);
    const idx = existing.findIndex((candidate) => candidate.id === itemId);
    if (idx === -1) {
      return err({
        code: "VALIDATION_ERROR",
        field: "checklist[].id",
        message: `Checklist item "${itemId}" does not exist on this phase`,
        value: itemId,
      });
    }
    const target = existing[idx];
    if (target === undefined) {
      return err({
        code: "VALIDATION_ERROR",
        field: "checklist[].id",
        message: `Checklist item "${itemId}" does not exist on this phase`,
        value: itemId,
      });
    }

    if (target.bind.kind !== "manual") {
      return err({
        code: "VALIDATION_ERROR",
        field: "checklist[].checked",
        message: `Checklist item "${itemId}" is script-bound — 'checked' is manual-bind-only`,
        value: target.bind.kind,
      });
    }

    const now = new Date().toISOString();
    const updatedItem: ChecklistItem = { ...target, checked: { by: opts.by, at: now } };
    const updated = existing.map((candidate, i) => (i === idx ? updatedItem : candidate));

    const parsed = checklistArraySchema.safeParse(updated);
    if (!parsed.success) {
      return validationErrorFromZodIssue("checklist", parsed.error.issues[0], updatedItem);
    }

    const writeResult = await this.writePhaseExtra(
      phase,
      { checklist: parsed.data },
      `Checklist item "${itemId}" checked`,
    );
    if (!writeResult.ok) return writeResult;
    return ok(parsed.data);
  }

  // ── editChecklistStatement ──────────────────────────────────────────────

  /**
   * Update a checklist item's `statement`. When the item currently carries `checked`,
   * the edit VOIDS (removes) it — a manual self-attestation no longer applies once the
   * claim text it attested to has changed.
   *
   * @param phaseIdOrSlug - Phase document ULID or slug
   * @param itemId - Target checklist item id
   * @param statement - New statement text
   * @returns Updated checklist array
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a phase / unknown item id / empty
   *   statement), STALE_VERSION
   */
  async editChecklistStatement(
    phaseIdOrSlug: string,
    itemId: string,
    statement: string,
  ): Promise<Result<ChecklistItem[], LoreError>> {
    const phaseResult = await this.resolvePhase(phaseIdOrSlug);
    if (!phaseResult.ok) return phaseResult;
    const phase = phaseResult.value;

    const existing = extractChecklist(phase);
    const idx = existing.findIndex((candidate) => candidate.id === itemId);
    if (idx === -1) {
      return err({
        code: "VALIDATION_ERROR",
        field: "checklist[].id",
        message: `Checklist item "${itemId}" does not exist on this phase`,
        value: itemId,
      });
    }
    const target = existing[idx];
    if (target === undefined) {
      return err({
        code: "VALIDATION_ERROR",
        field: "checklist[].id",
        message: `Checklist item "${itemId}" does not exist on this phase`,
        value: itemId,
      });
    }

    // reason: editing `statement` voids any existing manual self-attestation — the
    // `checked` marker attests to the PRIOR statement text, so it must not survive a
    // change to what is being attested (phase.ts module header invariant).
    const { checked: _voidedChecked, ...withoutChecked } = target;
    const updatedItem: ChecklistItem = { ...withoutChecked, statement };
    const updated = existing.map((candidate, i) => (i === idx ? updatedItem : candidate));

    const parsed = checklistArraySchema.safeParse(updated);
    if (!parsed.success) {
      return validationErrorFromZodIssue("checklist", parsed.error.issues[0], updatedItem);
    }

    const writeResult = await this.writePhaseExtra(
      phase,
      { checklist: parsed.data },
      `Checklist item "${itemId}" statement edited`,
    );
    if (!writeResult.ok) return writeResult;
    return ok(parsed.data);
  }

  // ── addTrackNote ─────────────────────────────────────────────────────────

  /**
   * Append a new informational work-log entry to a phase's `extra.track`. The FULL
   * candidate array (existing + new) is validated via `phaseExtraSchema.shape.track`
   * before writing — malformed shape or exceeding the 200-entry cap fail loud with the
   * doc left unchanged.
   *
   * @param phaseIdOrSlug - Phase document ULID or slug
   * @param note - Untrusted candidate track entry
   * @returns Updated track array after appending
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a phase / malformed note / 201st
   *   entry), STALE_VERSION
   */
  async addTrackNote(
    phaseIdOrSlug: string,
    note: unknown,
  ): Promise<Result<TrackItem[], LoreError>> {
    const phaseResult = await this.resolvePhase(phaseIdOrSlug);
    if (!phaseResult.ok) return phaseResult;
    const phase = phaseResult.value;

    const existing = extractTrack(phase);
    const candidate = [...existing, note];
    const parsed = trackArraySchema.safeParse(candidate);
    if (!parsed.success) {
      return validationErrorFromZodIssue("track", parsed.error.issues[0], note);
    }

    const writeResult = await this.writePhaseExtra(
      phase,
      { track: parsed.data },
      `Track updated — ${parsed.data.length} entries`,
    );
    if (!writeResult.ok) return writeResult;
    return ok(parsed.data);
  }

  // ── listTrack ────────────────────────────────────────────────────────────

  /**
   * Return a phase's declared track log, in declaration order.
   *
   * @param phaseIdOrSlug - Phase document ULID or slug
   * @returns Declared track array
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a phase)
   */
  async listTrack(phaseIdOrSlug: string): Promise<Result<TrackItem[], LoreError>> {
    const phaseResult = await this.resolvePhase(phaseIdOrSlug);
    if (!phaseResult.ok) return phaseResult;
    return ok(extractTrack(phaseResult.value));
  }

  // ── Private Helpers ─────────────────────────────────────────────────────

  /** Resolves idOrSlug and validates it is a phase document. */
  private async resolvePhase(idOrSlug: string): Promise<Result<DocRecord, LoreError>> {
    const docResult = await resolveDoc(this.store, idOrSlug);
    if (!docResult.ok) return docResult;
    const doc = docResult.value;
    // reason: `phase` is not yet a registered DocType (see phase.ts module header) —
    // the comparison target is a string literal outside the current DocType union, so
    // an explicit `as string` cast avoids TS2367 ("no overlap") without changing
    // runtime behavior.
    if ((doc.type as string) !== "phase") {
      return err({
        code: "VALIDATION_ERROR",
        field: "type",
        message: `Expected a phase document; got type '${doc.type}'`,
        value: doc.type,
      });
    }
    return ok(doc);
  }

  /**
   * Shared CAS-guarded write path for every checklist/track write: bumps the phase's
   * version, writes one insertVersion snapshot, then one audit entry (action "update",
   * actor "system") — same shape as AcService.writeCriteria's spec-extra write, so
   * AuditService.verify's versions⋈audit completeness oracle needs no special case.
   */
  private async writePhaseExtra(
    phase: DocRecord,
    extraPatch: Record<string, unknown>,
    changeSummary: string,
  ): Promise<Result<DocRecord, LoreError>> {
    const now = new Date().toISOString();
    const newVersion = phase.version + 1;
    const newExtra: Record<string, unknown> = { ...phase.extra, ...extraPatch };

    const updateResult = await this.store.update(
      phase.id,
      { extra: newExtra, updated_at: now, version: newVersion },
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
      created_at: now,
      created_by: "system",
      change_summary: changeSummary,
      // SPEC-072 D1/D2 — this write path only touches `extra`; carry the
      // current (unchanged) slug.
      slug: updateResult.value.slug,
    });
    if (!versionResult.ok) return versionResult;

    const auditResult = await this.store.appendAuditEntry({
      timestamp: now,
      actor: "system",
      session_id: phase.id,
      action: "update",
      doc_id: phase.id,
      details: { change_summary: changeSummary, version: newVersion },
    });
    if (!auditResult.ok) return auditResult;

    return ok(updateResult.value);
  }
}

// ─── Private Helpers ─────────────────────────────────────────────────────────

/**
 * Extract the validated checklist array from a phase DocRecord. Returns [] when
 * extra.checklist is absent or fails schema validation — schema-based (not
 * duck-typed), mirroring AcService's `extractCriteria`.
 */
function extractChecklist(phase: DocRecord): ChecklistItem[] {
  const parsed = checklistArraySchema.safeParse(phase.extra["checklist"]);
  return parsed.success && parsed.data !== undefined ? parsed.data : [];
}

/**
 * Extract the validated track array from a phase DocRecord. Returns [] when
 * extra.track is absent or fails schema validation.
 */
function extractTrack(phase: DocRecord): TrackItem[] {
  const parsed = trackArraySchema.safeParse(phase.extra["track"]);
  return parsed.success && parsed.data !== undefined ? parsed.data : [];
}

/** Builds a VALIDATION_ERROR LoreError from the first Zod issue on a candidate array. */
function validationErrorFromZodIssue(
  arrayField: "checklist" | "track",
  issue: { path: PropertyKey[]; message: string } | undefined,
  value: unknown,
): Result<never, LoreError> {
  return err({
    code: "VALIDATION_ERROR",
    field: issue !== undefined ? `${arrayField}.${issue.path.join(".")}` : arrayField,
    message: issue !== undefined ? issue.message : `Invalid ${arrayField} entry`,
    value,
  });
}
