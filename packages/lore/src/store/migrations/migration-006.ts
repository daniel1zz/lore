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
 * @invariant `DROP TABLE docs` requires `PRAGMA foreign_keys = OFF` around the
 *   ENTIRE migration (both the toggle-off and toggle-on sit OUTSIDE the
 *   `BEGIN IMMEDIATE ... COMMIT` block — SQLite silently no-ops a
 *   `foreign_keys` pragma toggle attempted INSIDE a pending transaction, per
 *   sqlite.org/pragma.html#pragma_foreign_keys). This CORRECTS an earlier
 *   claim in this file (pre-2026-07-20) that `DROP TABLE docs` was
 *   "empirically safe" under `PRAGMA foreign_keys = ON` — that claim held
 *   only against the SYNTHETIC fixtures this migration was authored/tested
 *   against, which lacked real child rows in `links`/`versions`/
 *   `review_judgments`/`calibration_records` referencing `docs(id)` (plus
 *   `docs.parent_id`'s own self-reference). Reproduced empirically against a
 *   COPY of the team's live 356-doc corpus (SPEC-056 closure task
 *   `task-skill-review-cutover-verification-docs-code-anchors`, AC-P-2's
 *   "R2 trigger check: live-shape coverage"): with FK enforcement ON, SQLite's
 *   documented DROP TABLE behavior (sqlite.org/foreignkeys.html §7 "Schema
 *   modifications" — DROP TABLE performs an implicit DELETE FROM first,
 *   firing FK actions for every real child row) raises
 *   `FOREIGN KEY constraint failed` on the DROP, and — because bun:sqlite's
 *   `db.exec()` does not abort a multi-statement string on that failure (see
 *   this file's OWN neighboring invariant on `sqlite-store.ts`'s
 *   `runMigrations` re: no-auto-rollback) — execution falls through into the
 *   subsequent `CREATE INDEX`/`CREATE TRIGGER` statements, which then fail
 *   with the CONFUSING secondary error "already another table or index with
 *   this name: docs" (the ORIGINAL `docs` table, never actually dropped).
 *   `PRAGMA defer_foreign_keys = ON` INSIDE the transaction was tried and
 *   REJECTED — it defers the check to COMMIT, but SQLite's deferred-FK
 *   mechanism is a per-transaction VIOLATION COUNTER incremented by the
 *   implicit delete-then-reinsert dance, not a fresh full-state re-scan; the
 *   COMMIT still failed even though `PRAGMA foreign_key_check` mid-transaction
 *   reported zero violations. Toggling the CONNECTION-LEVEL pragma OFF/ON
 *   around the whole migration is SQLite's own documented recipe for this
 *   exact scenario (sqlite.org/lang_altertable.html "Making Other Kinds Of
 *   Table Schema Changes", steps 1 and 12) and is the only approach verified
 *   to leave `PRAGMA foreign_key_check` clean AFTER commit.
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

-- PRAGMA foreign_keys is a no-op inside a pending transaction (SQLite docs),
-- so this toggle MUST sit outside BEGIN/COMMIT — see this file's module
-- JSDoc invariant (2026-07-20 correction) for why DROP TABLE docs requires
-- it under real production data.
PRAGMA foreign_keys = OFF;

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

-- Restore FK enforcement now that the transaction (and thus the schema
-- change) is settled — this pragma is a no-op inside a transaction, so it
-- MUST run after COMMIT, mirroring the OFF toggle above.
PRAGMA foreign_keys = ON;
`;
