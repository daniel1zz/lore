/**
 * Migration 019 — `review_judgments.truncated` + `review_judgments.truncation` (F1, spec
 * close-the-eight-verified-critical-defects; BR-268 "the stored judgment is marked as cut"). Before this,
 * `ReviewJudgment.truncated` (SPEC-040 D8) existed only on the in-memory object: every SQLite/Turso
 * round-trip silently dropped it. SQL is an inlined string constant so `bun build --compile` can bundle it
 * without filesystem access (same reason as migration-016/017).
 *
 * Public surface: {@link MIGRATION_019_ADD_COLUMNS}, {@link MIGRATION_019_SQL}.
 *
 * Invariants:
 *   - Same two-phase shape as migration-017 (SQLite has no `ADD COLUMN IF NOT EXISTS`): the calling store
 *     applies {@link MIGRATION_019_ADD_COLUMNS} only where `PRAGMA table_info` lacks the column, then runs
 *     {@link MIGRATION_019_SQL} (`PRAGMA user_version = 19` in one BEGIN/COMMIT, re-runnable).
 *   - `truncated` is nullable INTEGER (1 = doc body was cut; NULL = not cut / pre-019 row — never a stored 0).
 *     `truncation` is nullable JSON TEXT (`[{section, shown_chars, total_chars}]`; NULL = nothing cut).
 *     Every pre-existing row keeps both NULL, which reads back as "key absent".
 *
 * Side-effect class: schema DDL (executed once per store).
 */

/** Phase 1 — nullable columns, applied only where missing (see module invariants). */
export const MIGRATION_019_ADD_COLUMNS: readonly { table: string; column: string; ddl: string }[] = [
  { table: "review_judgments", column: "truncated", ddl: "ALTER TABLE review_judgments ADD COLUMN truncated INTEGER" },
  { table: "review_judgments", column: "truncation", ddl: "ALTER TABLE review_judgments ADD COLUMN truncation TEXT" },
];

/** Phase 2 — the version bump. */
export const MIGRATION_019_SQL = `-- Migration: 019-judgment-truncation
-- Schema version: 19

BEGIN IMMEDIATE;

PRAGMA user_version = 19;

COMMIT;
`;
