/**
 * Migration 011 — `trace_events` table + its four indexes (SPEC-102 §Schema).
 * SQL is inlined as a string constant so `bun build --compile` can bundle it
 * without requiring filesystem access to `.sql` files at runtime. Never edit
 * migration-001..010 in place — this is a NEW migration, additive only.
 *
 * @invariant Pure additive `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT
 *   EXISTS` — no `ALTER` on any pre-existing table, so this needs NO
 *   `BEGIN IMMEDIATE`/`COMMIT` transaction wrapper and no catch/ROLLBACK
 *   dance in `sqlite-store.ts`'s `runMigrations()` / `turso-store.ts`'s
 *   `initSchema()` (mirrors migration-001/002/003's identical "pure additive,
 *   safe to re-run statement-by-statement even half-applied" shape — NOT
 *   migration-004/005/006/007/010's transactional pattern, which exists only
 *   because THOSE migrations widen/recreate an EXISTING table).
 * @invariant `kind`/`surface` carry NO `CHECK` constraint (SPEC-102 D2) —
 *   forward-compat for new trace kinds/surfaces without a future migration;
 *   validated at the `TraceRecorder` seam (Zod, `@lore/core`) instead.
 * @invariant `doc_id` has deliberately NO foreign key (SPEC-102 D4) — a
 *   fire-and-forget insert must never fail on referential state, and a trace
 *   of a since-deleted doc must remain readable.
 * @invariant `ts` is TEXT ISO-8601 with ms (SPEC-102 D1) — the repo-wide
 *   timestamp convention (audit/versions/review_judgments all TEXT ISO);
 *   lexicographic order equals chronological order, so `idx_trace_ts`/
 *   `idx_trace_kind_ts`'s `ts` range predicates seek correctly without a
 *   numeric column.
 * @invariant Never replicated to Turso (SPEC-102 D3) — `trace_events` is
 *   deliberately ABSENT from `adapters/http/sync-push.ts`'s
 *   `REPLICATED_TABLES` tuple; this migration is applied to BOTH the local
 *   SQLiteStore file and the TursoStore embedded-replica LOCAL file (via a
 *   separate `bun:sqlite` handle opened on the replica path, `app.ts`'s
 *   composition root) but never pushed to the remote Turso database.
 * @invariant Four indexes, each backing exactly one named stats query
 *   (SPEC-102 §Access Patterns & Indexes table): `idx_trace_kind_ts`
 *   (counts-by-kind over a window), `idx_trace_kind_actor` (deny→retry-success
 *   gap, actor-scoped), `idx_trace_doc` (never-read-docs — partial, `doc_id
 *   IS NOT NULL` since only `kind='get'` rows populate it), `idx_trace_ts`
 *   (retention-prune cutoff seek).
 *
 * @see SPEC-102 §Schema, §Acceptance Criteria AC-TRACE-1
 */

export const MIGRATION_011_SQL = `-- Migration: 011-trace-events
-- Schema version: 11

CREATE TABLE IF NOT EXISTS trace_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT NOT NULL,
  actor      TEXT NOT NULL,
  surface    TEXT NOT NULL,
  session_id TEXT NOT NULL,
  kind       TEXT NOT NULL,
  doc_id     TEXT,
  checkpoint TEXT,
  hit_count  INTEGER,
  details    TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_trace_kind_ts    ON trace_events(kind, ts DESC);
CREATE INDEX IF NOT EXISTS idx_trace_kind_actor ON trace_events(kind, actor, ts DESC);
CREATE INDEX IF NOT EXISTS idx_trace_doc        ON trace_events(doc_id) WHERE doc_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trace_ts         ON trace_events(ts);

PRAGMA user_version = 11;
`;
