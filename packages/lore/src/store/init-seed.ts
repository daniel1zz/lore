/**
 * Store-layer door for the ONE document `lore init` seeds at birth.
 *
 * Purpose: `lore init` writes the approved write-spec rule document as one version and one audit entry. The
 * service layer offers no approved-at-create door for a skill document (`create` + `set(approved)` would write two
 * versions), so the seed goes through the store — and the store write primitives live only in `store/*` and
 * `service/corpus-service.ts` (the single-write-path zero rule), hence this module.
 *
 * Public surface: {@link insertInitSeedDoc}.
 *
 * Invariants:
 *   - Opens its own `SQLiteStore` on `dbPath` and closes it on every outcome (the scaffold holds no other handle).
 *   - Exactly one `insertWithProvenance` call: the document, its version 1 and its audit entry land together or not at all.
 *   - Never throws; every failure is returned as `err(STORE_ERROR)`.
 *
 * Side-effect class: IO (one SQLite transaction).
 */

import { err, ok } from "@lore/core";
import type { AuditEntry, DocRecord, LoreError, Result, VersionRecord } from "@lore/core";
import { SQLiteStore } from "./sqlite-store.js";

/**
 * Inserts a pre-built document with its first version and audit entry in one atomic store write.
 *
 * @param dbPath - the SQLite file of the corpus being scaffolded.
 * @param doc - the document record (version 1).
 * @param version - its version-1 row.
 * @param audit - the audit entry of the creation.
 * @returns `ok(undefined)` once committed, or the store's own error (or a `STORE_ERROR` for an exception).
 */
export async function insertInitSeedDoc(
  dbPath: string,
  doc: DocRecord,
  version: VersionRecord,
  audit: AuditEntry,
): Promise<Result<void, LoreError>> {
  let store: SQLiteStore | undefined;
  try {
    store = new SQLiteStore(dbPath);
    const inserted = await store.insertWithProvenance(doc, version, audit);
    return inserted.ok ? ok(undefined) : inserted;
  } catch (cause) {
    return err({
      code: "STORE_ERROR",
      message: `insertInitSeedDoc: failed to seed "${doc.slug}" in "${dbPath}": ${cause instanceof Error ? cause.message : String(cause)}`,
      ...(cause instanceof Error ? { cause } : {}),
    });
  } finally {
    store?.close();
  }
}
