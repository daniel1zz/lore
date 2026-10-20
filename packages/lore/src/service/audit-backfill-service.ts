/**
 * AuditBackfillService — the one-time upgrade behind `lore migrate audit-backfill`: records, for every versions row
 * that has no audit entry and predates the audit writers, ONE hash-chained {@link AUDIT_BACKFILL_ACTION} entry marked
 * `reconstructed`, so `AuditService.verify` can check every version and never skips history by date.
 *
 * Public surface:
 *   run(opts) → preview (default) or apply; returns the versions it would reconstruct / did reconstruct.
 *
 * @invariant IDEMPOTENT: the versions it reconstructs are exactly {@link reconcileVersions}'s misses older than the
 *   boundary; once a backfill entry exists for a version it is no longer a miss, so a second apply writes nothing.
 * @invariant A version at/after the boundary with no audit entry is a genuine miss: it is never reconstructed and
 *   stays reported as missing by verification.
 * @invariant Preview writes nothing. Every entry goes through `StoreInterface.appendAuditEntry`, so it extends the
 *   hash chain inside the store's own serialized write like any audit row.
 *
 * Side-effect class: IO (reads versions and audit; with `apply`, appends audit rows through the store).
 */

import { err, ok, type LoreError, type Result } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { AUDIT_BACKFILL_ACTION, reconcileVersions, type AuditMiss } from "./audit-service.js";

/** Why every backfill entry says its version has no original entry. */
export const AUDIT_BACKFILL_REASON = "version predates the audit writers: no audit entry was ever written for it";

/** Inputs of one {@link AuditBackfillService.run}. */
export interface AuditBackfillOptions {
  /** ISO 8601: versions recorded strictly before it predate the audit writers. */
  readonly boundary: string;
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
  readonly boundary: string;
  readonly run: string;
  readonly applied: boolean;
  /** The versions reconstructed (apply) or that would be (preview), oldest first. */
  readonly reconstructed: readonly AuditMiss[];
}

export class AuditBackfillService {
  /** @param store - the corpus store (the same instance every other service holds) */
  constructor(private readonly store: StoreInterface) {}

  /**
   * @returns `ok(report)`; a store failure is returned as-is. A failure after some entries were appended leaves them
   *   in place (each is a complete chained row) and a re-run reconstructs only the rest.
   */
  async run(opts: AuditBackfillOptions): Promise<Result<AuditBackfillReport, LoreError>> {
    const versions = await this.store.listVersionKeys();
    if (!versions.ok) return versions;
    const audit = await this.store.queryAudit({});
    if (!audit.ok) return audit;

    const reconstructed = reconcileVersions(versions.value, audit.value).misses.filter((miss) => miss.created_at < opts.boundary);
    if (opts.apply) {
      for (const miss of reconstructed) {
        const appended = await this.store.appendAuditEntry({
          timestamp: opts.nowIso,
          actor: opts.actor,
          session_id: opts.run,
          action: AUDIT_BACKFILL_ACTION,
          doc_id: miss.doc_id,
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
    return ok({ boundary: opts.boundary, run: opts.run, applied: opts.apply, reconstructed });
  }
}
