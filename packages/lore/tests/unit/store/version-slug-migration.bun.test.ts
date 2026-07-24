/** @spec_ref AC-072-4 */
/**
 * Tests for migration-007 (`versions.slug` nullable column, SPEC-072 §Design
 * Decisions D1/D2) — applies cleanly on a fresh DB and on an existing
 * pre-migration-007 DB, idempotently; new version inserts persist a slug
 * value through the real `SQLiteStore` (not just raw SQL).
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      fresh DB migrates straight to the current head user_version
 *               (7) with the `versions.slug` column present; a version
 *               inserted via SQLiteStore.insertVersion persists + reads back
 *               its slug
 *   NEGATIVE:   n/a — migration SQL has no invalid-input surface (no user
 *               input)
 *   BOUNDARY:   a db already at user_version 6 (pre-migration-007, real
 *               pre-existing version rows written before slug existed) is
 *               the exact boundary this migration targets
 *               (`currentVersion < 7`)
 *   ERROR:      n/a — migration failures would throw at construction time,
 *               not reach a Result channel; this suite instead proves it
 *               never throws
 *   STATE:      existing docs/version rows survive the 6→7 upgrade
 *               untouched; their `slug` reads back NULL (no backfill, D2)
 *   REGRESSION: reopening an already-migrated db a second time is idempotent
 *               — no throw, `versions.slug` unaffected by a repeat run
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { MIGRATION_001_SQL } from "../../../src/store/migrations/migration-001.js";
import { MIGRATION_002_SQL } from "../../../src/store/migrations/migration-002.js";
import { MIGRATION_003_SQL } from "../../../src/store/migrations/migration-003.js";
import { MIGRATION_004_SQL } from "../../../src/store/migrations/migration-004.js";
import { MIGRATION_005_SQL } from "../../../src/store/migrations/migration-005.js";
import { MIGRATION_006_SQL } from "../../../src/store/migrations/migration-006.js";
import type { DocRecord, VersionRecord } from "@lore/core";

function userVersion(db: Database): number {
  return (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
}

function tableColumnNames(db: Database, table: string): string[] {
  const cols = db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.map((c) => c.name);
}

function insertDocRow(db: Database, id: string, slug: string): void {
  db.prepare(
    `INSERT INTO docs
       (id, slug, type, role, title, status, priority, content,
        parent_id, extra, tags, version, created_at, updated_at,
        created_by, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    slug,
    "prd",
    "intent",
    "Pre-migration doc",
    "draft",
    "medium",
    "content",
    null,
    "{}",
    "[]",
    1,
    "2026-06-01T00:00:00.000Z",
    "2026-06-01T00:00:00.000Z",
    "agent:test",
    null,
  );
}

function makeDoc(overrides: Partial<DocRecord> = {}): DocRecord {
  return {
    id: "01HVSLUGDOC0000000000001",
    slug: "prd-slug-migration-doc",
    type: "prd",
    role: "intent",
    title: "Slug Migration Doc",
    status: "draft",
    priority: "medium",
    content: "content",
    parent_id: null,
    extra: {},
    tags: [],
    version: 1,
    created_at: "2026-07-24T00:00:00.000Z",
    updated_at: "2026-07-24T00:00:00.000Z",
    created_by: "agent:test",
    deleted_at: null,
    ...overrides,
  };
}

describe("migration-007 (versions.slug nullable column)", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lore-migration-007-"));
    dbPath = join(tempDir, "test.db");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("HAPPY: a fresh :memory: DB migrates straight to user_version 7 with versions.slug present", () => {
    const store = new SQLiteStore(":memory:");
    const db = store.getDatabase();

    expect(userVersion(db)).toBe(7);
    expect(tableColumnNames(db, "versions")).toContain("slug");

    store.close();
  });

  it("HAPPY: SQLiteStore.insertVersion persists and reads back a slug value", async () => {
    const store = new SQLiteStore(":memory:");
    const doc = makeDoc();

    const insertResult = await store.insert(doc);
    expect(insertResult.ok).toBe(true);

    const versionRecord: VersionRecord = {
      doc_id: doc.id,
      version: 1,
      content: doc.content,
      extra: doc.extra,
      status: doc.status,
      title: doc.title,
      action: "create",
      created_at: doc.created_at,
      created_by: doc.created_by,
      slug: doc.slug,
    };
    const versionResult = await store.insertVersion(versionRecord);
    expect(versionResult.ok).toBe(true);

    const found = await store.findVersions(doc.id);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value).toHaveLength(1);
    expect(found.value[0]!.slug).toBe(doc.slug);

    store.close();
  });

  it("HAPPY: a version row inserted WITHOUT a slug (legacy shape) reads back with slug simply absent, not NULL/placeholder", async () => {
    const store = new SQLiteStore(":memory:");
    const doc = makeDoc({ id: "01HVSLUGDOC0000000000002", slug: "prd-legacy-shape-doc" });

    await store.insert(doc);

    const legacyVersion: VersionRecord = {
      doc_id: doc.id,
      version: 1,
      content: doc.content,
      extra: doc.extra,
      status: doc.status,
      title: doc.title,
      action: "create",
      created_at: doc.created_at,
      created_by: doc.created_by,
    };
    expect("slug" in legacyVersion).toBe(false);

    const versionResult = await store.insertVersion(legacyVersion);
    expect(versionResult.ok).toBe(true);

    const found = await store.findVersions(doc.id);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value[0]!.slug).toBeUndefined();

    store.close();
  });

  it("BOUNDARY/STATE: upgrading an existing user_version=6 DB (pre-migration-007) applies migration-007 without disturbing existing docs or versions", () => {
    // Manually construct a v6-only DB, bypassing migration-007 entirely —
    // this simulates a real database created before this migration existed,
    // with a REAL pre-existing version row (written before slug capture).
    const rawDb = new Database(dbPath);
    rawDb.exec(MIGRATION_001_SQL);
    rawDb.exec(MIGRATION_002_SQL);
    rawDb.exec(MIGRATION_003_SQL);
    rawDb.exec(MIGRATION_004_SQL);
    rawDb.exec(MIGRATION_005_SQL);
    rawDb.exec(MIGRATION_006_SQL);

    const preUpgradeVersion = userVersion(rawDb);
    expect(preUpgradeVersion).toBe(6);
    expect(tableColumnNames(rawDb, "versions")).not.toContain("slug");

    insertDocRow(rawDb, "01HPREMIG70000000000001", "spec-pre-migration-007");
    rawDb
      .prepare(
        `INSERT INTO versions
           (doc_id, version, content, extra, status, title,
            action, created_at, created_by, change_summary)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "01HPREMIG70000000000001",
        1,
        "content",
        "{}",
        "draft",
        "Pre-migration doc",
        "create",
        "2026-06-01T00:00:00.000Z",
        "agent:test",
        null,
      );
    rawDb.close();

    // Reopening via SQLiteStore should detect currentVersion (6) < 7 and
    // apply migration-007 — never throw, never touch the pre-existing rows.
    const store = new SQLiteStore(dbPath);
    const db = store.getDatabase();

    expect(userVersion(db)).toBe(7);
    expect(tableColumnNames(db, "versions")).toContain("slug");

    const preservedDoc = db
      .query("SELECT * FROM docs WHERE id = ?")
      .get("01HPREMIG70000000000001") as { title: string } | null;
    expect(preservedDoc?.title).toBe("Pre-migration doc");

    // The pre-existing version row (written before this migration) reads
    // back with slug NULL — no backfill (D2) — and SQLiteStore's mapper
    // (rowToVersionRecord) omits the key entirely rather than surfacing NULL.
    const preservedVersionRow = db
      .query("SELECT * FROM versions WHERE doc_id = ? AND version = 1")
      .get("01HPREMIG70000000000001") as { slug: string | null } | null;
    expect(preservedVersionRow?.slug).toBeNull();

    store.close();
  });

  it("REGRESSION: reopening an already-migrated (latest version) file-backed DB a second time is idempotent — no throw, versions.slug unchanged", () => {
    const firstOpen = new SQLiteStore(dbPath);
    firstOpen.close();

    expect(() => {
      const secondOpen = new SQLiteStore(dbPath);
      const db = secondOpen.getDatabase();
      expect(userVersion(db)).toBe(7);
      expect(tableColumnNames(db, "versions")).toContain("slug");
      secondOpen.close();
    }).not.toThrow();
  });
});
