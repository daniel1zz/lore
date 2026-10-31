/**
 * Migration 046 — widen `docs.type` CHECK to accept `'template'` (structured documents T2,
 * spec-every-document-is-stored-as-structured-fields-validated-by).
 * SQL is an inlined string constant so `bun build --compile` can bundle it without filesystem access.
 *
 * Public surface: {@link MIGRATION_046_SQL}.
 *
 * Why: `@lore/core` admits the `template` DocType, but `migration-013.ts`'s `CHECK(type IN (... 'baseline'))` still
 * rejects it at the SQLite layer (SQLITE_CONSTRAINT on insert). SQLite cannot alter a CHECK, so the widening is the
 * same table-recreate recipe as `migration-013.ts` (read its module JSDoc for the reasoning behind each invariant).
 *
 * Invariants:
 *   - The column list is the CURRENT `docs` shape (unchanged since migration-013: no later migration adds a docs column);
 *     `rowid` is copied EXPLICITLY because `docs_fts` is an external-content FTS5 table keyed on `docs.rowid`.
 *   - Everything `DROP TABLE docs` takes with it is recreated: the five partial indexes, the partial UNIQUE
 *     `idx_docs_type_ordinal`, the FTS triggers `docs_ai/ad/au` (migration-008 form) and the rule/AC index triggers
 *     `docs_idx_*` ({@link DOCS_IDX_TRIGGERS_SQL}, the form migration-018 left them in).
 *   - `PRAGMA foreign_keys = OFF` / `ON` sit OUTSIDE the transaction (a no-op inside one), so `DROP TABLE docs` does not
 *     trip FK enforcement on child rows; the calling store restores `foreign_keys = ON` if the SQL throws midway.
 *   - `PRAGMA user_version = 46` sits INSIDE the transaction so a ROLLBACK reverts it with the DDL.
 *   - No row is changed or removed; idempotent on re-run (`DROP TABLE IF EXISTS docs_new` first).
 *
 * Side-effect class: schema migration (executed once per store).
 */

import { DOCS_IDX_TRIGGERS_SQL } from "./migration-014.js";

export const MIGRATION_046_SQL = `-- Migration: 046-template-doc-type
-- Schema version: 46
-- Widens docs.type CHECK to accept 'template'. See migration-046.ts's module JSDoc.

PRAGMA foreign_keys = OFF;

BEGIN IMMEDIATE;

DROP TABLE IF EXISTS docs_new;

CREATE TABLE docs_new (
  id          TEXT PRIMARY KEY,            -- ULID
  slug        TEXT NOT NULL UNIQUE,        -- human-readable alias
  type        TEXT NOT NULL CHECK(type IN ('prd','spec','adr','plan','knowledge','task','phase','baseline','template')),
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
  deleted_at  TEXT,                         -- NULL = active, ISO 8601 = soft-deleted
  fts_title   TEXT NOT NULL DEFAULT '',     -- migration-008 CJK shadow columns
  fts_content TEXT NOT NULL DEFAULT '',
  fts_tags    TEXT NOT NULL DEFAULT '',
  ordinal     INTEGER                       -- migration-010 display ordinal
);

INSERT INTO docs_new
  (rowid, id, slug, type, role, title, status, priority, content,
   parent_id, extra, tags, version, created_at, updated_at, created_by, deleted_at,
   fts_title, fts_content, fts_tags, ordinal)
  SELECT rowid, id, slug, type, role, title, status, priority, content,
         parent_id, extra, tags, version, created_at, updated_at, created_by, deleted_at,
         fts_title, fts_content, fts_tags, ordinal
  FROM docs;

DROP TABLE docs;

ALTER TABLE docs_new RENAME TO docs;

CREATE INDEX idx_docs_type       ON docs(type)       WHERE deleted_at IS NULL;
CREATE INDEX idx_docs_status     ON docs(status)     WHERE deleted_at IS NULL;
CREATE INDEX idx_docs_parent     ON docs(parent_id)  WHERE deleted_at IS NULL;
CREATE INDEX idx_docs_created_by ON docs(created_by) WHERE deleted_at IS NULL;
CREATE INDEX idx_docs_updated    ON docs(updated_at DESC) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_docs_type_ordinal ON docs(type, ordinal) WHERE ordinal IS NOT NULL;

CREATE TRIGGER docs_ai AFTER INSERT ON docs BEGIN
  INSERT INTO docs_fts(rowid, fts_title, fts_content, fts_tags)
  VALUES (new.rowid, new.fts_title, new.fts_content, new.fts_tags);
END;

CREATE TRIGGER docs_ad AFTER DELETE ON docs BEGIN
  INSERT INTO docs_fts(docs_fts, rowid, fts_title, fts_content, fts_tags)
  VALUES ('delete', old.rowid, old.fts_title, old.fts_content, old.fts_tags);
END;

CREATE TRIGGER docs_au AFTER UPDATE ON docs BEGIN
  INSERT INTO docs_fts(docs_fts, rowid, fts_title, fts_content, fts_tags)
  VALUES ('delete', old.rowid, old.fts_title, old.fts_content, old.fts_tags);
  INSERT INTO docs_fts(rowid, fts_title, fts_content, fts_tags)
  VALUES (new.rowid, new.fts_title, new.fts_content, new.fts_tags);
END;

${DOCS_IDX_TRIGGERS_SQL}
PRAGMA user_version = 46;

COMMIT;

-- Restore FK enforcement now that the schema change is settled (no-op inside a transaction).
PRAGMA foreign_keys = ON;
`;
