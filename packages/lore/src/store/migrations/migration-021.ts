/**
 * Migration 021 — `runs.harness_pid`, `runs.harness_pid_start`, `runs.worktree`: the OS process a run lives in
 * (spec-autonomy-phase-1-decision-function-human-channel-lore AC-AU-5; ADR D4). Run registration records the
 * harness pid, that process's start time (the pid-reuse defence) and the git worktree the registering command ran in;
 * `lore run reap` later proves what an ENDED run left behind and which runs died without ending.
 * SQL is an inlined string constant so `bun build --compile` can bundle it without filesystem access.
 *
 * Public surface: {@link MIGRATION_021_ADD_COLUMNS}, {@link MIGRATION_021_SQL}.
 *
 * Invariants:
 *   - Same two-phase shape as migration-017/019 (SQLite has no `ADD COLUMN IF NOT EXISTS`): the calling store
 *     applies {@link MIGRATION_021_ADD_COLUMNS} only where `PRAGMA table_info` lacks the column, then runs
 *     {@link MIGRATION_021_SQL} (`PRAGMA user_version = 21` in one BEGIN/COMMIT, re-runnable).
 *   - All three columns are nullable. NULL `harness_pid` = a LEGACY run (registered before this migration, or by a
 *     harness whose process could not be probed): its death is UNPROVABLE, never "dead".
 *   - `harness_pid` and `harness_pid_start` are written together or not at all (store.recordRunProcess).
 *
 * Side-effect class: schema DDL (executed once per store).
 */

/** Phase 1 — nullable columns, applied only where missing (see module invariants). */
export const MIGRATION_021_ADD_COLUMNS: readonly { table: string; column: string; ddl: string }[] = [
  { table: "runs", column: "harness_pid", ddl: "ALTER TABLE runs ADD COLUMN harness_pid INTEGER" },
  { table: "runs", column: "harness_pid_start", ddl: "ALTER TABLE runs ADD COLUMN harness_pid_start TEXT" },
  { table: "runs", column: "worktree", ddl: "ALTER TABLE runs ADD COLUMN worktree TEXT" },
];

/** Phase 2 — the version bump. */
export const MIGRATION_021_SQL = `-- Migration: 021-run-process
-- Schema version: 21

BEGIN IMMEDIATE;

PRAGMA user_version = 21;

COMMIT;
`;
