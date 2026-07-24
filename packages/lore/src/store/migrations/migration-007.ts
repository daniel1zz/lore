/**
 * Migration 007 — `versions.slug` nullable column (SPEC-072 §Design Decisions
 * D1/D2). SQL is inlined as a string constant so `bun build --compile` can
 * bundle it without requiring filesystem access to `.sql` files at runtime.
 * Never edit migration-001..006 in place — this is a NEW migration, additive
 * only.
 *
 * @invariant `ADD COLUMN slug TEXT` (no `NOT NULL`, no `DEFAULT`) — every
 *   EXISTING row reads back `NULL` for this column with zero backfill (D2's
 *   explicit "no backfill of existing rows" decision). This is a plain
 *   `ALTER TABLE ... ADD COLUMN`, the SAME shape as migration-005's two nullable
 *   columns — not migration-004/006's table-recreate dance, which was only
 *   forced by a widened CHECK constraint (SQLite has no `ALTER` syntax for
 *   that). A single nullable column addition needs no such rewrite.
 * @invariant Wrapped in `BEGIN IMMEDIATE; ... COMMIT;` (mirrors migration-005's
 *   reasoning verbatim) as defense-in-depth — the `ADD COLUMN` plus the
 *   `PRAGMA user_version` bump are two separate DDL operations; wrapping them
 *   atomically means a crash between them can never leave the column present
 *   but the version bump missing (which would re-run this migration's `ADD
 *   COLUMN` on next startup and throw "duplicate column name"). Both stores'
 *   migration runners mirror migration-004/005/006's catch/ROLLBACK wrapper
 *   for this migration too, for the identical bun:sqlite `db.exec()` "no
 *   auto-rollback on a caught mid-string throw" reason documented there.
 * @invariant Idempotent in the way that actually matters for this codebase:
 *   gated by `PRAGMA user_version` (both `sqlite-store.ts`'s `runMigrations()`
 *   and `turso-store.ts`'s `initSchema()`) exactly like every earlier
 *   migration — once `user_version` reaches 7, this SQL string is never
 *   executed again for that database file.
 */

export const MIGRATION_007_SQL = `-- Migration: 007-version-slug
-- Schema version: 7

BEGIN IMMEDIATE;

ALTER TABLE versions ADD COLUMN slug TEXT;

PRAGMA user_version = 7;

COMMIT;
`;
