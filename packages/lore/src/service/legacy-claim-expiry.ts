/**
 * `expireRunlessClaims` — the one-time data step of the schema upgrade to schema 27 (BR-1352): every claim lease that
 * names no run (written before leases were compared by run: the `harness_run` key is absent, or null) is expired, so
 * no stored lease belongs to nobody.
 *
 * Public surface: {@link expireRunlessClaims}, {@link isRunlessClaim}, {@link ExpiredClaim}.
 *
 * Invariants:
 *   - Runs only inside `lore migrate schema` (`adapters/cli/migrate-schema.ts`), the one command that upgrades a
 *     corpus; every other command refuses an older corpus, so a lease cannot be written run-less in between.
 *   - Each expiry goes through the ONE write route (`DocWritePort.writeDoc`): a version row and an audit row
 *     (`release`, `details.reason = "expired_pre_run_claim"`) name the actor of the upgrade, and the version history
 *     keeps the expired lease verbatim.
 *   - Idempotent: a document whose lease names a run is untouched, so a second run changes nothing and writes nothing.
 *   - Soft-deleted documents are not visited (they hold no live lease); archived and deprecated ones are, because a
 *     run-less lease left in a document would make the store refuse that document's next claim-carrying write.
 *   - A failure stops at the first failing document and reports it (never skips silently); documents expired before it
 *     stay expired and a re-run continues.
 *
 * Side-effect class: IO (reads documents, writes one version + audit row per expired lease).
 */

import { err, ok, type DocRecord, type LoreError, type Result } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import type { DocWritePort } from "./corpus-service.js";

/** The `session_id` of the audit rows the expiry writes (a corpus-level action belongs to no doc session). */
const EXPIRY_AUDIT_SESSION_ID = "migrate-schema";

/** One lease the upgrade expired. */
export interface ExpiredClaim {
  readonly slug: string;
  readonly type: "task" | "phase";
  /** The `by` of the expired lease. */
  readonly holder: string;
}

/** Whether `doc` holds a stored claim lease that names no run (key absent, null or empty). */
export function isRunlessClaim(doc: DocRecord): boolean {
  const claim = doc.extra["claim"];
  if (typeof claim !== "object" || claim === null) return false;
  const run = (claim as Record<string, unknown>)["harness_run"];
  return typeof run !== "string" || run === "";
}

/**
 * Expire every run-less claim lease of every task and phase document.
 *
 * @param store - the corpus store (read side only; writes go through `writer`)
 * @param writer - the one document write route
 * @param by - the actor of the upgrade (named on every version and audit row)
 * @param nowIso - timestamp of the writes
 * @returns the leases expired, in document order; `err` at the first document whose write failed
 */
export async function expireRunlessClaims(
  store: StoreInterface,
  writer: DocWritePort,
  by: string,
  nowIso: string,
): Promise<Result<ExpiredClaim[], LoreError>> {
  const expired: ExpiredClaim[] = [];
  for (const type of ["task", "phase"] as const) {
    const found = await store.findMany({ type });
    if (!found.ok) return found;
    for (const doc of found.value) {
      if (!isRunlessClaim(doc)) continue;
      const claim = doc.extra["claim"] as Record<string, unknown>;
      const holder = typeof claim["by"] === "string" ? claim["by"] : "(unknown)";
      const { claim: _expired, ...extra } = doc.extra;
      void _expired;
      const written = await writer.writeDoc({
        doc,
        patch: { extra },
        action: "update",
        changeSummary: `Claim by ${holder} expired by the schema upgrade: it was written before claims compared runs and names no run (BR-1352)`,
        auditAction: "release",
        auditDetails: { reason: "expired_pre_run_claim", previous_holder: holder, migration: 27 },
        auditSessionId: EXPIRY_AUDIT_SESSION_ID,
        lock: "none",
        by,
        now: nowIso,
      });
      if (!written.ok) return err(written.error);
      expired.push({ slug: doc.slug, type, holder });
    }
  }
  return ok(expired);
}
