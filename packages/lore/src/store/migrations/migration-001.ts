/**
 * Migration 001 — initial schema.
 * SQL is inlined as a string constant so bun build --compile can bundle it
 * without requiring filesystem access to .sql files at runtime.
 *
 * Source: migrations/001-initial.sql
 */

export const MIGRATION_001_SQL = `-- Migration: 001-initial
-- Schema version: 1
-- Source: SPEC-002 §7.1, §7.2, §7.3

-- ─── Tables ────────────────────────────────────────────────────────────────

-- Core document table
CREATE TABLE IF NOT EXISTS docs (
  id          TEXT PRIMARY KEY,            -- ULID
  slug        TEXT NOT NULL UNIQUE,        -- human-readable alias
  type        TEXT NOT NULL CHECK(type IN ('prd','spec','adr','plan','knowledge','task')),
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

-- Graph links between documents
CREATE TABLE IF NOT EXISTS links (
  from_id     TEXT NOT NULL REFERENCES docs(id),
  to_id       TEXT NOT NULL REFERENCES docs(id),
  link_type   TEXT NOT NULL CHECK(link_type IN ('parent','implements','informs','supersedes','relates-to','blocks')),
  created_at  TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  PRIMARY KEY (from_id, to_id, link_type)
);

-- Version history (full snapshots)
CREATE TABLE IF NOT EXISTS versions (
  doc_id      TEXT NOT NULL REFERENCES docs(id),
  version     INTEGER NOT NULL,
  content     TEXT NOT NULL,
  extra       TEXT NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL,
  title       TEXT NOT NULL,
  action      TEXT NOT NULL CHECK(action IN ('create','update','approve','reject','restore','delete')),
  created_at  TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  change_summary TEXT,
  PRIMARY KEY (doc_id, version)
);

-- Audit log (append-only)
CREATE TABLE IF NOT EXISTS audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp   TEXT NOT NULL,
  actor       TEXT NOT NULL,              -- user name or agent_id
  session_id  TEXT NOT NULL,
  action      TEXT NOT NULL,
  doc_id      TEXT,                        -- NULL for non-doc ops
  details     TEXT DEFAULT '{}'            -- JSON
);

-- Full-text search virtual table
CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
  title,
  content,
  tags,
  content=docs,
  content_rowid=rowid
);

-- ─── Indexes ───────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_docs_type       ON docs(type)       WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_docs_status     ON docs(status)     WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_docs_parent     ON docs(parent_id)  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_docs_created_by ON docs(created_by) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_docs_updated    ON docs(updated_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_links_from      ON links(from_id);
CREATE INDEX IF NOT EXISTS idx_links_to        ON links(to_id);
CREATE INDEX IF NOT EXISTS idx_links_type      ON links(link_type);

CREATE INDEX IF NOT EXISTS idx_versions_doc    ON versions(doc_id, version DESC);

CREATE INDEX IF NOT EXISTS idx_audit_doc       ON audit(doc_id)   WHERE doc_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_actor     ON audit(actor);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit(timestamp DESC);

-- ─── FTS5 Sync Triggers ────────────────────────────────────────────────────

-- Keep FTS index in sync with docs table
CREATE TRIGGER IF NOT EXISTS docs_ai AFTER INSERT ON docs BEGIN
  INSERT INTO docs_fts(rowid, title, content, tags)
  VALUES (new.rowid, new.title, new.content, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS docs_ad AFTER DELETE ON docs BEGIN
  INSERT INTO docs_fts(docs_fts, rowid, title, content, tags)
  VALUES ('delete', old.rowid, old.title, old.content, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS docs_au AFTER UPDATE ON docs BEGIN
  INSERT INTO docs_fts(docs_fts, rowid, title, content, tags)
  VALUES ('delete', old.rowid, old.title, old.content, old.tags);
  INSERT INTO docs_fts(rowid, title, content, tags)
  VALUES (new.rowid, new.title, new.content, new.tags);
END;

-- ─── Schema Version ────────────────────────────────────────────────────────

PRAGMA user_version = 1;
`;
