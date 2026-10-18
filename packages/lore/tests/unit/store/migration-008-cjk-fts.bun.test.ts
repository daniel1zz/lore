/** @spec_ref task-fts5-cjk-search-returns-zero-hits-unicode61-tokenizes */
/**
 * Tests for migration-008 (CJK bigram shadow columns for FTS5 search) —
 * applies cleanly on a fresh DB and on an existing pre-migration-008 DB with
 * REAL pre-existing CJK-titled rows, backfilling the new shadow columns and
 * rebuilding the FTS5 index so those pre-existing rows become CJK-searchable
 * without any application-level re-write.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      fresh DB migrates straight to the current head user_version
 *               (8) with fts_title/fts_content/fts_tags present on `docs`
 *   NEGATIVE:   n/a — migration SQL has no invalid-input surface (no user
 *               input); mirrors migration-007's own test file's stance
 *   BOUNDARY:   a db already at user_version 7 (pre-migration-008, with a
 *               REAL pre-existing CJK-titled doc row written before the
 *               shadow columns existed) is the exact boundary this
 *               migration targets (`currentVersion < 8`)
 *   ERROR:      n/a — migration failures would throw at construction time,
 *               not reach a Result channel; this suite instead proves it
 *               never throws AND that FTS5's own 'integrity-check' comes
 *               back clean (the sharpest self-check SQLite offers for "is
 *               this index/content-table pair internally consistent")
 *   STATE:      the pre-existing CJK-titled doc — unsearchable by FTS5
 *               before this migration — becomes searchable by its title's
 *               bigrams AFTER migration-008 runs, with zero application
 *               code re-writing it (pure backfill + rebuild)
 *   REGRESSION: reopening an already-migrated db a second time is
 *               idempotent — no throw, no double-migration
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
import { MIGRATION_007_SQL } from "../../../src/store/migrations/migration-007.js";

function userVersion(db: Database): number {
  return (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
}

function tableColumnNames(db: Database, table: string): string[] {
  const cols = db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.map((c) => c.name);
}

function insertDocRow(
  db: Database,
  id: string,
  slug: string,
  title: string,
  content = "content",
): void {
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
    title,
    "draft",
    "medium",
    content,
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

describe("migration-008 (CJK bigram shadow columns for FTS5)", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lore-migration-008-"));
    dbPath = join(tempDir, "test.db");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("HAPPY: a fresh :memory: DB migrates straight to user_version 11 (migration-011 is now the head) with the shadow columns present", () => {
    const store = new SQLiteStore(":memory:");
    const db = store.getDatabase();

    // reason: migration-012 (spec-issue-closure-loop-computed-resolution-
    // agent-reachable, links.link_type CHECK widened for "resolves") is now
    // the head — a fresh store runs every migration up to it, not just
    // through migration-008. This test's own concern (CJK shadow columns
    // present) is unaffected — asserted directly below.
    expect(userVersion(db)).toBe(22);
    const cols = tableColumnNames(db, "docs");
    expect(cols).toContain("fts_title");
    expect(cols).toContain("fts_content");
    expect(cols).toContain("fts_tags");

    store.close();
  });

  it("BOUNDARY/STATE: upgrading an existing user_version=7 DB (pre-migration-008) with a REAL pre-existing CJK-titled row backfills shadow columns, rebuilds the index, and makes it CJK-searchable", async () => {
    // Manually construct a v7-only DB, bypassing migration-008 entirely —
    // this simulates a real database created before this migration existed,
    // with a REAL pre-existing CJK-titled row (written before shadow columns
    // or bigram indexing existed at all — the exact shape of the guyin
    // corpus this task was filed against).
    const rawDb = new Database(dbPath);
    rawDb.exec(MIGRATION_001_SQL);
    rawDb.exec(MIGRATION_002_SQL);
    rawDb.exec(MIGRATION_003_SQL);
    rawDb.exec(MIGRATION_004_SQL);
    rawDb.exec(MIGRATION_005_SQL);
    rawDb.exec(MIGRATION_006_SQL);
    rawDb.exec(MIGRATION_007_SQL);

    const preUpgradeVersion = userVersion(rawDb);
    expect(preUpgradeVersion).toBe(7);
    expect(tableColumnNames(rawDb, "docs")).not.toContain("fts_title");

    insertDocRow(
      rawDb,
      "01HPREMIG80000000000001",
      "prd-pre-migration-008",
      "量化交易策略",
    );

    // Sanity check on the OLD (pre-migration-008) schema: FTS5 MATCH on the
    // 2-char CJK substring returns ZERO rows even though the row exists —
    // this is the exact bug this migration fixes (guyin UAT finding: `lore
    // search 交易` → 0 hits while `title LIKE '%交易%'` counts real docs).
    const preMigrationHits = rawDb
      .query(
        `SELECT d.id FROM docs_fts f JOIN docs d ON d.rowid = f.rowid WHERE docs_fts MATCH '"交易"'`,
      )
      .all();
    expect(preMigrationHits.length).toBe(0);

    rawDb.close();

    // Reopening via SQLiteStore should detect currentVersion (7) < 8 and
    // apply migration-008, then migration-009 (SPEC-079 G3 audit hash chain,
    // currentVersion 8 < 9) — never throw, never touch the pre-existing
    // row's title/content, and make it CJK-searchable via the store's real
    // search() (not raw SQL) — proving the shadow columns AND the query-side
    // expansion in escapeFtsQuery both work end to end.
    const store = new SQLiteStore(dbPath);
    const db = store.getDatabase();

    expect(userVersion(db)).toBe(22);
    const cols = tableColumnNames(db, "docs");
    expect(cols).toContain("fts_title");
    expect(cols).toContain("fts_content");
    expect(cols).toContain("fts_tags");

    const preservedDoc = db
      .query("SELECT * FROM docs WHERE id = ?")
      .get("01HPREMIG80000000000001") as { title: string; content: string } | null;
    expect(preservedDoc?.title).toBe("量化交易策略");
    expect(preservedDoc?.content).toBe("content");

    // FTS5's own strictest self-check: re-tokenizes the content table
    // (fts_title/fts_content/fts_tags) and compares to the index. Would
    // throw "database disk image is malformed"-class errors if the shadow
    // columns and the index ever disagreed.
    expect(() => {
      db.exec("INSERT INTO docs_fts(docs_fts) VALUES('integrity-check')");
    }).not.toThrow();

    // The real payoff: store.search (the actual production code path) now
    // finds the pre-existing doc via its CJK title.
    const searchResult = await store.search("交易");
    expect(searchResult.ok).toBe(true);
    if (searchResult.ok) {
      expect(searchResult.value.map((h) => h.id)).toContain("01HPREMIG80000000000001");
    }

    store.close();
  });

  it("REGRESSION: reopening an already-migrated (latest version) file-backed DB a second time is idempotent — no throw, shadow columns unchanged", () => {
    const firstOpen = new SQLiteStore(dbPath);
    firstOpen.close();

    expect(() => {
      const secondOpen = new SQLiteStore(dbPath);
      const db = secondOpen.getDatabase();
      expect(userVersion(db)).toBe(22);
      expect(tableColumnNames(db, "docs")).toContain("fts_title");
      secondOpen.close();
    }).not.toThrow();
  });
});
