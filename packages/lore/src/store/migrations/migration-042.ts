/**
 * Migration 042 — `ac_exemptions.decision` and `ac_exemptions.harness_run`: an exemption keeps the DecisionRecord its
 * grant was judged with, and the run that wrote it, so the milestone re-check can select it like a version-row decision
 * (spec-decision-records-cover-code-anchor-removal-and-keep; BR-1492; resolves #481).
 * SQL is an inlined string constant so `bun build --compile` can bundle it without filesystem access.
 *
 * Public surface: {@link MIGRATION_042_ADD_COLUMNS}, {@link MIGRATION_042_SQL}.
 *
 * Invariants:
 *   - Same two-phase shape as migration-041 (SQLite has no `ADD COLUMN IF NOT EXISTS`): the calling store applies
 *     {@link MIGRATION_042_ADD_COLUMNS} only where `PRAGMA table_info` lacks the column, then runs
 *     {@link MIGRATION_042_SQL} (`PRAGMA user_version = 42` in one BEGIN/COMMIT, re-runnable). Running it twice changes nothing.
 *   - Both columns are nullable text. NULL decision = the grant carried none (every pre-042 row, every draft or human
 *     grant); NULL harness_run = the writer's run was not recorded. No backfill; neither is part of any hash chain.
 *
 * Side-effect class: schema DDL (executed once per store).
 */

/** Phase 1 — the nullable columns, applied only where missing (see module invariants). */
export const MIGRATION_042_ADD_COLUMNS: readonly { table: string; column: string; ddl: string }[] = [
  { table: "ac_exemptions", column: "decision", ddl: "ALTER TABLE ac_exemptions ADD COLUMN decision TEXT" },
  { table: "ac_exemptions", column: "harness_run", ddl: "ALTER TABLE ac_exemptions ADD COLUMN harness_run TEXT" },
];

/** Phase 2 — the version bump. */
export const MIGRATION_042_SQL = `-- Migration: 042-exemption-decision
-- Schema version: 42

BEGIN IMMEDIATE;

PRAGMA user_version = 42;

COMMIT;
`;
