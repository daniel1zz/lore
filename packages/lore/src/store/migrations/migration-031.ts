/**
 * Migration 031 — `trace_read_counts`: one `(day, count)` row per UTC day replaces one `trace_events` row per
 * `lore get` (spec-lean-governance-batch-verbs-judgment-only-at-milestones Part B, AC-LG-9; BR-1373).
 * SQL is an inlined string constant so `bun build --compile` can bundle it without filesystem access.
 *
 * Public surface: {@link MIGRATION_031_SQL}.
 *
 * Invariants:
 *   - `day` is the PRIMARY KEY: the counter is written by ONE atomic upsert
 *     (`INSERT ... ON CONFLICT(day) DO UPDATE SET count = count + 1`), so concurrent readers lose nothing.
 *   - Every pre-existing `kind = 'get'` trace row is deleted (measured: 132,067 rows in a 2.5 GB corpus with no
 *     reader). Non-read kinds (search, feed, context_bundle, gate_deny) are kept untouched.
 *   - `idx_trace_doc` is dropped: only `get` rows populated `doc_id`, and no query reads it any more.
 *   - Re-runnable: `CREATE ... IF NOT EXISTS`, `DELETE ... WHERE`, `DROP INDEX IF EXISTS`, all inside one
 *     BEGIN/COMMIT together with `PRAGMA user_version = 31`.
 *
 * Side-effect class: schema DDL + one bounded data delete (executed once per store).
 */

export const MIGRATION_031_SQL = `-- Migration: 031-trace-read-counts
-- Schema version: 31

BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS trace_read_counts (
  day   TEXT PRIMARY KEY,
  count INTEGER NOT NULL
);

DELETE FROM trace_events WHERE kind = 'get';

DROP INDEX IF EXISTS idx_trace_doc;

PRAGMA user_version = 31;

COMMIT;
`;
