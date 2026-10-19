/**
 * Migration 026 (spec-defect-clusters-round-2-part-a D6) — `versions.action` admits 'undelete' through a table
 * rebuild that keeps every existing row byte-for-byte, keeps both indexes, and is idempotent on reopen.
 *
 * Dimensions: HAPPY (rebuilt table accepts 'undelete'), NEGATIVE (a schema-25 corpus refuses it; an unknown
 * action is still refused after the rebuild), BOUNDARY (upgrade from exactly 25), STATE (rows verbatim, indexes
 * recreated, user_version 26), REGRESSION (reopening a migrated corpus changes nothing).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { applyMigration026, MIGRATION_026_STEPS, MigrationFailedError } from "../../../src/store/migrations/migration-026.js";

let dir = "";
let dbPath = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lore-m026-"));
  dbPath = join(dir, "c.db");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function seed(store: SQLiteStore): void {
  const db = store.getDatabase();
  db.prepare(
    `INSERT INTO docs (id, slug, type, role, title, status, priority, content, parent_id, extra, tags, version,
       created_at, updated_at, created_by, deleted_at, fts_title, fts_content, fts_tags)
     VALUES ('D1', 'knowledge-d1', 'knowledge', 'knowledge', 'D1', 'draft', 'medium', 'c', NULL, '{}', '[]', 2,
       '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'agent:t', NULL, '', '', '')`,
  ).run();
  const ins = db.prepare(
    `INSERT INTO versions (doc_id, version, content, extra, status, title, action, created_at, created_by, change_summary, slug, harness_run)
     VALUES ('D1', ?, ?, ?, 'draft', 'D1', ?, ?, 'agent:t', ?, ?, ?)`,
  );
  ins.run(1, "c1", '{"k":1}', "create", "2026-01-01T00:00:00.000Z", null, "knowledge-d1", null);
  ins.run(2, "c2", "{}", "update", "2026-01-02T00:00:00.000Z", "summary", null, "run-1");
}

function versionRows(store: SQLiteStore): unknown[] {
  return store.getDatabase().query("SELECT * FROM versions ORDER BY version").all();
}

function insertAction(store: SQLiteStore, version: number, action: string): void {
  store
    .getDatabase()
    .prepare(
      `INSERT INTO versions (doc_id, version, content, extra, status, title, action, created_at, created_by)
       VALUES ('D1', ?, '', '{}', 'draft', 'D1', ?, '2026-02-01T00:00:00.000Z', 'agent:t')`,
    )
    .run(version, action);
}

describe("migration 026 versions.action admits 'undelete'", () => {
  it("a schema-25 corpus refuses 'undelete' (negative control)", () => {
    const old = new SQLiteStore(dbPath, { schemaCeiling: 25 });
    seed(old);
    expect(() => insertAction(old, 3, "undelete")).toThrow(/CHECK/i);
    old.close();
  });

  it("upgrade from 25 keeps every row verbatim, recreates both indexes, and accepts 'undelete'", () => {
    const old = new SQLiteStore(dbPath, { schemaCeiling: 25 });
    seed(old);
    const before = versionRows(old);
    old.close();

    const upgraded = new SQLiteStore(dbPath);
    try {
      expect(versionRows(upgraded)).toEqual(before);
      const user = (upgraded.getDatabase().query("PRAGMA user_version").get() as { user_version: number }).user_version;
      expect(user).toBe(26);
      const indexes = (upgraded.getDatabase().query("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'versions'").all() as { name: string }[]).map((r) => r.name);
      expect(indexes).toContain("idx_versions_doc");
      expect(indexes).toContain("idx_versions_keys");
      expect(() => insertAction(upgraded, 3, "undelete")).not.toThrow();
      expect(() => insertAction(upgraded, 4, "bogus")).toThrow(/CHECK/i);
    } finally {
      upgraded.close();
    }
  });

  it("a write failure mid-copy rolls everything back: schema stays 25, rows unchanged, no versions_new, and the error names step and corpus", () => {
    const old = new SQLiteStore(dbPath, { schemaCeiling: 25 });
    seed(old);
    const before = versionRows(old);
    const db = old.getDatabase();
    // The injected step runs AFTER the real copy step, so a half-built table exists when it fails (a disk-full
    // stand-in: any statement error inside the transaction).
    const failing = MIGRATION_026_STEPS.flatMap((step) =>
      step.name.startsWith("copy every")
        ? [step, { name: "injected write failure", sql: "INSERT INTO versions_new (doc_id) VALUES (NULL);" }]
        : [step],
    );
    let caught: unknown;
    try {
      applyMigration026(db, dbPath, failing);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MigrationFailedError);
    expect((caught as Error).message).toContain("injected write failure");
    expect((caught as Error).message).toContain(dbPath);
    expect((caught as Error).message).toContain("schema 25");
    expect((db.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(25);
    expect(db.query("SELECT name FROM sqlite_master WHERE name = 'versions_new'").all()).toEqual([]);
    expect(versionRows(old)).toEqual(before);
    expect(() => insertAction(old, 3, "undelete")).toThrow(/CHECK/i);
    old.close();

    const reopened = new SQLiteStore(dbPath);
    try {
      expect(versionRows(reopened)).toEqual(before);
      expect((reopened.getDatabase().query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(26);
    } finally {
      reopened.close();
    }
  });

  it("reopening a migrated corpus is a no-op (idempotent)", () => {
    const first = new SQLiteStore(dbPath);
    seed(first);
    const before = versionRows(first);
    first.close();
    const second = new SQLiteStore(dbPath);
    try {
      expect(versionRows(second)).toEqual(before);
    } finally {
      second.close();
    }
  });
});
