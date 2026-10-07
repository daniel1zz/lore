/**
 * Migration 013 — (1) widen `docs.type` CHECK to accept `'baseline'`, and
 * (2) add the `rule_registry` table (spec-baseline-slice-1-rules-with-permanent-ids-ac-citations
 * §C2, Migration Plan phase B). SQL is inlined as a string constant so
 * `bun build --compile` can bundle it without filesystem access to `.sql`
 * files at runtime. Never edit migration-001..012 in place — this is a NEW
 * migration.
 *
 * Why the CHECK widening is here: `@lore/core` already admits the `baseline`
 * DocType, but `migration-006.ts`'s `CHECK(type IN (... 'phase'))` still
 * rejects it at the SQLite layer (measured by task [B1]: SQLITE_CONSTRAINT on
 * insert) — a capability with no production wiring until this migration lands.
 *
 * The widening uses the identical table-recreate recipe as `migration-006.ts`
 * (read its module JSDoc for the full reasoning behind each invariant below).
 * The column list is the CURRENT `docs` shape, not 006's: it additionally
 * carries `fts_title/fts_content/fts_tags` (migration-008) and `ordinal`
 * (migration-010).
 *
 * Schema objects that MUST survive the rebuild (asserted by
 * `tests/unit/store/migration-013.bun.test.ts`):
 *   - indexes: idx_docs_type, idx_docs_status, idx_docs_parent,
 *     idx_docs_created_by, idx_docs_updated (all partial `WHERE deleted_at IS NULL`),
 *     and the partial UNIQUE idx_docs_type_ordinal (`WHERE ordinal IS NOT NULL`);
 *   - triggers docs_ai / docs_au / docs_ad, in their migration-008 form
 *     (they write the `fts_*` shadow columns, NOT title/content/tags);
 *   - FTS5 external-content table `docs_fts` (content=docs, content_rowid=rowid);
 *   - foreign keys from links / versions / review_judgments / calibration_records
 *     and docs.parent_id onto docs(id).
 *
 * @invariant `rowid` is copied EXPLICITLY — `docs_fts` is an external-content
 *   FTS5 table keyed on `docs.rowid`; fresh rowids would silently desynchronise
 *   every search hit (migration-006.ts invariant).
 * @invariant `PRAGMA foreign_keys = OFF` / `ON` sit OUTSIDE `BEGIN IMMEDIATE ..
 *   COMMIT` (the pragma is a no-op inside a transaction) so `DROP TABLE docs`
 *   does not trip FK enforcement on real child rows (migration-006.ts invariant).
 *   The calling store restores `foreign_keys = ON` if the SQL throws midway.
 * @invariant `PRAGMA user_version = 13` sits INSIDE the transaction so a
 *   ROLLBACK reverts it with the DDL.
 * @invariant `DROP TABLE IF EXISTS docs_new;` is the first statement in the
 *   transaction, and `rule_registry` is `CREATE TABLE IF NOT EXISTS`, so a
 *   re-application after an aborted attempt (or against Turso, which
 *   re-runs the string idempotently) never throws "already exists".
 * @invariant `rule_registry` rows are never deleted by any store method
 *   (never-reissue guarantee, QA-1): `n` is UNIQUE and allocated as
 *   `COALESCE(MAX(n),0)+1` inside the allocating write transaction.
 *   `leaf_doc_id` is deliberately NOT a foreign key — a soft-deleted or
 *   moved-from leaf must never block or cascade onto a registry row.
 */

export const MIGRATION_013_SQL = `-- Migration: 013-baseline-doc-type-and-rule-registry
-- Schema version: 13
-- (1) Widens docs.type CHECK to accept 'baseline'; (2) creates rule_registry.
-- See migration-013.ts's module JSDoc for the invariants this depends on.

PRAGMA foreign_keys = OFF;

BEGIN IMMEDIATE;

DROP TABLE IF EXISTS docs_new;

CREATE TABLE docs_new (
  id          TEXT PRIMARY KEY,            -- ULID
  slug        TEXT NOT NULL UNIQUE,        -- human-readable alias
  type        TEXT NOT NULL CHECK(type IN ('prd','spec','adr','plan','knowledge','task','phase','baseline')),
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

-- DROP TABLE docs implicitly dropped docs_ai/docs_ad/docs_au — recreate them
-- in their migration-008 form (they index the fts_* shadow columns).
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

CREATE TABLE IF NOT EXISTS rule_registry (
  id           TEXT PRIMARY KEY,        -- 'BR-<n>'
  n            INTEGER NOT NULL UNIQUE, -- strictly increasing, never reused
  leaf_doc_id  TEXT NOT NULL,           -- current owning leaf (NOT an FK, see JSDoc)
  allocated_at TEXT NOT NULL,           -- ISO 8601
  allocated_by TEXT NOT NULL            -- actor identity
);

PRAGMA user_version = 13;

COMMIT;

-- Restore FK enforcement now that the schema change is settled (no-op inside
-- a transaction, so it must follow COMMIT — mirrors the OFF toggle above).
PRAGMA foreign_keys = ON;
`;
