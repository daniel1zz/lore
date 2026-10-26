/**
 * VersionService — version history, diffing, and rollback for Lore documents.
 * All methods return Result<T, LoreError> — no thrown exceptions.
 * Source: SPEC-006, SPEC-001 §3.3
 */

import { createTwoFilesPatch } from "diff";
import type { DocId, DocRecord, DocStatus, VersionAction, VersionRecord } from "@lore/core";
import { err, ok, type LoreError, type Result } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { resolveDocId } from "./resolve.js";
import { applyAcChange } from "./ac-write-chokepoint.js";
import type { RecordLockService } from "./record-lock-service.js";
import { bareDocWriter, type DocWritePort } from "./corpus-service.js";

// ─── Public Types ──────────────────────────────────────────────────────────────

export interface VersionEntry {
  version: number;
  action: VersionAction;
  created_at: string;
  created_by: string;
  change_summary?: string;
  /**
   * Doc's slug as of this version (SPEC-072 D1/D3) — absent on legacy rows
   * written before this field existed. Never a placeholder string; renderers
   * MUST degrade by omission, not print "unknown".
   */
  slug?: string;
}

export interface FieldChange {
  field: string;
  old_value: unknown;
  new_value: unknown;
}

export interface Diff {
  doc_id: DocId;
  from_version: number;
  to_version: number;
  /** Unified diff of content between from and to versions */
  content_diff: string;
  frontmatter_changes: FieldChange[];
  status_change?: { from: DocStatus; to: DocStatus };
}

// ─── VersionService ────────────────────────────────────────────────────────────

export class VersionService {
  /**
   * @param store - Storage abstraction.
   * @param recordLock - REQUIRED (spec-documents-are-living-or-records D17): `restore` rewrites a
   *   record's text, so it asks this before it writes. Never optional.
   */
  constructor(
    private readonly store: StoreInterface,
    private readonly recordLock: RecordLockService,
    /**
     * The one write route (`CorpusService`, AC-DCL-3). `app.ts` passes the composed `corpusService`; absent
     * (a bare unit-test construction) falls back to a bare writer over the same store.
     */
    writer?: DocWritePort,
  ) {
    this.writer = writer ?? bareDocWriter(store, recordLock);
  }

  private readonly writer: DocWritePort;

  /**
   * The versions row that holds a doc's content as of stored version number `version`: the row numbered
   * `version`, or — when `version` was a working-state-only write that added no row — the closest EARLIER row
   * (spec-history-records-content-a-working-state-only-write-adds-no Scope 2, ADR D4). Used for a version
   * number stored elsewhere (a review judgment's `doc_version`).
   *
   * @param docId - the doc (soft-deleted docs stay readable)
   * @param version - a stored doc version number, >= 1
   * @returns the row; `DOC_NOT_FOUND` when no row exists at or below `version`.
   */
  async resolveClosestEarlierRow(docId: DocId, version: number): Promise<Result<VersionRecord, LoreError>> {
    const all = await this.store.findVersions(docId);
    if (!all.ok) return all;
    let best: VersionRecord | undefined;
    for (const row of all.value) {
      if (row.version <= version && (best === undefined || row.version > best.version)) best = row;
    }
    if (best === undefined) {
      return err({
        code: "DOC_NOT_FOUND",
        id: docId,
        suggestions: [`No versions row at or below version ${version}`],
        rule: "BR-769",
      });
    }
    return ok(best);
  }

  /**
   * Return version history for a document, newest first.
   * Delegates pagination to store.findVersions.
   */
  async log(
    idOrSlug: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<Result<VersionEntry[], LoreError>> {
    // reason: history of a deleted doc stays readable (delete/undelete are rows in it).
    const resolved = await resolveDocId(this.store, idOrSlug, { includeDeleted: true });
    if (!resolved.ok) return resolved;
    const docId = resolved.value;
    const result = await this.store.findVersions(docId, {
      limit: opts?.limit ?? 20,
      offset: opts?.offset ?? 0,
    });

    if (!result.ok) return result;

    const entries: VersionEntry[] = result.value.map((v) => ({
      version: v.version,
      action: v.action,
      created_at: v.created_at,
      created_by: v.created_by,
      ...(v.change_summary !== undefined
        ? { change_summary: v.change_summary }
        : {}),
      // SPEC-072 D3 — absence-tolerant: a legacy row with no slug omits the
      // key entirely, never a placeholder.
      ...(v.slug !== undefined ? { slug: v.slug } : {}),
    }));

    return ok(entries);
  }

  /**
   * Compute a unified diff between two versions of a document.
   * Defaults: to = latest version, from = to - 1 (previous).
   *
   * When only one version exists and no explicit from/to provided,
   * returns a diff with empty content_diff (nothing to compare against).
   */
  async diff(
    idOrSlug: string,
    opts?: { from?: number; to?: number },
  ): Promise<Result<Diff, LoreError>> {
    const resolved = await resolveDocId(this.store, idOrSlug, { includeDeleted: true });
    if (!resolved.ok) return resolved;
    const docId = resolved.value;
    const allResult = await this.store.findVersions(docId);
    if (!allResult.ok) return allResult;

    const all = allResult.value; // already newest-first

    if (all.length === 0) {
      return err({
        code: "DOC_NOT_FOUND",
        id: docId,
        suggestions: ["No versions found for this document"],
        rule: "BR-769",
      });
    }

    const latestVersion = all[0]!.version;

    const toVer = opts?.to ?? latestVersion;
    const fromVer = opts?.from ?? toVer - 1;

    // Handle single-version case gracefully
    if (fromVer < 1) {
      const toRecord = all.find((v) => v.version === toVer);
      if (!toRecord) {
        return err({
          code: "DOC_NOT_FOUND",
          id: docId,
          suggestions: [`Version ${toVer} not found`],
          rule: "BR-769",
        });
      }

      return ok({
        doc_id: docId,
        from_version: fromVer,
        to_version: toVer,
        content_diff: "",
        frontmatter_changes: [],
      });
    }

    const fromRecord = all.find((v) => v.version === fromVer);
    const toRecord = all.find((v) => v.version === toVer);

    if (!fromRecord) {
      return err({
        code: "DOC_NOT_FOUND",
        id: docId,
        suggestions: [`Version ${fromVer} not found`],
        rule: "BR-769",
      });
    }
    if (!toRecord) {
      return err({
        code: "DOC_NOT_FOUND",
        id: docId,
        suggestions: [`Version ${toVer} not found`],
        rule: "BR-769",
      });
    }

    const contentDiff = createTwoFilesPatch(
      `${docId}@v${fromVer}`,
      `${docId}@v${toVer}`,
      fromRecord.content,
      toRecord.content,
    );

    const frontmatterChanges = computeFieldChanges(
      fromRecord.extra,
      toRecord.extra,
    );

    const statusChange =
      fromRecord.status !== toRecord.status
        ? { from: fromRecord.status, to: toRecord.status }
        : undefined;

    return ok({
      doc_id: docId,
      from_version: fromVer,
      to_version: toVer,
      content_diff: contentDiff,
      frontmatter_changes: frontmatterChanges,
      ...(statusChange !== undefined ? { status_change: statusChange } : {}),
    });
  }

  /**
   * Restore a document to a previous version by creating a new version N+1.
   * Non-destructive — history is append-only.
   * Resets doc status to 'draft'.
   *
   * @remarks SPEC-072 D4 — restore NEVER touches the doc's current `slug`,
   * even when `targetRecord.slug` (the version being restored FROM) carries a
   * different value than the doc's slug today. The `store.update` patch below
   * deliberately omits `slug`, and the new version-N+1 snapshot's own `slug`
   * is the doc's CURRENT (unchanged) slug — consistent with every other
   * "state as of this version" field on that snapshot, and consistent with a
   * slug being a stable address rather than restorable content (restoring an
   * old slug could also collide with a different doc that has since taken
   * it).
   */
  async restore(
    idOrSlug: string,
    version: number,
    opts?: { by?: string },
  ): Promise<Result<DocRecord, LoreError>> {
    const resolved = await resolveDocId(this.store, idOrSlug);
    if (!resolved.ok) return resolved;
    const docId = resolved.value;
    const allResult = await this.store.findVersions(docId);
    if (!allResult.ok) return allResult;

    const all = allResult.value;

    if (all.length === 0) {
      return err({ code: "DOC_NOT_FOUND", id: docId, rule: "BR-775" });
    }

    const targetRecord = all.find((v) => v.version === version);
    if (!targetRecord) {
      return err({
        code: "DOC_NOT_FOUND",
        id: docId,
        suggestions: [`Version ${version} not found`],
        rule: "BR-775",
      });
    }

    const docResult = await this.store.find(docId);
    if (!docResult.ok) return docResult;
    if (docResult.value === null) {
      return err({ code: "DOC_NOT_FOUND", id: docId, rule: "BR-775" });
    }

    const currentDoc = docResult.value;

    // AC write chokepoint (spec-baseline-slice-2 §C3, #54): a restore may change the criteria
    // array back to a historical one — a sanctioned "restore" write, re-validated like any other
    // incoming array before the write so a refusal leaves no phantom history.
    const acGate = applyAcChange("restore", currentDoc.extra, targetRecord.extra, docId);
    if (!acGate.ok) return acGate;

    // reason: AC-DCL-3 — the doc update, its version row and its audit row are ONE transaction on the one
    // write route (#113: a failure after the update used to leave an unrecorded change), attributed to the
    // CALLER (#252: it used to record the doc's creator), refused from a foreign-resolved corpus (#255), and
    // refused on a locked record (record-edit gate, spec-documents-are-living-or-records D6/BR-772: a restore
    // rewrites text and criteria wholesale; the sanctioned way to put old text back is `lore set --correction`).
    // SPEC-072 D4: the patch omits `slug` — restore NEVER restores a slug.
    const written = await this.writer.writeDoc({
      doc: currentDoc,
      patch: {
        content: targetRecord.content,
        extra: { ...targetRecord.extra },
        title: targetRecord.title,
        status: "draft",
      },
      action: "restore",
      changeSummary: `Restored from v${version}`,
      auditAction: "restore",
      auditDetails: { restored_from_version: version },
      auditSessionId: "restore",
      lock: "restore",
      ...(opts?.by !== undefined ? { by: opts.by } : {}),
    });
    if (!written.ok) return written;
    return ok(written.value.doc);
  }
}

// ─── Private Helpers ───────────────────────────────────────────────────────────

/**
 * Compute field-level changes between two extra objects.
 * Returns array of FieldChange for added, removed, or modified fields.
 */
function computeFieldChanges(
  from: Record<string, unknown>,
  to: Record<string, unknown>,
): FieldChange[] {
  const changes: FieldChange[] = [];
  const allKeys = new Set([...Object.keys(from), ...Object.keys(to)]);

  for (const field of allKeys) {
    const oldValue = Object.prototype.hasOwnProperty.call(from, field)
      ? from[field]
      : undefined;
    const newValue = Object.prototype.hasOwnProperty.call(to, field)
      ? to[field]
      : undefined;

    if (!deepEqual(oldValue, newValue)) {
      changes.push({ field, old_value: oldValue, new_value: newValue });
    }
  }

  return changes;
}

/**
 * Structural equality check for JSON-compatible values.
 * Used for frontmatter field comparison — avoids external dependency.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;

  // Both are non-null objects at this point
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, (b as unknown[])[i]));
  }

  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);

  if (keysA.length !== keysB.length) return false;
  return keysA.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(objB, key) &&
      deepEqual(objA[key], objB[key]),
  );
}
