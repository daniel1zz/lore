/**
 * AuditBackfillService — the one-time upgrade behind `lore migrate audit-backfill`: records, for every versions row
 * that has no audit entry and predates the audit writers, ONE hash-chained {@link AUDIT_BACKFILL_ACTION} entry marked
 * `reconstructed`, so `AuditService.verify` can check every version and never skips history by date.
 *
 * Public surface:
 *   run(opts) → preview (default) or apply; returns the versions it would reconstruct / did reconstruct.
 *
 * @invariant THE BOUNDARY IS THE DATA: "predates the audit writers" means recorded before the created_at of the
 *   EARLIEST audit entry that names a version (`details.version`, the join key; backfill entries never count). An
 *   entry without it cannot satisfy any version, so it cannot be the line. No config key and no built-in date is read.
 *   An audit trail with no such entry has no boundary, so nothing is reconstructed.
 * @invariant IDEMPOTENT: the versions it reconstructs are exactly {@link reconcileVersions}'s misses older than the
 *   boundary; once a backfill entry exists for a version it is no longer a miss, so a second apply writes nothing.
 * @invariant A version at/after the boundary with no audit entry is a genuine miss: it is never reconstructed and
 *   stays reported as missing by verification.
 * @invariant Preview writes nothing. Every entry goes through `StoreInterface.appendAuditEntry`, so it extends the
 *   hash chain inside the store's own serialized write like any audit row.
 *
 * Side-effect class: IO (reads versions and audit; with `apply`, appends audit rows through the one write route).
 */

import { err, ok, type LoreError, type Result } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import type { DocWritePort } from "./corpus-service.js";
import { AUDIT_BACKFILL_ACTION, reconcileVersions, type AuditMiss } from "./audit-service.js";

/** Why every backfill entry says its version has no original entry. */
export const AUDIT_BACKFILL_REASON = "version predates the audit writers: no audit entry was ever written for it";

/** Where the boundary comes from, named by every report. */
export const AUDIT_BACKFILL_BOUNDARY_SOURCE = "earliest audit entry";

/** Inputs of one {@link AuditBackfillService.run}. */
export interface AuditBackfillOptions {
  /** `false` previews (writes nothing); `true` appends the entries. */
  readonly apply: boolean;
  /** Who runs the upgrade (the audit actor of every entry). */
  readonly actor: string;
  /** Names this upgrade run: the entries' `session_id` and `details.run`. */
  readonly run: string;
  /** ISO 8601 timestamp of every entry written. */
  readonly nowIso: string;
}

/** What one run found (and, with `apply`, wrote). */
export interface AuditBackfillReport {
  /** The created_at of the earliest audit entry; `null` when the audit trail is empty (nothing can be derived). */
  readonly boundary: string | null;
  /** Always {@link AUDIT_BACKFILL_BOUNDARY_SOURCE}: named so a preview says where the boundary came from. */
  readonly boundarySource: typeof AUDIT_BACKFILL_BOUNDARY_SOURCE;
  readonly run: string;
  readonly applied: boolean;
  /** The versions reconstructed (apply) or that would be (preview), oldest first. */
  readonly reconstructed: readonly AuditMiss[];
}

export class AuditBackfillService {
  /**
   * @param store - the corpus store (read side only: versions and the audit trail)
   * @param writer - the one write route; every reconstructed entry is appended through it, so each carries the run of the
   *   writer's write context (the caller's), like any other audit row
   */
  constructor(
    private readonly store: StoreInterface,
    private readonly writer: DocWritePort,
  ) {}

  /**
   * @returns `ok(report)`; a store failure is returned as-is. A failure after some entries were appended leaves them
   *   in place (each is a complete chained row) and a re-run reconstructs only the rest.
   */
  async run(opts: AuditBackfillOptions): Promise<Result<AuditBackfillReport, LoreError>> {
    const versions = await this.store.listVersionKeys();
    if (!versions.ok) return versions;
    const audit = await this.store.queryAudit({});
    if (!audit.ok) return audit;

    // reason: the boundary is the first ORIGINAL entry the versions-to-audit join can use, i.e. one that names a
    // version (`details.version`). Earlier entries (a corpus's first audit rows predate the version key) cannot satisfy
    // any version, so they must not draw the line; backfill entries carry the upgrade's own time and never count.
    let boundary: string | null = null;
    for (const entry of audit.value) {
      if (entry.action === AUDIT_BACKFILL_ACTION) continue;
      if (typeof entry.details?.["version"] !== "number") continue;
      if (boundary === null || entry.timestamp < boundary) boundary = entry.timestamp;
    }
    const misses = reconcileVersions(versions.value, audit.value).misses;
    const earliest = boundary;
    const reconstructed = earliest === null ? [] : misses.filter((miss) => miss.created_at < earliest);
    if (opts.apply) {
      for (const miss of reconstructed) {
        const appended = await this.writer.appendAudit({
          timestamp: opts.nowIso,
          by: opts.actor,
          sessionId: opts.run,
          action: AUDIT_BACKFILL_ACTION,
          docId: miss.doc_id,
          details: {
            version: miss.version,
            version_action: miss.action,
            version_created_at: miss.created_at,
            reconstructed: true,
            reason: AUDIT_BACKFILL_REASON,
            run: opts.run,
          },
        });
        if (!appended.ok) return err(appended.error);
      }
    }
    return ok({ boundary, boundarySource: AUDIT_BACKFILL_BOUNDARY_SOURCE, run: opts.run, applied: opts.apply, reconstructed });
  }
}
