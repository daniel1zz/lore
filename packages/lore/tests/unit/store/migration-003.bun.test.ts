/** @spec_ref SPEC-034 §3 */
/**
 * Tests for migration-003 (review_judgments + calibration_records) — applies
 * cleanly on a fresh DB and on an existing pre-migration-003 DB, idempotently.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      fresh DB migrates straight to the current user_version (11, as
 *               of migration-011 — see note below) with both new tables
 *               and their indexes present
 *   NEGATIVE:   n/a — migration SQL has no invalid-input surface (no user input)
 *   BOUNDARY:   a db already at user_version 2 (pre-migration-003) is the exact
 *               boundary this migration targets (`currentVersion < 3`)
 *   ERROR:      n/a — migration failures would throw at construction time, not
 *               reach a Result channel; this suite instead proves it never throws
 *   STATE:      existing docs/rows survive the 2→3 upgrade untouched
 *   REGRESSION: reopening an already-migrated db a second time is idempotent
 *               — CREATE TABLE/INDEX IF NOT EXISTS means no throw on re-run
 *
 * NOTE: this suite asserts the CURRENT `PRAGMA user_version` a fresh SQLiteStore
 * lands on, which by construction tracks whatever the newest migration constant
 * sets it to (currently 11, migration-011 — see migrations/migration-011.ts). It
 * is not re-scoped to "exactly migration-003's effects"; it deliberately doubles
 * as the store's "opening a brand-new DB never throws and lands on the latest
 * schema version" regression oracle. Update the literal version number here
 * when a new migration ships, same as every prior migration task has.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { MIGRATION_001_SQL } from "../../../src/store/migrations/migration-001.js";
import { MIGRATION_002_SQL } from "../../../src/store/migrations/migration-002.js";
import { actedStore } from "../../live-invocation.js";

describe("migration-003 (review_judgments + calibration_records)", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lore-migration-003-"));
    dbPath = join(tempDir, "test.db");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("HAPPY: a fresh :memory: DB migrates straight to the current user_version with both new tables + indexes", () => {
    const store = actedStore(new SQLiteStore(":memory:"));
    const db = store.getDatabase();

    const { user_version: userVersion } = db.query("PRAGMA user_version").get() as {
      user_version: number;
    };
    // reason: SPEC-044 T1 added migration-005; SPEC-056 added migration-006 (docs.type
    // CHECK widening); SPEC-072 added migration-007 (versions.slug); the CJK bigram
    // shadow-column migration added migration-008; SPEC-079 G3 added migration-009
    // (audit hash chain); SPEC-084 added migration-010 (docs.ordinal); SPEC-102 added
    // migration-011 (trace_events); spec-issue-closure-loop-computed-resolution-agent-reachable
    // added migration-012 (links.link_type CHECK widened for "resolves") — a fresh
    // store now runs every migration up to the current head (12), not just through
    // migration-003/004.
    expect(userVersion).toBe(26);

    const tableNames = db
      .query("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[];
    const names = tableNames.map((t) => t.name);
    expect(names).toContain("review_judgments");
    expect(names).toContain("calibration_records");

    const indexNames = db
      .query("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all() as { name: string }[];
    const idxNames = indexNames.map((i) => i.name);
    expect(idxNames).toContain("idx_judgments_doc");
    expect(idxNames).toContain("idx_judgments_prompt");
    expect(idxNames).toContain("idx_calibration_window");
    expect(idxNames).toContain("idx_calibration_judgment");

    store.close();
  });

  it("STATE: upgrading an existing user_version=2 DB (pre-migration-003) applies migration-003 without disturbing existing docs", () => {
    // Manually construct a v2-only DB, bypassing migration-003 entirely — this
    // simulates a real database created before this migration existed.
    const rawDb = new Database(dbPath);
    rawDb.exec(MIGRATION_001_SQL);
    rawDb.exec(MIGRATION_002_SQL);

    const preUpgradeVersion = (
      rawDb.query("PRAGMA user_version").get() as { user_version: number }
    ).user_version;
    expect(preUpgradeVersion).toBe(2);

    rawDb
      .prepare(
        `INSERT INTO docs
           (id, slug, type, role, title, status, priority, content,
            parent_id, extra, tags, version, created_at, updated_at,
            created_by, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "01HPREMIG00000000000001",
        "spec-pre-migration",
        "spec",
        "spec",
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
    rawDb.close();

    // Reopening via SQLiteStore should detect currentVersion (2) < 3 and apply
    // migration-003 (then also migration-004/005, since currentVersion (2) is below
    // every later migration's threshold too) — never throw, never touch the
    // pre-existing docs row.
    const store = actedStore(new SQLiteStore(dbPath));
    const db = store.getDatabase();

    const { user_version: postUpgradeVersion } = db.query("PRAGMA user_version").get() as {
      user_version: number;
    };
    // reason: SPEC-044 T1 added migration-005; SPEC-056 added migration-006; SPEC-072
    // added migration-007; migration-008 (CJK bigram shadow columns); SPEC-079 G3 added
    // migration-009 (audit hash chain); SPEC-084 added migration-010 (docs.ordinal);
    // SPEC-102 added migration-011; spec-issue-closure-loop-computed-resolution-agent-reachable
    // added migration-012, now the head — see HAPPY test's comment above.
    expect(postUpgradeVersion).toBe(26);

    const tableNames = db
      .query("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[];
    expect(tableNames.map((t) => t.name)).toContain("review_judgments");
    expect(tableNames.map((t) => t.name)).toContain("calibration_records");

    const preservedDoc = db
      .query("SELECT * FROM docs WHERE id = ?")
      .get("01HPREMIG00000000000001") as { title: string } | null;
    expect(preservedDoc?.title).toBe("Pre-migration doc");

    store.close();
  });

  it("REGRESSION: reopening an already-migrated (latest version) file-backed DB a second time is idempotent — no throw, schema unchanged", () => {
    const firstOpen = actedStore(new SQLiteStore(dbPath));
    firstOpen.close();

    expect(() => {
      const secondOpen = actedStore(new SQLiteStore(dbPath));
      const db = secondOpen.getDatabase();
      const { user_version: userVersion } = db.query("PRAGMA user_version").get() as {
        user_version: number;
      };
      // reason: SPEC-044 T1 added migration-005; SPEC-056 added migration-006; SPEC-072
      // added migration-007; migration-008; SPEC-079 G3 added migration-009 (audit hash
      // chain); SPEC-084 added migration-010 (docs.ordinal); SPEC-102 added migration-011;
      // spec-issue-closure-loop-computed-resolution-agent-reachable added migration-012,
      // now the head — see HAPPY test's comment above.
      expect(userVersion).toBe(26);
      secondOpen.close();
    }).not.toThrow();
  });
});
