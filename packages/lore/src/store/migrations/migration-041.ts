/**
 * Migration 041 — `versions.decision`: the DecisionRecord a decision-carrying write stores on the version row it creates
 * (spec-a-decision-carrying-write-records-its-decision-on-its, D1; ADR an-agent-s-decision-between-milestones-is-a-record-gates).
 * SQL is an inlined string constant so `bun build --compile` can bundle it without filesystem access.
 *
 * Public surface: {@link MIGRATION_041_ADD_COLUMNS}, {@link MIGRATION_041_SQL}.
 *
 * Invariants:
 *   - Same two-phase shape as migration-016/030 (SQLite has no `ADD COLUMN IF NOT EXISTS`): the calling store applies
 *     {@link MIGRATION_041_ADD_COLUMNS} only where `PRAGMA table_info` lacks the column, then runs
 *     {@link MIGRATION_041_SQL} (`PRAGMA user_version = 41` in one BEGIN/COMMIT, re-runnable). Running it twice changes nothing.
 *   - The column is nullable JSON text. NULL = the write carried no decision (every pre-041 row, every draft or human write).
 *     No backfill, and it is NOT part of any hash chain.
 *
 * Side-effect class: schema DDL (executed once per store).
 */

/** Phase 1 — the nullable column, applied only where missing (see module invariants). */
export const MIGRATION_041_ADD_COLUMNS: readonly { table: string; column: string; ddl: string }[] = [
  { table: "versions", column: "decision", ddl: "ALTER TABLE versions ADD COLUMN decision TEXT" },
];

/** Phase 2 — the version bump. */
export const MIGRATION_041_SQL = `-- Migration: 041-version-decision
-- Schema version: 41

BEGIN IMMEDIATE;

PRAGMA user_version = 41;

COMMIT;
`;
