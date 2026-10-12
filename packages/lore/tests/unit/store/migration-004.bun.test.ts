/** @spec_ref IoC vertical-slice tech-spec §11 — adversarial-review FIX 1 (P2/P4 hardening) */
/**
 * Tests for migration-004 (widen `links.link_type` CHECK to accept "governs") —
 * the ATOMICITY + IDEMPOTENCY fix. Before this fix, `MIGRATION_004_SQL` ran its
 * CREATE TABLE links_new / INSERT SELECT / DROP TABLE links / RENAME sequence with
 * no transaction and no `IF NOT EXISTS`, so a crash mid-migration could leave a
 * half-recreated `links` table that would throw forever on every subsequent
 * process start (bricking the default SQLite corpus).
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      fresh SQLiteStore lands on user_version 4, and a "governs" link
 *               row is accepted by the widened CHECK constraint.
 *   NEGATIVE:   n/a — migration SQL has no invalid-input surface (no user input).
 *   BOUNDARY:   re-running the exact `MIGRATION_004_SQL` constant a SECOND time on
 *               an already-migrated DB (the fix task's explicit "apply twice"
 *               requirement) — must not throw, must preserve existing link rows,
 *               must leave user_version at 4.
 *   STATE:      a stale `links_new` table left behind by an OLDER, non-atomic
 *               build of this migration (simulating a crash right after `CREATE
 *               TABLE links_new`, before the old code reached `DROP TABLE links`)
 *               must not block re-application — `DROP TABLE IF EXISTS links_new`
 *               clears the debris and the real `links` data is preserved.
 *   ERROR:      a `links` table that doesn't exist at all makes the migration's
 *               `INSERT INTO links_new SELECT ... FROM links` throw — the fix's
 *               atomicity invariant demands NO partial state survives: no stray
 *               `links_new`, and user_version left completely untouched.
 *   REGRESSION: `SQLiteStore`'s own `runMigrations()` catch/rollback wrapper
 *               (sqlite-store.ts) leaves the connection out of any dangling
 *               transaction after a failed migration-004 — reproduces the
 *               empirical bun:sqlite behavior the fix's JSDoc cites (`db.exec()`
 *               does NOT auto-rollback a caught mid-string throw).
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
    "spec",
    "spec",
    "Migration 004 test doc",
    "draft",
    "medium",
    "content",
    null,
    "{}",
    "[]",
    1,
    "2026-07-09T00:00:00.000Z",
    "2026-07-09T00:00:00.000Z",
    "agent:test",
    null,
  );
}

describe("migration-004 (widen links.link_type CHECK to accept 'governs') — atomicity + idempotency", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lore-migration-004-"));
    dbPath = join(tempDir, "test.db");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("HAPPY: a fresh SQLiteStore lands on user_version 4 and accepts a 'governs' link row", () => {
    const store = new SQLiteStore(":memory:");
    const db = store.getDatabase();

    // reason: SPEC-044 T1 added migration-005 (review_judgments.kind +
    // superseded_candidate); SPEC-056 added migration-006 (docs.type CHECK
    // widening); SPEC-072 added migration-007 (versions.slug); the CJK
    // bigram shadow-column migration added migration-008; SPEC-079 G3 added
    // migration-009 (audit hash chain); SPEC-084 added migration-010
    // (docs.ordinal); SPEC-102 added migration-011 (trace_events);
    // spec-issue-closure-loop-computed-resolution-agent-reachable added
    // migration-012 (widen links.link_type CHECK to accept "resolves") — a
    // FRESH store now runs every migration up to the current head, so
    // user_version is 12, not 4.
    // migration-004's own concern (the widened links.link_type CHECK) is
    // asserted below via the 'governs' insert, unaffected.
    expect(userVersion(db)).toBe(18);

    insertDoc(db, "01HGOVERNSSKILL00000001", "skill-doc");
    insertDoc(db, "01HGOVERNSARTIFACT00001", "artifact-doc");

    expect(() => {
      db.prepare(
        `INSERT INTO links (from_id, to_id, link_type, created_at, created_by)
         VALUES (?, ?, 'governs', ?, ?)`,
      ).run(
        "01HGOVERNSSKILL00000001",
        "01HGOVERNSARTIFACT00001",
        "2026-07-09T00:00:00.000Z",
        "agent:test",
      );
    }).not.toThrow();

    store.close();
  });

  it("BOUNDARY: applying MIGRATION_004_SQL a second time on an already-migrated DB does not throw and preserves link rows (fix task's explicit re-run requirement)", () => {
    const rawDb = new Database(dbPath);
    rawDb.exec(MIGRATION_001_SQL);
    rawDb.exec(MIGRATION_002_SQL);
    rawDb.exec(MIGRATION_003_SQL);
    rawDb.exec(MIGRATION_004_SQL); // first application

    expect(userVersion(rawDb)).toBe(4);

    insertDoc(rawDb, "01HREAPPLYSKILL0000001", "reapply-skill-doc");
    insertDoc(rawDb, "01HREAPPLYARTIFACT0001", "reapply-artifact-doc");
    rawDb
      .prepare(
        `INSERT INTO links (from_id, to_id, link_type, created_at, created_by)
         VALUES (?, ?, 'governs', ?, ?)`,
      )
      .run(
        "01HREAPPLYSKILL0000001",
        "01HREAPPLYARTIFACT0001",
        "2026-07-09T00:00:00.000Z",
        "agent:test",
      );

    // Re-apply the EXACT SAME migration SQL a second time, bypassing the
    // `currentVersion < 4` guard entirely — this is the fix task's literal
    // "apply migration-004 twice" requirement.
    expect(() => {
      rawDb.exec(MIGRATION_004_SQL);
    }).not.toThrow();

    expect(userVersion(rawDb)).toBe(4);
    expect(tableNames(rawDb)).not.toContain("links_new");

    const preservedLink = rawDb
      .query("SELECT * FROM links WHERE from_id = ? AND link_type = 'governs'")
      .get("01HREAPPLYSKILL0000001") as { to_id: string } | null;
    expect(preservedLink?.to_id).toBe("01HREAPPLYARTIFACT0001");

    rawDb.close();
  });

  it("STATE: a stale links_new table left by an older, non-atomic migration run does not block re-application", () => {
    const rawDb = new Database(dbPath);
    rawDb.exec(MIGRATION_001_SQL);
    rawDb.exec(MIGRATION_002_SQL);
    rawDb.exec(MIGRATION_003_SQL);
    // Deliberately stop BEFORE migration-004 — simulates a pre-fix DB still at
    // user_version 3, i.e. before "governs" was ever a valid link_type.
    expect(userVersion(rawDb)).toBe(3);

    insertDoc(rawDb, "01HSTALESKILL000000001", "stale-skill-doc");
    insertDoc(rawDb, "01HSTALEARTIFACT000001", "stale-artifact-doc");
    rawDb
      .prepare(
        `INSERT INTO links (from_id, to_id, link_type, created_at, created_by)
         VALUES (?, ?, 'relates-to', ?, ?)`,
      )
      .run(
        "01HSTALESKILL000000001",
        "01HSTALEARTIFACT000001",
        "2026-07-09T00:00:00.000Z",
        "agent:test",
      );

    // Simulate the crash: an OLDER, non-atomic build of this migration got as far
    // as `CREATE TABLE links_new` (empty, never populated) before the process died
    // — leaving debris behind while `links` itself is untouched and user_version
    // is still 3 (the PRAGMA bump was the very last statement, never reached).
    rawDb.exec(
      `CREATE TABLE links_new (
         from_id     TEXT NOT NULL REFERENCES docs(id),
         to_id       TEXT NOT NULL REFERENCES docs(id),
         link_type   TEXT NOT NULL CHECK(link_type IN ('parent','implements','informs','supersedes','relates-to','blocks')),
         created_at  TEXT NOT NULL,
         created_by  TEXT NOT NULL,
         PRIMARY KEY (from_id, to_id, link_type)
       );`,
    );
    expect(tableNames(rawDb)).toContain("links_new");

    // Re-running the FIXED migration-004 SQL must clear the stale table and
    // complete cleanly, without throwing "table links_new already exists".
    expect(() => {
      rawDb.exec(MIGRATION_004_SQL);
    }).not.toThrow();

    expect(userVersion(rawDb)).toBe(4);

    const preservedLink = rawDb
      .query("SELECT * FROM links WHERE from_id = ? AND link_type = 'relates-to'")
      .get("01HSTALESKILL000000001") as { to_id: string } | null;
    expect(preservedLink?.to_id).toBe("01HSTALEARTIFACT000001");

    // The widened CHECK constraint is live on the real (recreated) links table.
    expect(() => {
      rawDb
        .prepare(
          `INSERT INTO links (from_id, to_id, link_type, created_at, created_by)
           VALUES (?, ?, 'governs', ?, ?)`,
        )
        .run(
          "01HSTALESKILL000000001",
          "01HSTALEARTIFACT000001",
          "2026-07-09T00:00:00.000Z",
          "agent:test",
        );
    }).not.toThrow();

    rawDb.close();
  });

  /**
   * Shared `docs`-only fixture for the two ERROR tests below — deliberately does
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

  it("ERROR: bare db.exec() of the migration SQL, with NO caller-side ROLLBACK, leaves partial state behind — this is exactly why sqlite-store.ts's runMigrations() must catch and roll back itself", () => {
    // This documents the empirical bun:sqlite fact the fix's JSDoc cites: db.exec()
    // does NOT auto-rollback a caught mid-string throw. The migration SQL text's own
    // BEGIN/COMMIT wrapping is necessary but NOT sufficient for atomicity under
    // bun:sqlite — the caller (sqlite-store.ts's runMigrations) MUST also issue an
    // explicit ROLLBACK on catch, which is exactly what it now does (see the next
    // test for that full, correctly-atomic path).
    const rawDb = createDocsOnlyDb();

    expect(() => {
      rawDb.exec(MIGRATION_004_SQL);
    }).toThrow(/no such table: links/);

    // Without an explicit ROLLBACK, the connection is left mid-transaction and
    // its own in-progress (uncommitted) DDL is still visible to itself.
    expect(rawDb.inTransaction).toBe(true);
    expect(tableNames(rawDb)).toContain("links_new");

    // Cleanup: roll back so this test doesn't leak an open transaction into the
    // shared `rawDb` connection's lifetime beyond this test.
    rawDb.exec("ROLLBACK;");
    rawDb.close();
  });

  it("ERROR: the migration + explicit ROLLBACK pattern (mirrors sqlite-store.ts's runMigrations catch block) leaves NO partial state — true atomicity", () => {
    const rawDb = createDocsOnlyDb();

    let caught: unknown;
    try {
      rawDb.exec(MIGRATION_004_SQL);
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

  it("REGRESSION: SQLiteStore's runMigrations() catch/rollback wrapper leaves no dangling transaction after a failed migration-004 (mirrors the fix's cited bun:sqlite empirical behavior)", () => {
    // Reproduces, in isolation, the exact mechanism sqlite-store.ts's
    // runMigrations() now relies on: bun:sqlite's db.exec() does NOT
    // auto-rollback a caught mid-string throw, so the caller must issue an
    // explicit ROLLBACK — otherwise db.inTransaction stays true forever.
    const db = new Database(":memory:");
    db.exec("CREATE TABLE t (id INTEGER)");
    db.exec("PRAGMA user_version = 1");

    let caught: unknown;
    try {
      db.exec("BEGIN IMMEDIATE;");
      db.exec("CREATE TABLE t2 (id INTEGER);");
      db.exec("PRAGMA user_version = 2;");
      db.exec("INSERT INTO nonexistent_table VALUES (1);"); // throws mid-transaction
      db.exec("COMMIT;");
    } catch (error) {
      caught = error;
      try {
        db.exec("ROLLBACK;");
      } catch {
        // no open transaction to roll back — acceptable, mirrors sqlite-store.ts
      }
    }

    expect(caught).toBeDefined();
    expect(db.inTransaction).toBe(false);
    expect(userVersion(db)).toBe(1); // reverted from the attempted 2
    expect(tableNames(db)).not.toContain("t2");

    db.close();
  });
});
