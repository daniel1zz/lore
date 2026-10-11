/**
 * Migration 016 — run identity (spec-run-identity-slice-1-harness-attested-runs-attested D3/D4):
 * new `runs` table (one row per registered harness run) and the nullable `harness_run` TEXT column on
 * `audit` and `versions` (which run vouched for the write). SQL is an inlined string constant so
 * `bun build --compile` can bundle it without filesystem access (same reason as migration-013/014).
 *
 * Public surface: {@link MIGRATION_016_SQL}, {@link MIGRATION_016_ADD_COLUMNS}.
 *
 * Invariants:
 *   - Two phases, because SQLite has no `ADD COLUMN IF NOT EXISTS`:
 *       1. {@link MIGRATION_016_ADD_COLUMNS} — `{ table, column, ddl }` triples the calling store applies
 *          ONLY when `PRAGMA table_info(<table>)` lacks the column (so a crash between phases, or a retry,
 *          never throws "duplicate column name" and never bricks the corpus).
 *       2. {@link MIGRATION_016_SQL} — `runs` table + index + `PRAGMA user_version = 16` in one
 *          `BEGIN IMMEDIATE`/`COMMIT`. It is re-runnable on a migrated file with no error and no row change.
 *     Both stores run phase 1 then phase 2; `user_version` only moves once phase 2 commits.
 *   - Every pre-existing `audit`/`versions` row keeps `harness_run` NULL (no backfill): NULL means
 *     "unattested", the same reading as a write whose run was never registered.
 *   - `audit.harness_run` is deliberately NOT part of `computeAuditEntryHash`'s payload: pre-016 chains
 *     must keep verifying byte-for-byte, and the hash input is a frozen contract. It is also NOT indexed
 *     (an indexed column cannot be dropped by `ALTER TABLE .. DROP COLUMN`, which the schema-15 test
 *     fixture relies on); attributed-write counts filter on the timestamp window first.
 *   - `runs.id` is the primary key; first registration wins (`INSERT OR IGNORE` in the stores).
 *     `composition` holds the JSON-serialised CompositionRecord; `parent_run_id` is NOT a foreign key
 *     (a subagent may register before its parent's row is visible to this replica).
 *
 * Side-effect class: schema DDL (executed once per store).
 */

/** Phase 1 — nullable columns, applied only where missing (see module invariants). */
export const MIGRATION_016_ADD_COLUMNS: readonly { table: string; column: string; ddl: string }[] = [
  { table: "audit", column: "harness_run", ddl: "ALTER TABLE audit ADD COLUMN harness_run TEXT" },
  { table: "versions", column: "harness_run", ddl: "ALTER TABLE versions ADD COLUMN harness_run TEXT" },
];

/** Phase 2 — `runs` table, its index and the version bump. */
export const MIGRATION_016_SQL = `-- Migration: 016-run-identity
-- Schema version: 16

BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS runs (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK(kind IN ('main','subagent')),
  harness       TEXT NOT NULL,
  session_ref   TEXT NOT NULL,
  agent_ref     TEXT,
  agent_type    TEXT,
  parent_run_id TEXT,
  branch        TEXT,
  composition   TEXT NOT NULL,
  registered_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runs_registered_at ON runs(registered_at);

PRAGMA user_version = 16;

COMMIT;
`;
