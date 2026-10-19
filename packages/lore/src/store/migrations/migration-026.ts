/**
 * Migration 026 — `versions.action` admits `'undelete'` (spec-defect-clusters-round-2-part-a D6): `lore undelete`
 * writes a real version row (N+1) with that action. SQL is an inlined string constant so `bun build --compile`
 * can bundle it without filesystem access.
 *
 * Public surface: {@link MIGRATION_026_SQL}.
 *
 * Invariants:
 *   - SQLite cannot alter a CHECK, so `versions` is REBUILT in one BEGIN IMMEDIATE/COMMIT (the migration-023
 *     pattern): new table with the widened CHECK, `INSERT ... SELECT` of every column VERBATIM (no stored text of
 *     any row changes), drop, rename, then both indexes are recreated (`idx_versions_doc` from 001,
 *     `idx_versions_keys` from 025). Nothing references `versions`, so no foreign key needs restoring; the table's
 *     own `doc_id REFERENCES docs(id)` is declared again.
 *   - Re-runnable: a leftover `versions_new` from an interrupted run is dropped first, and the whole string is one
 *     transaction, so a failure leaves the old table untouched.
 *   - Cost: one pass over the versions table (the largest table in a long-lived corpus), once per store.
 *   - The column list is the union of 001 + 007 (`slug`) + 016 (`harness_run`); a new `versions` column added by a
 *     later migration must be added to BOTH the CREATE and the copy here only if it lands before 026.
 *
 * Side-effect class: schema DDL (executed once per store).
 */
export const MIGRATION_026_SQL = `-- Migration: 026-versions-undelete-action
-- Schema version: 26

BEGIN IMMEDIATE;

DROP TABLE IF EXISTS versions_new;

CREATE TABLE versions_new (
  doc_id      TEXT NOT NULL REFERENCES docs(id),
  version     INTEGER NOT NULL,
  content     TEXT NOT NULL,
  extra       TEXT NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL,
  title       TEXT NOT NULL,
  action      TEXT NOT NULL CHECK(action IN ('create','update','approve','reject','restore','delete','undelete')),
  created_at  TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  change_summary TEXT,
  slug        TEXT,
  harness_run TEXT,
  PRIMARY KEY (doc_id, version)
);

INSERT INTO versions_new
  (doc_id, version, content, extra, status, title, action, created_at, created_by, change_summary, slug, harness_run)
SELECT doc_id, version, content, extra, status, title, action, created_at, created_by, change_summary, slug, harness_run
FROM versions;

DROP TABLE versions;
ALTER TABLE versions_new RENAME TO versions;

CREATE INDEX IF NOT EXISTS idx_versions_doc  ON versions(doc_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_versions_keys ON versions(created_at, doc_id, version, action);

PRAGMA user_version = 26;

COMMIT;
`;
