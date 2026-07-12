/**
 * Migration 005 — `review_judgments.kind` discriminator + `superseded_candidate` JSON
 * column (SPEC-044 §Design Decisions D3, D5, D11). SQL is inlined as a string constant
 * so bun build --compile can bundle it without requiring filesystem access to .sql
 * files at runtime. Never edit migration-001..004 in place — this is a NEW migration,
 * additive only.
 *
 * @invariant `ADD COLUMN kind TEXT NOT NULL DEFAULT 'review'` backfills every EXISTING
 *   row's `kind` to `'review'` immediately — SQLite resolves a constant `DEFAULT` for
 *   already-stored rows at read time (no separate `UPDATE` statement needed, no full
 *   table rewrite). This is a plain `ALTER TABLE ... ADD COLUMN`, NOT migration-004's
 *   table-recreate dance — a widened CHECK constraint has no SQLite `ALTER` syntax and
 *   forced that migration into a multi-statement create/copy/drop/rename sequence with
 *   its own crash-window risk; adding two nullable/defaulted columns has no such need.
 * @invariant Still wrapped in `BEGIN IMMEDIATE; ... COMMIT;` (mirroring migration-004's
 *   fix) as defense-in-depth: two `ALTER TABLE` statements plus a `CREATE INDEX` plus
 *   the `PRAGMA user_version` bump are FOUR separate DDL operations — wrapping them
 *   atomically means a crash between the first `ADD COLUMN` and the version bump can
 *   never leave `kind` present but `superseded_candidate`/the index/the version bump
 *   missing. `sqlite-store.ts`'s `runMigrations()` mirrors migration-004's catch/ROLLBACK
 *   wrapper for this migration too, for the same bun:sqlite `db.exec()` reason
 *   documented there (no auto-rollback on a caught mid-string throw).
 * @invariant Idempotent in the way that actually matters for this codebase: gated by
 *   `PRAGMA user_version` (both `sqlite-store.ts`'s `runMigrations()` and
 *   `turso-store.ts`'s `initSchema()`) exactly like every earlier migration — once
 *   `user_version` reaches 5, this SQL string is never executed again for that database
 *   file. Re-applying the raw SQL text directly against an ALREADY-migrated table WOULD
 *   throw "duplicate column name" (SQLite has no `ADD COLUMN IF NOT EXISTS`), but no
 *   production or test code path bypasses the version gate to do that — this migration
 *   has no equivalent to migration-004's specific atomicity bug, so it does not need to
 *   replicate that migration's "survive a raw double-apply" test.
 */

export const MIGRATION_005_SQL = `-- Migration: 005-judgment-kind-superseded-candidate
-- Schema version: 5

BEGIN IMMEDIATE;

ALTER TABLE review_judgments ADD COLUMN kind TEXT NOT NULL DEFAULT 'review';
ALTER TABLE review_judgments ADD COLUMN superseded_candidate TEXT;

CREATE INDEX IF NOT EXISTS idx_judgments_kind ON review_judgments(doc_id, kind, created_at DESC);

PRAGMA user_version = 5;

COMMIT;
`;
