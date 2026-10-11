/**
 * RecordLockService — gathers the facts that decide whether a document is a locked record, and
 * refuses a rewrite of one through the `record-edit` gate.
 *
 * Purpose: the ONE place every rewrite path (`CorpusService.set`, `VersionService.restore`,
 * `AcService` add/set/remove, `PhaseService` add/rm/rename) asks "may this document be rewritten?"
 * before it writes, so CLI, MCP, HTTP and the dashboard are gated identically (spec D6).
 *
 * Public surface: {@link RecordLockService} (`facts`, `resolve`, `assertEditable`),
 * {@link RecordEditOp}, {@link RecordEditPatch}, {@link RECORD_EDIT_CHECKPOINT}.
 *
 * Invariants:
 * - REQUIRED constructor dependency of `CorpusService`, `VersionService`, `AcService`, `PhaseService`
 *   (spec D17) — a service that is not handed one does not compile, so no write path can be left
 *   ungated by forgetting to wire it.
 * - Classification and lock resolution are `@lore/core`'s pure `resolveLock`; this module only
 *   gathers its input facts and renders nothing itself (refusal prose is the checkpoint's `feed()`).
 * - Facts it does NOT gather: evidence. The evidence count for `lore reopen` belongs to
 *   `ReviewService.reopen` through the AC-coverage query (spec §Module Boundary).
 * - `assertEditable` reaches `GateEnforcer.enforce` for every write that would REWRITE something the
 *   lock protects (not for a metadata-only save), passing the lock verdict in as a fact; the checkpoint
 *   blocks exactly when it is a locked record. A pass leaves the enforcer's `gate_passed` trace, and a
 *   disabled gate (`workflow.gates."record-edit".enabled: false`) skips with the enforcer's own
 *   `config_disabled` audit row (BR-1053).
 *
 * Side-effect class: IO (reads docs, versions and audit rows through `StoreInterface`; never writes
 * a document — a gate skip's audit row is the enforcer's own best-effort write).
 *
 * Spec: spec-documents-are-living-or-records-a-locked-record-is-never (D1, D6, D10, D11, D13, D14,
 * D16, D17). Baseline rules: BR-1047 (lock point), BR-1048 (refusal), BR-1053 (one gate knob).
 */

import {
  canonicaliseBody,
  err,
  KNOWLEDGE_SUB_TYPES,
  ok,
  resolveLock,
  type DocRecord,
  type KnowledgeSubType,
  type LockInput,
  type LockState,
  type LoreError,
  type Result,
} from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { GateEnforcer } from "./gate-enforcer.js";
import type { GateCheckpoint } from "./checkpoint-registry.js";

/** The rewrite path a caller is on — selects the change paths the refusal names. */
export type RecordEditOp = "content" | "kind" | "restore" | "criteria" | "phase-structure" | "ai-rewrite";

/** The slice of a `set` patch {@link RecordLockService.assertEditable} compares against the stored doc. */
export interface RecordEditPatch {
  readonly content?: string;
  readonly title?: string;
  readonly extra?: Readonly<Record<string, unknown>>;
}

/** The gate checkpoint every refusal is raised under. */
export const RECORD_EDIT_CHECKPOINT: GateCheckpoint = "record-edit";

/** Page size when scanning a doc's version history for an `approved` row. */
const VERSION_SCAN_PAGE = 200;

/** Statuses a document can only hold after having been approved (draft→archived is not a legal edge). */
const POST_APPROVAL_STATUSES: ReadonlySet<string> = new Set(["approved", "active", "archived"]);

function isKnowledgeSubType(value: unknown): value is KnowledgeSubType {
  return typeof value === "string" && (KNOWLEDGE_SUB_TYPES as readonly string[]).includes(value);
}

/**
 * True when `incoming` would change the stored body — compared AFTER canonicalisation, because the
 * stored body is canonicalised at write time and a resend of the same text must read as unchanged
 * (spec D14: the dashboard and MCP send content on tag/priority saves).
 */
export function bodyDiffers(stored: string, incoming: string): boolean {
  const canonicalIncoming = incoming !== "" ? canonicaliseBody(incoming) : incoming;
  const canonicalStored = stored !== "" ? canonicaliseBody(stored) : stored;
  return canonicalIncoming !== canonicalStored;
}

export class RecordLockService {
  /**
   * @param store - Storage abstraction (same instance the owning services hold).
   * @param gateEnforcer - Runs the `record-edit` checkpoint. REQUIRED: production passes the config- and
   *   audit-wired enforcer so the `workflow.gates."record-edit"` knob and the skip audit work; a service that
   *   built its own default would silently ignore the operator's config. A bare unit test passes
   *   `new GateEnforcer(undefined)` (gate on, no audit port) explicitly.
   */
  constructor(
    private readonly store: StoreInterface,
    private readonly gateEnforcer: GateEnforcer,
  ) {}

  /**
   * Gather the {@link LockInput} for `doc` — only the facts its type needs.
   *
   * @param doc - The stored document (never a candidate).
   * @returns The facts, or the store error / a `VALIDATION_ERROR` naming a fact that cannot be
   *   measured (a knowledge doc with no valid `extra.sub_type`, a phase with no resolvable plan).
   * @example
   * await recordLock.facts(approvedSpec); // => ok({ type: "spec", status: "approved", everApproved: true })
   */
  async facts(doc: DocRecord): Promise<Result<LockInput, LoreError>> {
    const base: LockInput = { type: doc.type, status: doc.status };
    switch (doc.type) {
      case "spec":
      case "adr": {
        const approved = await this.hasEverBeenApproved(doc);
        if (!approved.ok) return approved;
        return ok({ ...base, everApproved: approved.value });
      }
      case "knowledge": {
        const subType = doc.extra["sub_type"];
        if (!isKnowledgeSubType(subType)) {
          return err({
            code: "VALIDATION_ERROR",
            field: "extra.sub_type",
            message: `${doc.slug} is a knowledge doc without a valid extra.sub_type, so its standing cannot be resolved`,
            value: subType,
          });
        }
        const approved = await this.hasEverBeenApproved(doc);
        if (!approved.ok) return approved;
        return ok({ ...base, subType, everApproved: approved.value });
      }
      case "task": {
        const claimed = await this.hasEverBeenClaimed(doc);
        if (!claimed.ok) return claimed;
        return ok({ ...base, everClaimed: claimed.value });
      }
      case "plan":
        return ok({ ...base, planStatus: doc.status });
      case "phase": {
        if (doc.parent_id === null || doc.parent_id === undefined) {
          return err({
            code: "VALIDATION_ERROR",
            field: "parent_id",
            message: `${doc.slug} is a phase with no parent plan, so its standing cannot be resolved`,
            value: doc.parent_id,
          });
        }
        const plan = await this.store.find(doc.parent_id);
        if (!plan.ok) return plan;
        if (plan.value === null) {
          return err({ code: "DOC_NOT_FOUND", id: doc.parent_id });
        }
        return ok({ ...base, planStatus: plan.value.status });
      }
      case "prd":
      case "baseline":
        return ok(base);
      default: {
        const unreachable: never = doc.type;
        throw new Error(`RecordLockService.facts: unhandled doc type ${String(unreachable)}`);
      }
    }
  }

  /**
   * Resolve `doc`'s lock verdict: {@link facts} fed to `@lore/core`'s `resolveLock`.
   *
   * @returns The {@link LockState}, or the error {@link facts} produced.
   */
  async resolve(doc: DocRecord): Promise<Result<LockState, LoreError>> {
    const facts = await this.facts(doc);
    if (!facts.ok) return facts;
    return ok(resolveLock(facts.value));
  }

  /**
   * Refuse a rewrite of a locked record; pass everything else.
   *
   * Call this BEFORE the write, with the doc as stored. For `op: "content"` the patch is compared
   * to the stored body/title (difference trigger, D14) and for `op: "kind"` to the stored
   * `extra.sub_type` (D13); every other op is a rewrite by definition.
   *
   * @param doc - The stored document being edited.
   * @param op - The rewrite path the caller is on.
   * @param patch - Required for `content` / `kind` (what the caller wants to write); ignored otherwise.
   * @returns `ok(undefined)` when the write may proceed — the doc is living, an unlocked record, the
   *   patch changes nothing the lock protects, or the gate is disabled by config. `err` with
   *   `VALIDATION_ERROR` / `field: "gate:record-edit"` (exit 4) when it is a locked record.
   * @example
   * const gate = await recordLock.assertEditable(approvedSpec, "content", { content: "new body" });
   * // => err({ code: "VALIDATION_ERROR", field: "gate:record-edit", ... })
   */
  async assertEditable(
    doc: DocRecord,
    op: RecordEditOp,
    patch?: RecordEditPatch,
  ): Promise<Result<void, LoreError>> {
    if (!this.isRewrite(doc, op, patch)) return ok(undefined);

    const lock = await this.resolve(doc);
    if (!lock.ok) return lock;

    // reason: the enforcer is consulted for EVERY rewrite attempt, not only a locked one — `enforce` is
    // synchronous over a flat context, so the lock verdict is gathered above and handed in as a fact, and
    // `checkRecordEdit` blocks exactly when it is a locked record. A passing evaluation therefore leaves the
    // same `gate_passed` trace every other registered checkpoint leaves (AC-FR-8/D7), and a disabled gate
    // leaves its `config_disabled` skip row on the rewrites it stopped judging.
    const subType = doc.extra["sub_type"];
    return this.gateEnforcer.enforce(RECORD_EDIT_CHECKPOINT, {
      targetIdOrSlug: doc.slug,
      targetDocId: doc.id,
      recordEdit: {
        slug: doc.slug,
        type: doc.type,
        op,
        lock: lock.value,
        ...(typeof subType === "string" ? { subType } : {}),
      },
    });
  }

  /** Whether `patch` writes something the lock protects (D13/D14); non-set ops always rewrite. */
  private isRewrite(doc: DocRecord, op: RecordEditOp, patch: RecordEditPatch | undefined): boolean {
    switch (op) {
      case "content": {
        if (patch === undefined) {
          throw new Error('RecordLockService.assertEditable: op "content" requires the patch to compare');
        }
        const bodyChanged = patch.content !== undefined && bodyDiffers(doc.content, patch.content);
        const titleChanged = patch.title !== undefined && patch.title !== doc.title;
        return bodyChanged || titleChanged;
      }
      case "kind": {
        if (patch === undefined) {
          throw new Error('RecordLockService.assertEditable: op "kind" requires the patch to compare');
        }
        if (patch.extra === undefined) return false;
        return patch.extra["sub_type"] !== doc.extra["sub_type"];
      }
      case "restore":
      case "criteria":
      case "phase-structure":
      case "ai-rewrite":
        return true;
      default: {
        const unreachable: never = op;
        throw new Error(`RecordLockService.isRewrite: unhandled op ${String(unreachable)}`);
      }
    }
  }

  /**
   * Ever-approved fact (D1): the version history holds a status `approved` row. A doc whose CURRENT
   * status can only follow an approval (approved/active/archived) is ever-approved without the scan —
   * covers rows a fixture or an import inserted without any version rows.
   */
  private async hasEverBeenApproved(doc: DocRecord): Promise<Result<boolean, LoreError>> {
    if (POST_APPROVAL_STATUSES.has(doc.status)) return ok(true);
    for (let offset = 0; ; offset += VERSION_SCAN_PAGE) {
      const page = await this.store.findVersions(doc.id, { limit: VERSION_SCAN_PAGE, offset });
      if (!page.ok) return page;
      if (page.value.some((v) => v.status === "approved")) return ok(true);
      if (page.value.length < VERSION_SCAN_PAGE) return ok(false);
    }
  }

  /**
   * Ever-claimed fact (D10): a claim currently held, or more `claim` audit rows than rollback rows.
   *
   * Measured rollback shape (`TaskWorkflowService._claimImpl` → `rollbackClaim`, verified
   * 2026-10-11): a claim whose post-write anchor-overlap re-check fails leaves its `claim` audit row
   * in place and appends ONE `release` audit row whose `details.rollback === true`. So a rolled-back
   * claim cancels exactly one claim row; counting `claim` minus rollback-`release` rows is order- and
   * timestamp-independent (queryAudit sorts by timestamp, which can tie).
   */
  private async hasEverBeenClaimed(doc: DocRecord): Promise<Result<boolean, LoreError>> {
    if (doc.extra["claim"] !== undefined && doc.extra["claim"] !== null) return ok(true);
    const claims = await this.store.queryAudit({ doc_id: doc.id, action: "claim" });
    if (!claims.ok) return claims;
    if (claims.value.length === 0) return ok(false);
    const releases = await this.store.queryAudit({ doc_id: doc.id, action: "release" });
    if (!releases.ok) return releases;
    const rollbacks = releases.value.filter(
      (entry) => (entry.details as Record<string, unknown> | undefined)?.["rollback"] === true,
    ).length;
    return ok(claims.value.length > rollbacks);
  }
}
