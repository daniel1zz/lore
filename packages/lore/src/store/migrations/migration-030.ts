/**
 * Migration 030 — `runs.message_address`: the address another session can message this run at
 * (spec-runs-carry-their-messaging-address-holder-listings-show-it AC-MA-2; BR-1360).
 * SQL is an inlined string constant so `bun build --compile` can bundle it without filesystem access.
 *
 * Public surface: {@link MIGRATION_030_ADD_COLUMNS}, {@link MIGRATION_030_SQL}.
 *
 * Invariants:
 *   - Same two-phase shape as migration-021 (SQLite has no `ADD COLUMN IF NOT EXISTS`): the calling store applies
 *     {@link MIGRATION_030_ADD_COLUMNS} only where `PRAGMA table_info` lacks the column, then runs
 *     {@link MIGRATION_030_SQL} (`PRAGMA user_version = 30` in one BEGIN/COMMIT, re-runnable).
 *   - The column is nullable. NULL = no address recorded (a run registered before this migration, one registered
 *     without a messaging socket, or a subagent run). It is written ONLY by `recordRunAddress`, on every register.
 *
 * Side-effect class: schema DDL (executed once per store).
 */

/** Phase 1 — the nullable column, applied only where missing (see module invariants). */
export const MIGRATION_030_ADD_COLUMNS: readonly { table: string; column: string; ddl: string }[] = [
  { table: "runs", column: "message_address", ddl: "ALTER TABLE runs ADD COLUMN message_address TEXT" },
];

/** Phase 2 — the version bump. */
export const MIGRATION_030_SQL = `-- Migration: 030-run-message-address
-- Schema version: 30

BEGIN IMMEDIATE;

PRAGMA user_version = 30;

COMMIT;
`;
