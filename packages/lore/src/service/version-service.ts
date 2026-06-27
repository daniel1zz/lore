/**
 * VersionService — version history, diffing, and rollback for Lore documents.
 * All methods return Result<T, LoreError> — no thrown exceptions.
 * Source: SPEC-006, SPEC-001 §3.3
 */

import { createTwoFilesPatch } from "diff";
import type { DocId, DocRecord, DocStatus, VersionAction } from "@lore/core";
import { err, ok, type LoreError, type Result } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { resolveDocId } from "./resolve.js";

// ─── Public Types ──────────────────────────────────────────────────────────────

export interface VersionEntry {
  version: number;
  action: VersionAction;
  created_at: string;
  created_by: string;
  change_summary?: string;
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
  constructor(private readonly store: StoreInterface) {}

  /**
   * Return version history for a document, newest first.
   * Delegates pagination to store.findVersions.
   */
  async log(
    idOrSlug: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<Result<VersionEntry[], LoreError>> {
    const resolved = await resolveDocId(this.store, idOrSlug);
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
    const resolved = await resolveDocId(this.store, idOrSlug);
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
      });
    }
    if (!toRecord) {
      return err({
        code: "DOC_NOT_FOUND",
        id: docId,
        suggestions: [`Version ${toVer} not found`],
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
   */
  async restore(idOrSlug: string, version: number): Promise<Result<DocRecord, LoreError>> {
    const resolved = await resolveDocId(this.store, idOrSlug);
    if (!resolved.ok) return resolved;
    const docId = resolved.value;
    const allResult = await this.store.findVersions(docId);
    if (!allResult.ok) return allResult;

    const all = allResult.value;

    if (all.length === 0) {
      return err({ code: "DOC_NOT_FOUND", id: docId });
    }

    const targetRecord = all.find((v) => v.version === version);
    if (!targetRecord) {
      return err({
        code: "DOC_NOT_FOUND",
        id: docId,
        suggestions: [`Version ${version} not found`],
      });
    }

    const docResult = await this.store.find(docId);
    if (!docResult.ok) return docResult;
    if (docResult.value === null) {
      return err({ code: "DOC_NOT_FOUND", id: docId });
    }

    const currentDoc = docResult.value;
    const nextVersion = currentDoc.version + 1;
    const now = new Date().toISOString();

    // Create new version snapshot (N+1) with target version's content
    const newVersionRecord = {
      doc_id: docId,
      version: nextVersion,
      content: targetRecord.content,
      extra: { ...targetRecord.extra },
      status: "draft" as const,
      title: targetRecord.title,
      action: "restore" as const,
      created_at: now,
      created_by: currentDoc.created_by,
      change_summary: `Restored from v${version}`,
    };

    const insertResult = await this.store.insertVersion(newVersionRecord);
    if (!insertResult.ok) return insertResult;

    // Append audit entry
    const auditResult = await this.store.appendAuditEntry({
      timestamp: now,
      actor: currentDoc.created_by,
      session_id: "restore",
      action: "restore",
      doc_id: docId,
      details: { restored_from_version: version, new_version: nextVersion },
    });
    if (!auditResult.ok) return auditResult;

    // Update doc record to match restored version
    const updateResult = await this.store.update(docId, {
      content: targetRecord.content,
      extra: { ...targetRecord.extra },
      title: targetRecord.title,
      status: "draft",
      version: nextVersion,
      updated_at: now,
    }, { expected_version: currentDoc.version });

    return updateResult;
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
