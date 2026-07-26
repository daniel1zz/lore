/**
 * Migration 010 — `docs.ordinal` store-allocated display ordinal column plus
 * its partial UNIQUE index (SPEC-084 §Module Boundary "Schema"). SQL is
 * inlined as a string constant so `bun build --compile` can bundle it
 * without requiring filesystem access to `.sql` files at runtime. Never edit
 * migration-001..009 in place — this is a NEW migration, additive only.
 *
 * @invariant `ALTER TABLE docs ADD COLUMN ordinal INTEGER` — no `NOT NULL`,
 *   no `DEFAULT` — every EXISTING row reads back `NULL` for this column with
 *   zero backfill (mirrors migration-007's `versions.slug` D2 "no backfill of
 *   existing rows" precedent; SPEC-084's own one-shot `lore migrate ordinals`
 *   repair tool is the separate, deliberately-manual backfill path, not this
 *   migration). Plain `ADD COLUMN` — the SAME shape as migration-005/007's
 *   nullable-column additions, not migration-004/006's table-recreate dance
 *   (only forced by a widened CHECK constraint SQLite has no `ALTER` syntax
 *   for).
 * @invariant `CREATE UNIQUE INDEX idx_docs_type_ordinal ON docs(type, ordinal)
 *   WHERE ordinal IS NOT NULL` — a PARTIAL unique index, deliberately NOT
 *   filtered on `deleted_at` (SPEC-084 D9): a soft-deleted doc keeps its
 *   ordinal forever, so a number once handed out is NEVER reused and this
 *   index — not any application-layer uniqueness check — is the sole
 *   uniqueness authority (SPEC-084 Invariant 1). Rows whose `ordinal` is NULL
 *   (exempt kinds, e.g. `domain-overview` specs, and every non-numbered doc
 *   type) are excluded from the index entirely — arbitrarily many NULL
 *   ordinals for the same `type` coexist without violating this constraint.
 * @invariant Wrapped in `BEGIN IMMEDIATE; ... COMMIT;` (mirrors migration-007's
 *   reasoning verbatim) as defense-in-depth — the `ADD COLUMN`, the
 *   `CREATE UNIQUE INDEX`, and the trailing `PRAGMA user_version` bump are
 *   three separate DDL operations; wrapping them atomically means a crash
 *   between any two of them can never leave the corpus in a state where the
 *   column exists but the index doesn't (or vice versa) while `user_version`
 *   already reads 10 (which would skip re-applying this migration on next
 *   startup and permanently leave the corpus without its uniqueness
 *   guarantee). Both stores' migration runners mirror migration-004/005/006/
 *   007's catch/ROLLBACK wrapper for this migration too, for the identical
 *   bun:sqlite `db.exec()` "no auto-rollback on a caught mid-string throw"
 *   reason documented there.
 * @invariant Idempotent in the way that actually matters for this codebase:
 *   gated by `PRAGMA user_version` (both `sqlite-store.ts`'s `runMigrations()`
 *   and `turso-store.ts`'s `initSchema()`) exactly like every earlier
 *   migration — once `user_version` reaches 10, this SQL string is never
 *   executed again for that database file.
 */

export const MIGRATION_010_SQL = `-- Migration: 010-docs-ordinal
-- Schema version: 10

BEGIN IMMEDIATE;

ALTER TABLE docs ADD COLUMN ordinal INTEGER;

CREATE UNIQUE INDEX idx_docs_type_ordinal ON docs(type, ordinal) WHERE ordinal IS NOT NULL;

PRAGMA user_version = 10;

COMMIT;
`;
