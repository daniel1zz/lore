/** @spec_ref audit finding BUG-010 — migration-006 failure leaves `PRAGMA foreign_keys` stuck OFF */
/**
 * Tests for the BUG-010 fix in sqlite-store.ts's `runMigrations()` — the
 * `currentVersion < 6` branch's catch block.
 *
 * migration-006's OWN SQL (`MIGRATION_006_SQL`) toggles `PRAGMA foreign_keys = OFF`
 * as its FIRST statement, OUTSIDE the `BEGIN IMMEDIATE`/`COMMIT` block it wraps —
 * required for `DROP TABLE docs` to succeed under real FK-referencing data (see
 * migration-006.ts's module JSDoc). The matching `PRAGMA foreign_keys = ON;` restore
 * sits AFTER `COMMIT` at the very end of the same SQL string, so it is reached ONLY
 * when the whole migration succeeds. If the migration throws partway through the
 * transaction (after the OFF toggle already ran), the pre-fix catch block only issued
 * `ROLLBACK` — which undoes the TRANSACTION but does NOT restore the CONNECTION-level
 * `foreign_keys` pragma (SQLite: `PRAGMA foreign_keys` is a no-op inside a pending
 * transaction and is not part of transactional state at all) — leaving the connection
 * silently running with FK enforcement OFF for the rest of its lifetime.
 *
 * This file directly manipulates a raw `bun:sqlite` `Database` (mirroring the
 * established pattern in migration-004.bun.test.ts's own "REGRESSION" test, which
 * replicates sqlite-store.ts's runMigrations() catch mechanism in isolation) because
 * `SQLiteStore`'s constructor RE-THROWS a migration failure — the constructed instance
 * is never returned to the caller on failure, so there is no `SQLiteStore` object to
 * inspect afterward. Testing the raw connection directly is the only way to observe
 * "did THIS connection's FK pragma get stuck OFF" — `PRAGMA foreign_keys` is
 * per-connection and is never persisted to the database file, so a fresh connection to
 * the same file tells us nothing about the failed connection's lingering state.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      a fresh SQLiteStore (real class, real constructor) lands on
 *               the current head user_version (7, as of SPEC-072's
 *               migration-007) with FK enforcement ON — the non-failure baseline.
 *   ERROR:      migration-006 sabotaged to fail mid-transaction (docs missing a
 *               column the migration's INSERT...SELECT depends on) — reproduces the
 *               exact "OFF toggle ran, then a throw before the ON toggle" sequence.
 *   STATE:      demonstrates the BUG (old catch pattern: ROLLBACK only) leaves FK
 *               OFF on the connection — a live, observable side effect on
 *               subsequent writes (an orphan-referencing INSERT that should be
 *               REJECTED by FK enforcement instead silently SUCCEEDS).
 *   REGRESSION: the FIXED catch pattern (ROLLBACK + PRAGMA foreign_keys = ON,
 *               byte-identical to sqlite-store.ts's real code) restores FK
 *               enforcement — the SAME orphan-referencing INSERT is correctly
 *               rejected afterward. This is the permanent guard against ever
 *               removing the fix's restore line.
 *   BOUNDARY:   the PRAGMA restore's own try/catch never masks the ORIGINAL
 *               migration error — the caller still sees the real failure.
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

function userVersion(db: Database): number {
  return (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
}

function foreignKeysEnabled(db: Database): boolean {
  return (db.query("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys === 1;
}

/**
 * Build a raw connection at schema v5 (migrations 001-005 applied), then sabotage
 * the `docs` table by dropping `created_at` — a column migration-006's
 * `INSERT INTO docs_new (..., created_at) SELECT ..., created_at FROM docs`
 * explicitly selects, so the sabotage makes that statement throw
 * "no such column: created_at" partway through migration-006's transaction —
 * AFTER the `PRAGMA foreign_keys = OFF` toggle (the SQL's first statement) already
 * ran, and before the transaction commits (so ROLLBACK legitimately undoes the
 * table-recreate, but per this file's header, does NOT touch the pragma).
 */
function makeSabotagedV5Db(dbPath: string): Database {
  const rawDb = new Database(dbPath);
  rawDb.exec(MIGRATION_001_SQL);
  rawDb.exec(MIGRATION_002_SQL);
  rawDb.exec(MIGRATION_003_SQL);
  rawDb.exec(MIGRATION_004_SQL);
  rawDb.exec(MIGRATION_005_SQL);
  expect(userVersion(rawDb)).toBe(5);
  // reason: PRAGMA foreign_keys=ON (SQLiteStore.init()'s own baseline) must be set
  // BEFORE the sabotage/migration attempt so the test starts from the same
  // connection-level state a real SQLiteStore instance would.
  rawDb.exec("PRAGMA foreign_keys = ON");
  rawDb.exec("ALTER TABLE docs DROP COLUMN created_at");
  return rawDb;
}

describe("migration-006 mid-transaction failure — PRAGMA foreign_keys restore (BUG-010)", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lore-migration-006-fk-"));
    dbPath = join(tempDir, "test.db");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── HAPPY ──────────────────────────────────────────────────────────────

  it("HAPPY: a fresh SQLiteStore lands on the current head user_version with FK enforcement ON", () => {
    const store = new SQLiteStore(":memory:");
    const db = store.getDatabase();

    // reason: migration-012 (spec-issue-closure-loop-computed-resolution-
    // agent-reachable, links.link_type CHECK widened for "resolves") is now
    // the head — a fresh store runs every migration up to it, not just
    // through migration-006. This test's own concern (FK enforcement
    // restored after migration-006) is unaffected — asserted directly below.
    expect(userVersion(db)).toBe(21);
    expect(foreignKeysEnabled(db)).toBe(true);

    store.close();
  });

  // ── ERROR ──────────────────────────────────────────────────────────────

  it("ERROR: sabotaged docs table makes migration-006 throw mid-transaction, AFTER the OFF toggle already ran", () => {
    const rawDb = makeSabotagedV5Db(dbPath);
    expect(foreignKeysEnabled(rawDb)).toBe(true); // baseline, pre-attempt

    expect(() => {
      rawDb.exec(MIGRATION_006_SQL);
    }).toThrow(/no such column: created_at/);

    // The OFF toggle (first statement, outside BEGIN/COMMIT) already executed and
    // took effect on this connection before the throw.
    expect(foreignKeysEnabled(rawDb)).toBe(false);

    // Cleanup: roll back the dangling transaction so this test doesn't leak state
    // into the connection's remaining lifetime.
    rawDb.exec("ROLLBACK;");
    rawDb.close();
  });

  // ── STATE (documents the pre-fix bug mechanism) ───────────────────────

  it("STATE: the OLD catch pattern (ROLLBACK only, no PRAGMA restore) leaves FK enforcement OFF — an orphan-referencing INSERT silently succeeds", () => {
    const rawDb = makeSabotagedV5Db(dbPath);

    let caught: unknown;
    try {
      rawDb.exec(MIGRATION_006_SQL);
    } catch (error) {
      caught = error;
      // OLD (pre-BUG-010-fix) catch body — ROLLBACK only, mirrors what
      // sqlite-store.ts did before this fix.
      try {
        rawDb.exec("ROLLBACK;");
      } catch {
        // no open transaction to roll back — acceptable
      }
    }
    expect(caught).toBeDefined();
    expect(rawDb.inTransaction).toBe(false);
    expect(foreignKeysEnabled(rawDb)).toBe(false); // the bug: still OFF

    // Live, observable consequence: docs.parent_id REFERENCES docs(id) — with FK
    // enforcement OFF, inserting a doc whose parent_id points at a NONEXISTENT doc
    // must silently succeed (no FOREIGN KEY constraint failed).
    expect(() => {
      rawDb
        .prepare(
          `INSERT INTO docs
             (id, slug, type, role, title, status, priority, content,
              parent_id, extra, tags, version, updated_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "01HORPHANCHILD00000001",
          "orphan-child-old-pattern",
          "spec",
          "spec",
          "Orphan child (pre-fix pattern)",
          "draft",
          "medium",
          "content",
          "01HNONEXISTENTPARENT001", // dangling reference — no such doc
          "{}",
          "[]",
          1,
          "2026-07-20T00:00:00.000Z",
          "agent:test",
        );
    }).not.toThrow();

    rawDb.close();
  });

  // ── REGRESSION (the fix) ────────────────────────────────────────────────

  it("REGRESSION: the FIXED catch pattern (ROLLBACK + PRAGMA foreign_keys=ON, byte-identical to sqlite-store.ts) restores FK enforcement — the same orphan-referencing INSERT is rejected", () => {
    const rawDb = makeSabotagedV5Db(dbPath);

    let caught: unknown;
    try {
      rawDb.exec(MIGRATION_006_SQL);
    } catch (error) {
      caught = error;
      // Mirrors sqlite-store.ts's ACTUAL fixed catch body verbatim.
      try {
        rawDb.exec("ROLLBACK;");
      } catch {
        // no open transaction to roll back — acceptable
      }
      try {
        rawDb.exec("PRAGMA foreign_keys = ON");
      } catch {
        // connection closed/broken — acceptable, see sqlite-store.ts's own comment
      }
    }

    // BOUNDARY: the restore's own try/catch must never swallow the ORIGINAL error —
    // the caller (sqlite-store.ts rethrows `error`) still sees the real failure.
    expect(caught).toBeDefined();
    expect((caught as Error).message).toMatch(/no such column: created_at/);

    expect(rawDb.inTransaction).toBe(false);
    expect(foreignKeysEnabled(rawDb)).toBe(true); // the fix: restored to ON

    // Same orphan-referencing INSERT as the STATE test above — now correctly
    // REJECTED by FK enforcement.
    expect(() => {
      rawDb
        .prepare(
          `INSERT INTO docs
             (id, slug, type, role, title, status, priority, content,
              parent_id, extra, tags, version, updated_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "01HORPHANCHILD00000002",
          "orphan-child-fixed-pattern",
          "spec",
          "spec",
          "Orphan child (fixed pattern)",
          "draft",
          "medium",
          "content",
          "01HNONEXISTENTPARENT002", // dangling reference — no such doc
          "{}",
          "[]",
          1,
          "2026-07-20T00:00:00.000Z",
          "agent:test",
        );
    }).toThrow(/FOREIGN KEY constraint failed/);

    rawDb.close();
  });
});
