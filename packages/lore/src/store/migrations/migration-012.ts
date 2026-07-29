/**
 * Migration 012 — widen links.link_type CHECK constraint to accept "resolves"
 * (spec-issue-closure-loop-computed-resolution-agent-reachable §D1).
 * SQL is inlined as a string constant so bun build --compile can bundle it
 * without requiring filesystem access to .sql files at runtime.
 * Never edit migration-001..011 in place — this is a NEW migration, additive only.
 *
 * SQLite has no `ALTER TABLE ... DROP/ADD CONSTRAINT`, so the only way to widen
 * a CHECK constraint is the documented table-recreation pattern: create a new
 * table with the desired constraint, copy every row across, drop the old table,
 * rename the new one into place, then recreate its indexes (CREATE TABLE does
 * not carry indexes with it) — the EXACT same shape migration-004.ts used to
 * add "governs"; this migration repeats it verbatim for "resolves".
 *
 * @invariant Discovered empirically (2026-07-29, AC-ICL-9 e2e run against a
 *   real SQLiteStore-backed corpus): `CorpusService.link()`'s D1b write-time
 *   validation (corpus-service.ts) and `linkTypeSchema` (@lore/core) both
 *   already accepted `"resolves"` as of P1, but every REAL (non-InMemoryStore)
 *   write of a `resolves` edge failed with
 *   `CHECK constraint failed: link_type IN ('parent',...,'governs')` — P1
 *   added the Zod/service-layer acceptance but never added the corresponding
 *   schema migration widening THIS table's CHECK constraint. `InMemoryStore`
 *   has no such constraint, so every P1 unit test (which uses `InMemoryStore`
 *   exclusively) passed while the feature was fully non-functional against
 *   real SQLite. This migration is the missing piece; it does not change any
 *   application-layer code (CorpusService/schemas.ts already correctly
 *   accept "resolves" and needed no change here).
 * @invariant This whole recreate is wrapped in an explicit `BEGIN IMMEDIATE; ...
 *   COMMIT;` — bun's `db.exec()` (an alias for `db.run()`) runs a `;`-separated
 *   multi-statement string sequentially via sqlite3_exec-style execution WITHOUT
 *   any implicit transaction of its own: each DDL statement autocommits
 *   independently unless the string itself opens an explicit transaction. A
 *   crash (or thrown error) between CREATE TABLE links_new / INSERT SELECT /
 *   DROP TABLE links / RENAME under the OLD unwrapped SQL could leave the store
 *   permanently half-migrated (a stale `links_new`, or `links` missing entirely)
 *   — re-running `runMigrations()` on the next process start would then throw
 *   forever, bricking the corpus. Wrapping in one transaction makes the whole
 *   recreate atomic: either every statement lands, or none do (identical
 *   reasoning to migration-004.ts's own @invariant — see that file).
 * @invariant `PRAGMA user_version = 12` is intentionally placed INSIDE the
 *   transaction, immediately before `COMMIT` — same verified-empirically
 *   behavior migration-004.ts documents (a PRAGMA participates in the
 *   surrounding transaction and reverts on ROLLBACK like any other DDL write).
 * @invariant `DROP TABLE IF EXISTS links_new;` is the FIRST statement inside the
 *   transaction, for the identical idempotent-retry reason migration-004.ts
 *   documents — re-running this exact SQL string a second time (e.g. after an
 *   aborted first attempt) must never throw "table already exists".
 * @invariant `@libsql/client`'s embedded-replica `executeMultiple` (used by
 *   `TursoStore`) already auto-rollbacks a mid-string throw — see
 *   migration-004.ts's own @invariant for the verified reasoning; this SQL
 *   string is correctly atomic on BOTH stores without any TursoStore-side
 *   code change.
 *
 * @see spec-issue-closure-loop-computed-resolution-agent-reachable §D1, AC-ICL-1.
 */

export const MIGRATION_012_SQL = `-- Migration: 012-resolves-link-type
-- Schema version: 12
-- "resolves": from = the doc that fixes a defect (spec | plan | task), to =
-- an issue task (a task carrying extra.issue_report) — see @lore/core LinkType.
-- Wrapped in one transaction (see migration-012.ts module JSDoc for the
-- atomicity + idempotency invariants this depends on).

BEGIN IMMEDIATE;

DROP TABLE IF EXISTS links_new;

CREATE TABLE links_new (
  from_id     TEXT NOT NULL REFERENCES docs(id),
  to_id       TEXT NOT NULL REFERENCES docs(id),
  link_type   TEXT NOT NULL CHECK(link_type IN ('parent','implements','informs','supersedes','relates-to','blocks','governs','resolves')),
  created_at  TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  PRIMARY KEY (from_id, to_id, link_type)
);

INSERT INTO links_new (from_id, to_id, link_type, created_at, created_by)
  SELECT from_id, to_id, link_type, created_at, created_by FROM links;

DROP TABLE links;

ALTER TABLE links_new RENAME TO links;

CREATE INDEX idx_links_from ON links(from_id);
CREATE INDEX idx_links_to   ON links(to_id);
CREATE INDEX idx_links_type ON links(link_type);

PRAGMA user_version = 12;

COMMIT;
`;
