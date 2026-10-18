/** @spec_ref Blocker B3 fix — migration-001 crash-safety (IF NOT EXISTS idempotency) */
/**
 * Tests for migration-001 (initial schema) — the ATOMICITY/CRASH-SAFETY fix.
 *
 * Before this fix, `MIGRATION_001_SQL` used plain `CREATE TABLE` / `CREATE INDEX`
 * / `CREATE VIRTUAL TABLE` / `CREATE TRIGGER` statements with NO `IF NOT EXISTS`,
 * and `sqlite-store.ts`'s `runMigrations()` executed `db.exec(MIGRATION_001_SQL)`
 * with no try/catch/transaction wrapper (unlike migration-004/005). If the
 * process was killed mid-exec — e.g. after the tables were created but before
 * the trailing `PRAGMA user_version = 1` landed — `PRAGMA user_version` stayed
 * at 0, so the NEXT startup re-ran the identical unguarded SQL and threw
 * "table docs already exists", permanently bricking the corpus on first
 * `lore init`. Adding `IF NOT EXISTS` to every CREATE (and `CREATE TRIGGER IF
 * NOT EXISTS` for the three FTS5 sync triggers) makes re-running the SQL a
 * no-op for anything already present, closing the crash window.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      a fresh SQLiteStore applies migration-001 (and every later
 *               migration) cleanly, landing on the current head user_version.
 *   NEGATIVE:   n/a — migration SQL has no invalid-input surface (no user input).
 *   BOUNDARY:   re-running the exact `MIGRATION_001_SQL` constant a SECOND time
 *               on an already-migrated DB (the fix task's explicit "run twice"
 *               requirement) — must not throw, must preserve existing doc rows,
 *               must leave user_version untouched, and the FTS5 sync triggers
 *               must still be live (not silently dropped by the re-run).
 *   ERROR:      n/a for this file — a genuinely malformed half-applied state
 *               (e.g. `docs` created but `docs_fts` missing) is outside this
 *               fix's scope; `IF NOT EXISTS` guards against "already exists",
 *               not against a table missing that a later statement in the SAME
 *               string depends on. Covered instead as a STATE case below.
 *   STATE:      simulates the exact crash this fix targets — a first exec()
 *               that lands every CREATE but ends before user_version is bumped
 *               (reproduced by exec'ing the SQL and simply not trusting the
 *               PRAGMA order — since the PRAGMA is the LAST statement, any
 *               process kill before it completes leaves user_version at 0
 *               with the full schema already present) — the second exec must
 *               not throw "table docs already exists".
 *   REGRESSION: `SQLiteStore`'s own `runMigrations()` — a fresh `:memory:`
 *               store still lands on the current head user_version and basic
 *               CRUD (insert + FTS5 search) keeps working post-fix.
 */

import { describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { MIGRATION_001_SQL } from "../../../src/store/migrations/migration-001.js";

function userVersion(db: Database): number {
  return (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
}

function tableNames(db: Database): string[] {
  return (
    db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
  ).map((t) => t.name);
}

function triggerNames(db: Database): string[] {
  return (
    db.query("SELECT name FROM sqlite_master WHERE type = 'trigger'").all() as { name: string }[]
  ).map((t) => t.name);
}

function insertDoc(db: Database, id: string, slug: string, title = "Migration 001 test doc"): void {
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
    title,
    "draft",
    "medium",
    "content",
    null,
    "{}",
    "[]",
    1,
    "2026-07-13T00:00:00.000Z",
    "2026-07-13T00:00:00.000Z",
    "agent:test",
    null,
  );
}

describe("migration-001 (initial schema) — crash-safety / idempotency (Blocker B3)", () => {
  it("HAPPY: a fresh SQLiteStore applies migration-001 cleanly and lands on the current head user_version", () => {
    const store = new SQLiteStore(":memory:");
    const db = store.getDatabase();

    // reason: mirrors migration-004.bun.test.ts's own comment — a fresh store
    // now runs every migration up to the current head (12, as of
    // spec-issue-closure-loop-computed-resolution-agent-reachable's
    // "resolves" link-type CHECK widening, migration-012).
    // migration-001's own concern (idempotent CREATEs) is what BOUNDARY below
    // asserts directly; this test just confirms the happy path still lands.
    expect(userVersion(db)).toBe(21);
    expect(tableNames(db)).toEqual(
      expect.arrayContaining(["docs", "links", "versions", "audit", "docs_fts"]),
    );

    store.close();
  });

  it("BOUNDARY: re-running the exact MIGRATION_001_SQL constant a second time does not throw and preserves existing doc rows", () => {
    const rawDb = new Database(":memory:");

    rawDb.exec(MIGRATION_001_SQL); // first application
    expect(userVersion(rawDb)).toBe(1);

    insertDoc(rawDb, "01HREAPPLYDOCONE00000001", "reapply-doc-one");

    // Re-apply the EXACT SAME migration SQL a second time, bypassing the
    // `currentVersion < 1` guard entirely — this is the fix task's literal
    // "apply migration-001 twice" requirement, simulating a re-run after a
    // crash left user_version at 0 despite the schema already existing.
    expect(() => {
      rawDb.exec(MIGRATION_001_SQL);
    }).not.toThrow();

    expect(userVersion(rawDb)).toBe(1);

    const preservedDoc = rawDb
      .query("SELECT slug FROM docs WHERE id = ?")
      .get("01HREAPPLYDOCONE00000001") as { slug: string } | null;
    expect(preservedDoc?.slug).toBe("reapply-doc-one");

    // FTS5 sync triggers must still be present (CREATE TRIGGER IF NOT EXISTS
    // is a no-op on the second run, not a silent drop).
    expect(triggerNames(rawDb)).toEqual(
      expect.arrayContaining(["docs_ai", "docs_ad", "docs_au"]),
    );

    rawDb.close();
  });

  it("BOUNDARY: FTS5 search still works after MIGRATION_001_SQL has been applied twice (triggers weren't broken by the re-run)", () => {
    const rawDb = new Database(":memory:");

    rawDb.exec(MIGRATION_001_SQL);
    rawDb.exec(MIGRATION_001_SQL); // second application, before any data exists

    insertDoc(rawDb, "01HFTSCHECKDOC000000001", "fts-check-doc", "Findable Title Text");

    const hit = rawDb
      .query("SELECT rowid FROM docs_fts WHERE docs_fts MATCH 'Findable'")
      .get() as { rowid: number } | null;
    expect(hit).not.toBeNull();

    rawDb.close();
  });

  it("STATE: simulates the exact crash window this fix closes — full schema present but user_version still 0 — a re-run does not throw 'table docs already exists'", () => {
    const rawDb = new Database(":memory:");

    // First exec() lands the entire schema, including the trailing
    // `PRAGMA user_version = 1` (bun:sqlite has no way to kill a process
    // mid-exec() from within a test, so we simulate the crash's OBSERVABLE
    // effect directly: force user_version back to 0 after a full successful
    // apply, reproducing "schema present, version not yet recorded").
    rawDb.exec(MIGRATION_001_SQL);
    rawDb.exec("PRAGMA user_version = 0;");
    expect(userVersion(rawDb)).toBe(0);

    insertDoc(rawDb, "01HCRASHSIMDOC00000001", "crash-sim-doc");

    // The next startup's runMigrations() sees user_version < 1 and re-runs
    // the identical unguarded-before-this-fix SQL. Must not throw.
    expect(() => {
      rawDb.exec(MIGRATION_001_SQL);
    }).not.toThrow();

    expect(userVersion(rawDb)).toBe(1); // re-run restores the correct version

    const preservedDoc = rawDb
      .query("SELECT slug FROM docs WHERE id = ?")
      .get("01HCRASHSIMDOC00000001") as { slug: string } | null;
    expect(preservedDoc?.slug).toBe("crash-sim-doc");

    rawDb.close();
  });

  it("REGRESSION: SQLiteStore.runMigrations() still produces a fully functional store post-fix (insert + FTS5 search)", async () => {
    const store = new SQLiteStore(":memory:");

    // reason: goes through the REAL public insert() API (not raw SQL) — since
    // migration-008 added fts_title/fts_content/fts_tags shadow columns that
    // `insert()` populates but a bare `INSERT INTO docs` (missing those
    // columns) would leave defaulted to '', silently breaking FTS5 search.
    // Using the real API is both more faithful to what this REGRESSION test
    // claims ("SQLiteStore ... produces a fully functional store") and
    // immune to drifting out of sync with `docs`'s column list.
    const insertResult = await store.insert({
      id: "01HREGRESSIONDOC0000001",
      slug: "regression-doc",
      type: "spec",
      role: "spec",
      title: "Regression Findable Doc",
      status: "draft",
      priority: "medium",
      content: "content",
      parent_id: null,
      extra: {},
      tags: [],
      version: 1,
      created_at: "2026-07-13T00:00:00.000Z",
      updated_at: "2026-07-13T00:00:00.000Z",
      created_by: "agent:test",
      deleted_at: null,
    });
    expect(insertResult.ok).toBe(true);

    const searchResult = await store.search("Regression");
    expect(searchResult.ok).toBe(true);
    if (searchResult.ok) {
      expect(searchResult.value.map((h) => h.id)).toContain("01HREGRESSIONDOC0000001");
    }

    store.close();
  });
});
