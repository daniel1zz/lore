/**
 * Migration 025 — covering index for the audit-verify completeness join
 * (plan-audit-verify-reads-only-the-keys-it-joins-runs-off-the, D1). SQL is an inlined string constant so
 * `bun build --compile` can bundle it.
 *
 * Public surface: {@link MIGRATION_025_SQL}.
 *
 * Invariants:
 *   - `idx_versions_keys(created_at, doc_id, version, action)` holds exactly the four columns
 *     `StoreInterface.listVersionKeys` selects, in the order its `WHERE created_at >= ? ORDER BY created_at`
 *     reads them: SQLite answers the query from the index alone and never visits a versions row's `content`/`extra`
 *     pages (measured on this repo's corpus: 886 MB of payload versus a few MB of keys).
 *   - Additive: `CREATE INDEX IF NOT EXISTS` over existing rows changes no stored text, so no `entry_hash` and no
 *     pushed chain head is affected. Building it scans the versions table once.
 *
 * Side-effect class: schema DDL (executed once per store).
 */
export const MIGRATION_025_SQL = `-- Migration: 025-versions-key-covering-index
-- Schema version: 25

CREATE INDEX IF NOT EXISTS idx_versions_keys ON versions(created_at, doc_id, version, action);

PRAGMA user_version = 25;
`;
