/**
 * Regression coverage for the Result-contract gap fixed alongside BUG-002's
 * atomic composite writes: `insertWithProvenance` / `updateWithProvenance` /
 * `softDeleteWithProvenance` used to issue `db.run("BEGIN IMMEDIATE")` BEFORE
 * their try/catch, so a SYNCHRONOUS bun:sqlite throw at that call (real
 * repro below: deleting a file-mode DB's backing file + `-wal`/`-shm` out
 * from under an open handle raises `SQLiteError: disk I/O error` — SQLite's
 * IOERR family, observed live via SPEC-078 T2's multi-project mount probe as
 * `SQLITE_IOERR_VNODE`) escaped as a raw JS exception instead of the
 * `Result<T, LoreError>` every `StoreInterface` method promises its callers.
 * `softDeleteWithProvenance` coverage was added in a follow-up scope
 * extension of the same task once the identical pre-try `BEGIN IMMEDIATE`
 * was spotted alongside insert/update during review.
 *
 * Runner: bun:sqlite file-mode I/O — must run under `bun test`, not vitest
 * (see store/CLAUDE.md "bun:sqlite is external to vitest"). Uses a REAL
 * temp-dir-backed `SQLiteStore` (not `:memory:` — an in-memory DB has no
 * backing file to delete out from under it), unlike
 * `provenance-writes.bun.test.ts`'s cross-store parity suite.
 *
 * @spec_ref adhoc task-fix-result-contract-gap-begin-immediate-issued-outside-try
 */

import { mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuditEntry, DocRecord, VersionRecord } from "@lore/core";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";

// ─── Factories ───────────────────────────────────────────────────────────────

let _counter = 0;

function makeDoc(overrides: Partial<DocRecord> = {}): DocRecord {
  _counter += 1;
  const padded = String(_counter).padStart(20, "0");
  return {
    id: `01HIOERR${padded}`,
    slug: `knowledge-io-error-fixture-${_counter}`,
    type: "knowledge",
    role: "knowledge",
    title: `IO Error Fixture ${_counter}`,
    status: "draft",
    priority: "medium",
    content: "Original content",
    parent_id: null,
    extra: {},
    tags: [],
    version: 1,
    created_at: "2026-07-25T00:00:00.000Z",
    updated_at: "2026-07-25T00:00:00.000Z",
    created_by: "agent:test",
    deleted_at: null,
    ...overrides,
  };
}

function makeVersion(doc: DocRecord, overrides: Partial<VersionRecord> = {}): VersionRecord {
  return {
    doc_id: doc.id,
    version: doc.version,
    content: doc.content,
    extra: doc.extra,
    status: doc.status,
    title: doc.title,
    action: "create",
    created_at: doc.created_at,
    created_by: doc.created_by,
    ...overrides,
  };
}

function makeAudit(doc: DocRecord, overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    timestamp: doc.created_at,
    actor: "system",
    session_id: doc.id,
    action: "create",
    doc_id: doc.id,
    details: { version: doc.version },
    ...overrides,
  };
}

/**
 * Deletes a file-mode SQLite DB's backing file plus its `-wal`/`-shm`
 * sidecars while `store`'s `Database` handle is still open. On macOS/APFS
 * (and Linux/ext4 — POSIX unlink-while-open semantics) this reliably makes
 * the NEXT `BEGIN IMMEDIATE` on that handle throw `SQLiteError: disk I/O
 * error` synchronously, because WAL mode depends on the sidecar files that
 * were just removed — verified empirically before writing this test (a bare
 * in-memory DB or a still-present-file scenario does NOT reproduce this).
 */
function deleteBackingFiles(dbPath: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    unlinkSync(dbPath + suffix);
  }
}

describe("SQLiteStore — insertWithProvenance/updateWithProvenance never throw on a synchronous BEGIN IMMEDIATE I/O error", () => {
  let tmpDir: string;
  let dbPath: string;
  let store: SQLiteStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-io-error-"));
    dbPath = join(tmpDir, "lore.db");
    store = new SQLiteStore(dbPath);
  });

  afterEach(() => {
    try {
      store.close();
    } catch {
      // reason: the handle may already be broken by the deleted backing
      // files exercised in these tests — close() failing is not itself a
      // test failure, only cleanup best-effort.
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── ERROR — the core regression this file guards ───────────────────────

  it("ERROR — insertWithProvenance returns err(STORE_ERROR) instead of throwing when the backing file is deleted underneath it", async () => {
    deleteBackingFiles(dbPath);

    const doc = makeDoc();
    let thrown: unknown;
    let result: Awaited<ReturnType<SQLiteStore["insertWithProvenance"]>> | undefined;
    try {
      result = await store.insertWithProvenance(doc, makeVersion(doc), makeAudit(doc));
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeUndefined();
    expect(result).toBeDefined();
    if (result === undefined) return;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("STORE_ERROR");
  });

  it("ERROR — updateWithProvenance returns err(STORE_ERROR) instead of throwing when the backing file is deleted underneath it", async () => {
    const seedDoc = makeDoc({ title: "Pre-Delete Title" });
    const seedResult = await store.insertWithProvenance(seedDoc, makeVersion(seedDoc), makeAudit(seedDoc));
    expect(seedResult.ok).toBe(true);

    deleteBackingFiles(dbPath);

    const patch: Partial<DocRecord> = { title: "Should Never Apply", version: 2 };
    const version = makeVersion(seedDoc, { version: 2, title: "Should Never Apply", action: "update" });
    const audit = makeAudit(seedDoc, { action: "update", details: { version: 2 } });

    let thrown: unknown;
    let result: Awaited<ReturnType<SQLiteStore["updateWithProvenance"]>> | undefined;
    try {
      result = await store.updateWithProvenance(
        seedDoc.id,
        patch,
        { expected_version: 1 },
        version,
        audit,
      );
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeUndefined();
    expect(result).toBeDefined();
    if (result === undefined) return;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("STORE_ERROR");
  });

  it("ERROR — softDeleteWithProvenance returns err(STORE_ERROR) instead of throwing when the backing file is deleted underneath it", async () => {
    const seedDoc = makeDoc({ title: "Pre-Delete Soft-Delete Target" });
    const seedResult = await store.insertWithProvenance(seedDoc, makeVersion(seedDoc), makeAudit(seedDoc));
    expect(seedResult.ok).toBe(true);

    deleteBackingFiles(dbPath);

    const version = makeVersion(seedDoc, {
      version: 0,
      content: "",
      extra: {},
      status: "archived",
      title: "",
      action: "delete",
    });
    const audit = makeAudit(seedDoc, { action: "delete", details: { version: 0 } });

    let thrown: unknown;
    let result: Awaited<ReturnType<SQLiteStore["softDeleteWithProvenance"]>> | undefined;
    try {
      result = await store.softDeleteWithProvenance(seedDoc.id, version, audit);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeUndefined();
    expect(result).toBeDefined();
    if (result === undefined) return;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("STORE_ERROR");
  });

  // ── STATE — no dangling open transaction on the still-alive connection ──

  it("STATE — after the I/O error, a fresh BEGIN IMMEDIATE on the same handle does not fail with 'cannot start a transaction within a transaction'", async () => {
    // reason: the fix's split try/catch deliberately does NOT attempt a
    // ROLLBACK when BEGIN IMMEDIATE itself is what threw (there is no open
    // transaction to roll back — bun:sqlite would throw ROLLBACK's own
    // "no transaction is active" error if it tried). This proves that
    // decision doesn't leave the connection's `inTransaction` flag stuck
    // true: recreating the backing file and issuing the SAME call again
    // must fail with the ORIGINAL io-error class, not a stacked
    // transaction-state error, which would indicate the failed BEGIN
    // silently left the driver's internal state open.
    deleteBackingFiles(dbPath);

    const doc = makeDoc();
    const first = await store.insertWithProvenance(doc, makeVersion(doc), makeAudit(doc));
    expect(first.ok).toBe(false);

    const second = await store.insertWithProvenance(
      makeDoc(),
      makeVersion(makeDoc()),
      makeAudit(makeDoc()),
    );
    expect(second.ok).toBe(false);
    if (second.ok) return;
    // A stacked "cannot start a transaction within a transaction" error
    // would be a DIFFERENT wrapStoreError message than the repeated I/O
    // error — both are STORE_ERROR-coded, so assert on the message content
    // to distinguish a clean repeat failure from a wedged connection.
    expect(second.error.code).toBe("STORE_ERROR");
    if (second.error.code === "STORE_ERROR") {
      expect(second.error.message.toLowerCase()).not.toContain("within a transaction");
    }
  });

  // ── REGRESSION — the happy path is unaffected by moving BEGIN inside a guard ──

  it("REGRESSION — insertWithProvenance still succeeds and is fully observable when the backing file is intact", async () => {
    const doc = makeDoc({ title: "Still Works" });
    const result = await store.insertWithProvenance(doc, makeVersion(doc), makeAudit(doc));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.title).toBe("Still Works");

    const found = await store.find(doc.id);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value?.title).toBe("Still Works");
  });

  it("REGRESSION — softDeleteWithProvenance still succeeds when the backing file is intact", async () => {
    const doc = makeDoc({ title: "Still Deletable" });
    const seedResult = await store.insertWithProvenance(doc, makeVersion(doc), makeAudit(doc));
    expect(seedResult.ok).toBe(true);

    const version = makeVersion(doc, {
      version: 0,
      content: "",
      extra: {},
      status: "archived",
      title: "",
      action: "delete",
    });
    const audit = makeAudit(doc, { action: "delete", details: { version: 0 } });
    const result = await store.softDeleteWithProvenance(doc.id, version, audit);
    expect(result.ok).toBe(true);

    const found = await store.find(doc.id);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value?.deleted_at).not.toBeNull();
  });
});
