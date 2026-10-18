/**
 * Tests for migration-012 (widen `links.link_type` CHECK to accept "resolves") —
 * spec-issue-closure-loop-computed-resolution-agent-reachable §D1.
 *
 * Discovered gap (see migration-012.ts's own module JSDoc): P1 added
 * `"resolves"` to `linkTypeSchema` (@lore/core) and to `CorpusService.link()`'s
 * D1b write-time validation, but never widened the `links` table's OWN SQLite
 * CHECK constraint — every real (non-`InMemoryStore`) write of a `resolves`
 * edge failed with `CHECK constraint failed: link_type IN (...)`. This test
 * file mirrors `migration-004.bun.test.ts`'s exact six-dimension shape (same
 * "widen an existing CHECK via table recreation" atomicity/idempotency
 * concerns — migration-012 is the SAME pattern, one link type later).
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      fresh SQLiteStore lands on user_version 12, and a "resolves"
 *               link row is accepted by the widened CHECK constraint.
 *   NEGATIVE:   n/a — migration SQL has no invalid-input surface (no user input).
 *   BOUNDARY:   re-running the exact `MIGRATION_012_SQL` constant a SECOND
 *               time on an already-migrated DB — must not throw, must
 *               preserve existing link rows, must leave user_version at 12.
 *   STATE:      a stale `links_new` table left behind by an aborted earlier
 *               attempt must not block re-application — `DROP TABLE IF
 *               EXISTS links_new` clears the debris and the real `links`
 *               data is preserved.
 *   ERROR:      a `links` table that doesn't exist at all makes the migration's
 *               `INSERT INTO links_new SELECT ... FROM links` throw — no
 *               partial state survives: no stray `links_new`, and
 *               user_version left completely untouched.
 *   REGRESSION: `SQLiteStore`'s own `runMigrations()` catch/rollback wrapper
 *               (sqlite-store.ts) leaves the connection out of any dangling
 *               transaction after a failed migration-012, and a PRE-EXISTING
 *               "governs" link row (from migration-004) survives the
 *               migration-012 table recreation unchanged.
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
import { MIGRATION_012_SQL } from "../../../src/store/migrations/migration-012.js";
import { actedStore } from "../../live-invocation.js";

function userVersion(db: Database): number {
  return (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
}

function tableNames(db: Database): string[] {
  return (
    db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
  ).map((t) => t.name);
}

function insertDoc(db: Database, id: string, slug: string): void {
  db.prepare(
    `INSERT INTO docs
       (id, slug, type, role, title, status, priority, content,
        parent_id, extra, tags, version, created_at, updated_at,
        created_by, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    slug,
    "task",
    "plan",
    "Migration 012 test doc",
    "draft",
    "medium",
    "content",
    null,
    "{}",
    "[]",
    1,
    "2026-07-29T00:00:00.000Z",
    "2026-07-29T00:00:00.000Z",
    "agent:test",
    null,
  );
}

describe("migration-012 (widen links.link_type CHECK to accept 'resolves')", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lore-migration-012-"));
    dbPath = join(tempDir, "test.db");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("HAPPY: a fresh SQLiteStore lands on user_version 22 and accepts a 'resolves' link row", () => {
    const store = actedStore(new SQLiteStore(":memory:"));
    const db = store.getDatabase();

    expect(userVersion(db)).toBe(23);

    insertDoc(db, "01HRESOLVESFIX000000001", "fix-doc");
    insertDoc(db, "01HRESOLVESISSUE0000001", "issue-doc");

    expect(() => {
      db.prepare(
        `INSERT INTO links (from_id, to_id, link_type, created_at, created_by)
         VALUES (?, ?, 'resolves', ?, ?)`,
      ).run(
        "01HRESOLVESFIX000000001",
        "01HRESOLVESISSUE0000001",
        "2026-07-29T00:00:00.000Z",
        "agent:test",
      );
    }).not.toThrow();

    store.close();
  });

  it("BOUNDARY: applying MIGRATION_012_SQL a second time on an already-migrated DB does not throw and preserves link rows", () => {
    const rawDb = new Database(dbPath);
    rawDb.exec(MIGRATION_001_SQL);
    rawDb.exec(MIGRATION_002_SQL);
    rawDb.exec(MIGRATION_003_SQL);
    rawDb.exec(MIGRATION_004_SQL);
    rawDb.exec(MIGRATION_012_SQL); // first application

    expect(userVersion(rawDb)).toBe(12);

    insertDoc(rawDb, "01HREAPPLYFIX00000001", "reapply-fix-doc");
    insertDoc(rawDb, "01HREAPPLYISSUE000001", "reapply-issue-doc");
    rawDb
      .prepare(
        `INSERT INTO links (from_id, to_id, link_type, created_at, created_by)
         VALUES (?, ?, 'resolves', ?, ?)`,
      )
      .run(
        "01HREAPPLYFIX00000001",
        "01HREAPPLYISSUE000001",
        "2026-07-29T00:00:00.000Z",
        "agent:test",
      );

    // Re-apply the EXACT SAME migration SQL a second time, bypassing the
    // `currentVersion < 12` guard entirely.
    expect(() => {
      rawDb.exec(MIGRATION_012_SQL);
    }).not.toThrow();

    expect(userVersion(rawDb)).toBe(12);
    expect(tableNames(rawDb)).not.toContain("links_new");

    const preservedLink = rawDb
      .query("SELECT * FROM links WHERE from_id = ? AND link_type = 'resolves'")
      .get("01HREAPPLYFIX00000001") as { to_id: string } | null;
    expect(preservedLink?.to_id).toBe("01HREAPPLYISSUE000001");

    rawDb.close();
  });

  it("STATE: a stale links_new table left by an aborted earlier attempt does not block re-application", () => {
    const rawDb = new Database(dbPath);
    rawDb.exec(MIGRATION_001_SQL);
    rawDb.exec(MIGRATION_002_SQL);
    rawDb.exec(MIGRATION_003_SQL);
    rawDb.exec(MIGRATION_004_SQL);
    // Deliberately stop BEFORE migration-012 — simulates a pre-fix DB still
    // at user_version 4, i.e. before "resolves" was ever a valid link_type.
    expect(userVersion(rawDb)).toBe(4);

    insertDoc(rawDb, "01HSTALEFIX0000000001", "stale-fix-doc");
    insertDoc(rawDb, "01HSTALEISSUE00000001", "stale-issue-doc");
    rawDb
      .prepare(
        `INSERT INTO links (from_id, to_id, link_type, created_at, created_by)
         VALUES (?, ?, 'governs', ?, ?)`,
      )
      .run(
        "01HSTALEFIX0000000001",
        "01HSTALEISSUE00000001",
        "2026-07-29T00:00:00.000Z",
        "agent:test",
      );

    // Simulate the crash: an aborted attempt got as far as `CREATE TABLE
    // links_new` (empty, never populated) before the process died — leaving
    // debris behind while `links` itself is untouched and user_version is
    // still 4.
    rawDb.exec(
      `CREATE TABLE links_new (
         from_id     TEXT NOT NULL REFERENCES docs(id),
         to_id       TEXT NOT NULL REFERENCES docs(id),
         link_type   TEXT NOT NULL CHECK(link_type IN ('parent','implements','informs','supersedes','relates-to','blocks','governs')),
         created_at  TEXT NOT NULL,
         created_by  TEXT NOT NULL,
         PRIMARY KEY (from_id, to_id, link_type)
       );`,
    );
    expect(tableNames(rawDb)).toContain("links_new");

    // Re-running the migration-012 SQL must clear the stale table and
    // complete cleanly, without throwing "table links_new already exists".
    expect(() => {
      rawDb.exec(MIGRATION_012_SQL);
    }).not.toThrow();

    expect(userVersion(rawDb)).toBe(12);

    const preservedLink = rawDb
      .query("SELECT * FROM links WHERE from_id = ? AND link_type = 'governs'")
      .get("01HSTALEFIX0000000001") as { to_id: string } | null;
    expect(preservedLink?.to_id).toBe("01HSTALEISSUE00000001");

    // The widened CHECK constraint is live on the real (recreated) links table.
    expect(() => {
      rawDb
        .prepare(
          `INSERT INTO links (from_id, to_id, link_type, created_at, created_by)
           VALUES (?, ?, 'resolves', ?, ?)`,
        )
        .run(
          "01HSTALEFIX0000000001",
          "01HSTALEISSUE00000001",
          "2026-07-29T00:00:00.000Z",
          "agent:test",
        );
    }).not.toThrow();

    rawDb.close();
  });

  /**
   * Shared `docs`-only fixture for the ERROR tests below — deliberately does
   * NOT create `links` at all, forcing `INSERT INTO links_new SELECT ... FROM
   * links` to fail partway through the migration's statement sequence.
   */
  function createDocsOnlyDb(): Database {
    const rawDb = new Database(dbPath);
    rawDb.exec(
      `CREATE TABLE docs (
         id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, type TEXT NOT NULL,
         role TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
         priority TEXT NOT NULL DEFAULT 'medium', content TEXT NOT NULL DEFAULT '',
         parent_id TEXT REFERENCES docs(id), extra TEXT NOT NULL DEFAULT '{}',
         tags TEXT NOT NULL DEFAULT '[]', version INTEGER NOT NULL DEFAULT 1,
         created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by TEXT NOT NULL,
         deleted_at TEXT
       );`,
    );
    return rawDb;
  }

  it("ERROR: bare db.exec() of the migration SQL, with NO caller-side ROLLBACK, leaves partial state behind", () => {
    const rawDb = createDocsOnlyDb();

    expect(() => {
      rawDb.exec(MIGRATION_012_SQL);
    }).toThrow(/no such table: links/);

    // Without an explicit ROLLBACK, the connection is left mid-transaction.
    expect(rawDb.inTransaction).toBe(true);
    expect(tableNames(rawDb)).toContain("links_new");

    rawDb.exec("ROLLBACK;");
    rawDb.close();
  });

  it("ERROR: the migration + explicit ROLLBACK pattern (mirrors sqlite-store.ts's runMigrations catch block) leaves NO partial state", () => {
    const rawDb = createDocsOnlyDb();

    let caught: unknown;
    try {
      rawDb.exec(MIGRATION_012_SQL);
    } catch (error) {
      caught = error;
      rawDb.exec("ROLLBACK;");
    }

    expect(caught).toBeDefined();
    expect(rawDb.inTransaction).toBe(false);
    expect(tableNames(rawDb)).not.toContain("links_new");
    expect(tableNames(rawDb)).not.toContain("links");
    expect(userVersion(rawDb)).toBe(0);

    rawDb.close();
  });

  it("REGRESSION: SQLiteStore itself (runMigrations catch/rollback wrapper) applies migration-012 cleanly on top of a real migration-004 'governs' link, preserving it", () => {
    // Build a DB already at user_version 4 with a real "governs" link row —
    // then let SQLiteStore's OWN runMigrations() (not a hand-rolled db.exec
    // sequence) carry it the rest of the way to 12.
    const rawDb = new Database(dbPath);
    rawDb.exec(MIGRATION_001_SQL);
    rawDb.exec(MIGRATION_002_SQL);
    rawDb.exec(MIGRATION_003_SQL);
    rawDb.exec(MIGRATION_004_SQL);
    insertDoc(rawDb, "01HGOVERNSPRE00000001", "pre-governs-skill-doc");
    insertDoc(rawDb, "01HGOVERNSPRE00000002", "pre-governs-artifact-doc");
    rawDb
      .prepare(
        `INSERT INTO links (from_id, to_id, link_type, created_at, created_by)
         VALUES (?, ?, 'governs', ?, ?)`,
      )
      .run("01HGOVERNSPRE00000001", "01HGOVERNSPRE00000002", "2026-07-29T00:00:00.000Z", "agent:test");
    rawDb.close();

    const store = actedStore(new SQLiteStore(dbPath));
    const db = store.getDatabase();

    expect(userVersion(db)).toBe(23);

    const preservedGovernsLink = db
      .query("SELECT * FROM links WHERE from_id = ? AND link_type = 'governs'")
      .get("01HGOVERNSPRE00000001") as { to_id: string } | null;
    expect(preservedGovernsLink?.to_id).toBe("01HGOVERNSPRE00000002");

    // And the new "resolves" type is now live on top of that pre-existing data.
    expect(() => {
      db.prepare(
        `INSERT INTO links (from_id, to_id, link_type, created_at, created_by)
         VALUES (?, ?, 'resolves', ?, ?)`,
      ).run("01HGOVERNSPRE00000001", "01HGOVERNSPRE00000002", "2026-07-29T00:00:00.000Z", "agent:test");
    }).not.toThrow();

    store.close();
  });
});
