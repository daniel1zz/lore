/**
 * Migration 006 — widen `docs.type` CHECK constraint to accept `'phase'`
 * (SPEC-056 §Design Decisions D1, D6a). SQL is inlined as a string constant so
 * `bun build --compile` can bundle it without requiring filesystem access to
 * `.sql` files at runtime. Never edit migration-001..005 in place — this is a
 * NEW migration, additive only.
 *
 * `PhaseMigrationService` writes raw `type: "phase"` doc rows via
 * `StoreInterface.insert` (D6a's documented "raw store.insert bounded
 * bypass" — the same MigrationService precedent every prior one-shot
 * migration uses). Without this migration, that INSERT is rejected at the
 * SQLite layer by `migration-001.ts`'s original
 * `CHECK(type IN ('prd','spec','adr','plan','knowledge','task'))` — a
 * defect surfaced by authoring `phase-migration.bun.test.ts` (T9, this
 * migration's paired RED suite).
 *
 * SQLite has no `ALTER TABLE ... DROP/ADD CONSTRAINT`, so the only way to
 * widen a CHECK constraint is the documented table-recreation pattern
 * (mirrors `migration-004.ts`'s `links` table widening): create a new table
 * with the desired constraint, copy every row across (preserving `rowid` —
 * see the invariant below), drop the old table, rename the new one into
 * place, then recreate its indexes AND triggers (`CREATE TABLE` carries
 * neither across a rename/recreate).
 *
 * @invariant `rowid` is copied EXPLICITLY (`INSERT INTO docs_new (rowid, ...)
 *   SELECT rowid, ... FROM docs`), not left to auto-assignment. `docs_fts`
 *   (migration-001.ts) is an FTS5 EXTERNAL CONTENT table
 *   (`content=docs, content_rowid=rowid`) — its shadow index maps indexed
 *   terms to `docs.rowid` values. An unqualified `INSERT ... SELECT` (no
 *   explicit `rowid` column) would let SQLite assign FRESH sequential
 *   rowids to `docs_new`, permanently desynchronizing every existing FTS5
 *   entry from the row it used to point at (search would return the WRONG
 *   doc's snippet, or none at all) — this migration would otherwise "work"
 *   (no exception) while quietly corrupting full-text search corpus-wide.
 *   `docs_fts` itself needs no DROP/CREATE here — its configuration binds to
 *   the table NAME `"docs"` (restored by the trailing `RENAME TO docs`), not
 *   to any of the pre-recreate row identities.
 * @invariant `DROP TABLE docs` is empirically SAFE under
 *   `PRAGMA foreign_keys = ON` even though `links.from_id`/`links.to_id`,
 *   `versions.doc_id`, `review_judgments.doc_id`,
 *   `calibration_records.doc_id`, and `docs.parent_id` itself all declare
 *   `REFERENCES docs(id)` — verified empirically against bun:sqlite (not
 *   merely assumed): `DROP TABLE` does not perform SQLite's parent-row
 *   FK-child-existence check (that check only fires on `DELETE`/`UPDATE` of
 *   individual parent rows, never on dropping the whole table). The
 *   immediately following `CREATE TABLE docs_new` + copy + rename restores
 *   the identical table name and PK column before any other statement can
 *   observe the gap — and the whole sequence is one transaction (see next
 *   invariant), so no other connection ever sees `docs` absent.
 * @invariant Wrapped in one `BEGIN IMMEDIATE; ... COMMIT;` (mirrors
 *   `migration-004.ts`'s reasoning verbatim) — `sqlite-store.ts`'s
 *   `runMigrations()` / `turso-store.ts`'s `initSchema()` both wrap this
 *   migration's `db.exec()`/`executeMultiple()` call in the SAME
 *   catch+`ROLLBACK`+rethrow pattern migration-004/005 use, for the
 *   identical bun:sqlite "no auto-rollback on a caught mid-string throw"
 *   reason documented on `sqlite-store.ts`'s `runMigrations` JSDoc.
 * @invariant `DROP TABLE IF EXISTS docs_new;` is the FIRST statement inside
 *   the transaction (migration-004 precedent) — a re-application after an
 *   earlier partial/rolled-back attempt never throws "table already
 *   exists".
 */

export const MIGRATION_006_SQL = `-- Migration: 006-phase-doc-type
-- Schema version: 6
-- Widens docs.type CHECK to accept 'phase' (SPEC-056 D1, D6a). See
-- migration-006.ts's module JSDoc for the rowid-preservation + FK-drop
-- safety invariants this depends on.

BEGIN IMMEDIATE;

DROP TABLE IF EXISTS docs_new;

CREATE TABLE docs_new (
  id          TEXT PRIMARY KEY,            -- ULID
  slug        TEXT NOT NULL UNIQUE,        -- human-readable alias
  type        TEXT NOT NULL CHECK(type IN ('prd','spec','adr','plan','knowledge','task','phase')),
  role        TEXT NOT NULL CHECK(role IN ('intent','spec','decision','plan','knowledge')),
  title       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft'
                CHECK(status IN ('draft','in-review','approved','active','archived','deprecated')),
  priority    TEXT NOT NULL DEFAULT 'medium'
                CHECK(priority IN ('critical','high','medium','low')),
  content     TEXT NOT NULL DEFAULT '',     -- Markdown/MDX body
  parent_id   TEXT REFERENCES docs(id),    -- Tree parent (nullable for roots)
  extra       TEXT NOT NULL DEFAULT '{}',  -- JSON: type-specific fields
  tags        TEXT NOT NULL DEFAULT '[]',  -- JSON array of strings
  version     INTEGER NOT NULL DEFAULT 1,  -- Current version counter
  created_at  TEXT NOT NULL,               -- ISO 8601
  updated_at  TEXT NOT NULL,               -- ISO 8601
  created_by  TEXT NOT NULL,               -- User identity
  deleted_at  TEXT                          -- NULL = active, ISO 8601 = soft-deleted
);

INSERT INTO docs_new
  (rowid, id, slug, type, role, title, status, priority, content,
   parent_id, extra, tags, version, created_at, updated_at, created_by, deleted_at)
  SELECT rowid, id, slug, type, role, title, status, priority, content,
         parent_id, extra, tags, version, created_at, updated_at, created_by, deleted_at
  FROM docs;

DROP TABLE docs;

ALTER TABLE docs_new RENAME TO docs;

CREATE INDEX idx_docs_type       ON docs(type)       WHERE deleted_at IS NULL;
CREATE INDEX idx_docs_status     ON docs(status)     WHERE deleted_at IS NULL;
CREATE INDEX idx_docs_parent     ON docs(parent_id)  WHERE deleted_at IS NULL;
CREATE INDEX idx_docs_created_by ON docs(created_by) WHERE deleted_at IS NULL;
CREATE INDEX idx_docs_updated    ON docs(updated_at DESC) WHERE deleted_at IS NULL;

-- DROP TABLE docs (above) implicitly dropped every trigger defined ON docs
-- (docs_ai/docs_ad/docs_au from migration-001.ts) — recreate them verbatim.
CREATE TRIGGER docs_ai AFTER INSERT ON docs BEGIN
  INSERT INTO docs_fts(rowid, title, content, tags)
  VALUES (new.rowid, new.title, new.content, new.tags);
END;

CREATE TRIGGER docs_ad AFTER DELETE ON docs BEGIN
  INSERT INTO docs_fts(docs_fts, rowid, title, content, tags)
  VALUES ('delete', old.rowid, old.title, old.content, old.tags);
END;

CREATE TRIGGER docs_au AFTER UPDATE ON docs BEGIN
  INSERT INTO docs_fts(docs_fts, rowid, title, content, tags)
  VALUES ('delete', old.rowid, old.title, old.content, old.tags);
  INSERT INTO docs_fts(rowid, title, content, tags)
  VALUES (new.rowid, new.title, new.content, new.tags);
END;

PRAGMA user_version = 6;

COMMIT;
`;
