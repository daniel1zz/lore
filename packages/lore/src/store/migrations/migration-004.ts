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
 */

export const MIGRATION_004_SQL = `-- Migration: 004-governs-link-type
-- Schema version: 4
-- "governs": from = skill, to = artifact (P4 provenance) — see @lore/core LinkType.

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
`;
