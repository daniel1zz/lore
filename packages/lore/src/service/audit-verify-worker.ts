/**
 * Bun Worker entry that computes one `AuditService.verify` verdict off the serving thread (see
 * `audit-verify-runner.ts` for why and for the runner choice).
 *
 * Protocol: the parent posts one {@link AuditVerifyJob}; this worker opens its OWN store over the job's corpus,
 * runs the unchanged `AuditService.verify`, posts the `Result` back, and closes the store. Any throw is posted as
 * a STORE_ERROR carrying the thrown message verbatim — the parent then fails the request with it; nothing here
 * retries or degrades.
 *
 * Invariants:
 *   - Never writes the corpus: SQLite is opened read-only (no migration, no journal-mode change); Turso is opened
 *     with the local replica path only — no remote URL, so it does not sync (two threads syncing one embedded
 *     replica can conflict). `@libsql/client` has no read-only open, so the Turso worker relies on never calling a
 *     write method, and on the serving thread having migrated the schema first.
 *   - The store module is imported per kind so a SQLite verify never loads libsql.
 *
 * Side-effect class: IO (opens a database connection; reads only).
 */

import { err, type LoreError, type Result } from "@lore/core";
import { AuditService, type AuditVerifyResult } from "./audit-service.js";
import type { AuditVerifyJob } from "./audit-verify-runner.js";
import type { StoreInterface } from "../store/store-interface.js";

declare const self: Worker;

async function openStore(job: AuditVerifyJob): Promise<StoreInterface & { close(): void }> {
  if (job.store.kind === "sqlite") {
    const { SQLiteStore } = await import("../store/sqlite-store.js");
    return new SQLiteStore(job.store.dbPath, { readonly: true });
  }
  const { TursoStore } = await import("../store/turso-store.js");
  return new TursoStore({ localPath: job.store.localPath });
}

async function runJob(job: AuditVerifyJob): Promise<Result<AuditVerifyResult, LoreError>> {
  let store: (StoreInterface & { close(): void }) | undefined;
  try {
    store = await openStore(job);
    const service = new AuditService(store, { verifySince: job.verifySince });
    return await service.verify({
      ...(job.since !== undefined ? { since: job.since } : {}),
      ...(job.anchor !== undefined ? { anchor: job.anchor } : {}),
    });
  } catch (e) {
    return err({ code: "STORE_ERROR", message: `audit verify worker failed: ${e instanceof Error ? e.message : String(e)}` });
  } finally {
    store?.close();
  }
}

self.onmessage = (event: MessageEvent<AuditVerifyJob>): void => {
  void runJob(event.data).then((outcome) => self.postMessage(outcome));
};
