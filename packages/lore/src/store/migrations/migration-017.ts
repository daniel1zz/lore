/**
 * Migration 017 — run end (spec-run-only-write-identity-and-run-end-claim-release D4, BR-1057/BR-1058):
 * nullable `ended_at` and `end_reason` TEXT columns on `runs`. SQL is an inlined string constant so
 * `bun build --compile` can bundle it without filesystem access (same reason as migration-013/014/016).
 *
 * Public surface: {@link MIGRATION_017_ADD_COLUMNS}, {@link MIGRATION_017_SQL}.
 *
 * Invariants:
 *   - Same two-phase shape as migration-016, because SQLite has no `ADD COLUMN IF NOT EXISTS`:
 *       1. {@link MIGRATION_017_ADD_COLUMNS} — `{ table, column, ddl }` triples the calling store applies
 *          ONLY when `PRAGMA table_info(<table>)` lacks the column (a crash between phases, or a retry,
 *          never throws "duplicate column name").
 *       2. {@link MIGRATION_017_SQL} — `PRAGMA user_version = 17` in one `BEGIN IMMEDIATE`/`COMMIT`,
 *          re-runnable on a migrated file with no error and no row change.
 *   - Every pre-existing run keeps `ended_at` NULL: NULL means "still open", never "ended long ago".
 *   - `ended_at` / `end_reason` are deliberately NOT part of `RunRecord` (a run's registered identity is
 *     frozen, BR-1029); they are read and written only through `endRun` / `reopenRun` / `getRunEnd`.
 *
 * Side-effect class: schema DDL (executed once per store).
 */

/** Phase 1 — nullable columns, applied only where missing (see module invariants). */
export const MIGRATION_017_ADD_COLUMNS: readonly { table: string; column: string; ddl: string }[] = [
  { table: "runs", column: "ended_at", ddl: "ALTER TABLE runs ADD COLUMN ended_at TEXT" },
  { table: "runs", column: "end_reason", ddl: "ALTER TABLE runs ADD COLUMN end_reason TEXT" },
];

/** Phase 2 — the version bump. */
export const MIGRATION_017_SQL = `-- Migration: 017-run-end
-- Schema version: 17

BEGIN IMMEDIATE;

PRAGMA user_version = 17;

COMMIT;
`;
