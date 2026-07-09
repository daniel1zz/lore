/**
 * Migration 004 — widen links.link_type CHECK constraint to accept "governs".
 * SQL is inlined as a string constant so bun build --compile can bundle it
 * without requiring filesystem access to .sql files at runtime.
 * Never edit migration-001/002/003 in place — this is a NEW migration, additive only.
 *
 * SQLite has no `ALTER TABLE ... DROP/ADD CONSTRAINT`, so the only way to widen
 * a CHECK constraint is the documented table-recreation pattern: create a new
 * table with the desired constraint, copy every row across, drop the old table,
 * rename the new one into place, then recreate its indexes (CREATE TABLE does
 * not carry indexes with it).
 *
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
 *   recreate atomic: either every statement lands, or none do.
 * @invariant `PRAGMA user_version = 4` is intentionally placed INSIDE the
 *   transaction, immediately before `COMMIT` — verified empirically against
 *   bun:sqlite (not merely assumed) that `PRAGMA user_version` participates in
 *   the surrounding transaction exactly like a normal DDL write and is reverted
 *   by `ROLLBACK` along with everything else (see `sqlite-store.ts`'s
 *   `runMigrations` JSDoc for the reproduction). This guarantees the version
 *   bump can never land without the schema change actually having committed.
 * @invariant `DROP TABLE IF EXISTS links_new;` is the FIRST statement inside the
 *   transaction — re-running this exact SQL string a second time (whether via a
 *   stale `links_new` left behind by an OLDER, pre-fix, non-atomic build of this
 *   migration, or a deliberate re-apply) must never throw "table already
 *   exists". Because the drop lives inside the same transaction as the rest of
 *   the recreate, an aborted re-application (e.g. the source `links` table is
 *   itself already gone from an earlier legacy partial run) rolls the drop back
 *   too — it can never destroy an already-migrated `links_new` backup as a side
 *   effect of a failed retry.
 * @invariant `@libsql/client`'s embedded-replica `executeMultiple` (used by
 *   `TursoStore`, `turso-store.ts`) already wraps its `db.exec(sql)` call in a
 *   try/finally that issues an automatic `ROLLBACK` when the underlying
 *   connection is left `inTransaction` after an error (confirmed by reading the
 *   installed `@libsql/client` package's `sqlite3.js` transport source — the
 *   local/embedded-replica client TursoStore actually uses). This BEGIN/COMMIT-
 *   wrapped SQL string is therefore correctly atomic on BOTH stores without any
 *   TursoStore-side code change — do not regress that path.
 */

export const MIGRATION_004_SQL = `-- Migration: 004-governs-link-type
-- Schema version: 4
-- "governs": from = skill, to = artifact (P4 provenance) — see @lore/core LinkType.
-- Wrapped in one transaction (see migration-004.ts module JSDoc for the
-- atomicity + idempotency invariants this depends on).

BEGIN IMMEDIATE;

DROP TABLE IF EXISTS links_new;

CREATE TABLE links_new (
  from_id     TEXT NOT NULL REFERENCES docs(id),
  to_id       TEXT NOT NULL REFERENCES docs(id),
  link_type   TEXT NOT NULL CHECK(link_type IN ('parent','implements','informs','supersedes','relates-to','blocks','governs')),
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

PRAGMA user_version = 4;

COMMIT;
`;
