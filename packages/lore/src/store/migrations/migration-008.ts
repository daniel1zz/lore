/**
 * Migration 008 — CJK bigram shadow columns for FTS5 search (task
 * task-fts5-cjk-search-returns-zero-hits-unicode61-tokenizes). SQL fragments
 * are inlined as string constants so `bun build --compile` can bundle them
 * without requiring filesystem access to `.sql` files at runtime. Never edit
 * migration-001..007 in place — this is a NEW migration, additive only.
 *
 * ## Why this migration is NOT one self-contained SQL string (unlike 001-007)
 *
 * Every prior migration is a single `db.exec(MIGRATION_NNN_SQL)` / one
 * `executeMultiple` call, self-wrapping its own `BEGIN IMMEDIATE; ...
 * COMMIT;`. This migration cannot follow that shape: populating the new
 * `docs.fts_title` / `fts_content` / `fts_tags` columns requires the
 * per-row CJK bigram expansion `expandCjkForFts` (`store-shared.ts`) — a
 * JS-level Unicode-aware string transform SQLite itself has no built-in
 * function for. The migration is therefore a THREE-PHASE sequence, with
 * pure SQL fragments exported here and the JS backfill loop + the
 * transaction wrapper living in each store's own migration runner
 * (`sqlite-store.ts::runMigrations` / `turso-store.ts::initSchema`, which
 * already own that responsibility for every other migration's
 * catch/ROLLBACK wrapping):
 *
 *   1. {@link MIGRATION_008_ADD_COLUMNS_SQL} — `ALTER TABLE docs ADD COLUMN`
 *      × 3, nullable-with-default (mirrors migration-005/007's shape — a
 *      widened CHECK constraint needs the migration-004/006 table-recreate
 *      dance; three new columns do not).
 *   2. The calling store SELECTs every row's `id, title, content, tags`,
 *      computes `computeFtsShadowValues(...)` per row, and UPDATEs the three
 *      new columns back — this loop cannot be expressed as a SQL string.
 *   3. {@link MIGRATION_008_FTS_REBUILD_SQL} — drops and recreates `docs_fts`
 *      itself (see the invariant below for why), recreates the three
 *      triggers to feed it from the shadow columns, runs FTS5's `'rebuild'`
 *      command, and bumps `PRAGMA user_version = 8`.
 *
 * @invariant Neither SQL fragment contains its own `BEGIN`/`COMMIT` —
 *   unlike migrations 004-007, transaction ownership sits with the CALLING
 *   store code, because phase 2 (JS backfill) must run INSIDE the same
 *   transaction as phases 1 and 3. If phase 1 committed independently and
 *   the process crashed before phase 3's `PRAGMA user_version = 8` landed,
 *   `currentVersion` would still read 7 on restart and this migration would
 *   re-run phase 1's `ADD COLUMN` against columns that already exist,
 *   throwing "duplicate column name" and permanently bricking the corpus —
 *   the exact class of bug `migration-001.ts`'s `IF NOT EXISTS` guards and
 *   migration-006's FK-restore fix both exist to prevent. Wrapping ALL
 *   THREE phases in one `BEGIN IMMEDIATE`/`COMMIT` (SQLite/libsql, WAL mode)
 *   means a crash anywhere in the sequence leaves `user_version` at 7 with
 *   NONE of the new columns/objects durably present — a clean restart from
 *   scratch, not a half-applied state.
 * @invariant `docs_fts` itself must be DROPPED and RECREATED against
 *   `fts_title`/`fts_content`/`fts_tags` as ITS OWN column names (not fed
 *   different trigger values while staying bound to `title`/`content`/
 *   `tags`) — verified against the SQLite FTS5 docs before choosing this
 *   design (sqlite.org/fts5.html "External Content Tables": column mapping
 *   between an FTS5 table and its `content=` table is BY NAME, and both
 *   `INSERT INTO fts(fts) VALUES('rebuild')` and `'integrity-check'`
 *   re-tokenize the CONTENT TABLE's own columns directly — NOT whatever
 *   values a trigger last inserted). If `docs_fts` kept the `content=docs`
 *   binding pointed at the REAL `title`/`content`/`tags` columns while the
 *   triggers indexed bigram-expanded VALUES, `'integrity-check'` would
 *   re-tokenize the real (un-expanded) text with unicode61, get different
 *   tokens than what's actually in the index, and report corruption on a
 *   perfectly healthy database. Binding `content=docs` with FTS5 columns
 *   NAMED `fts_title`/`fts_content`/`fts_tags` makes the index and its
 *   content-table source describe the SAME text, so integrity-check passes
 *   and `'rebuild'` (which reads directly from the content table) needs the
 *   shadow columns already backfilled BEFORE this SQL runs — hence phase 2
 *   sitting between phases 1 and 3, all in one transaction.
 * @invariant `snippet(docs_fts, 1, ...)` (the column-INDEX argument used by
 *   `SQLiteStore.search`) is unaffected — `fts_title`/`fts_content`/
 *   `fts_tags` preserve the SAME 0/1/2 ordinal order `title`/`content`/`tags`
 *   had, so index `1` still means "the content column". Its rendered text
 *   now comes from `docs.fts_content`: byte-identical to `docs.content` for
 *   ASCII (per `expandCjkForFts`'s no-op-on-non-CJK guarantee), but
 *   bigram-spaced for CJK hits — an accepted display trade-off (no AC or
 *   existing test requires natural-language CJK snippets; the ACs require
 *   CJK search HITS and ASCII snippet byte-identity, both preserved).
 * @invariant Every EXISTING row (including soft-deleted ones — `docs_fts`
 *   has always indexed those too, filtered only at query time by `search`'s
 *   `d.deleted_at IS NULL` join clause, not by index membership) is
 *   backfilled — phase 2's `SELECT id, title, content, tags FROM docs` has
 *   no `WHERE` clause.
 */

export const MIGRATION_008_ADD_COLUMNS_SQL = `-- Migration: 008-cjk-fts-shadow-columns (phase 1 of 3)
-- Adds the three CJK-bigram-expanded shadow columns docs_fts will index
-- against once migration-008's phase 3 (MIGRATION_008_FTS_REBUILD_SQL) runs.
-- Every EXISTING row's shadow columns start as '' here; phase 2 (the calling
-- store's own JS backfill loop, run inside the SAME transaction as this SQL)
-- overwrites them with the real expandCjkForFts(...) values before phase 3's
-- 'rebuild' command reads them.

ALTER TABLE docs ADD COLUMN fts_title   TEXT NOT NULL DEFAULT '';
ALTER TABLE docs ADD COLUMN fts_content TEXT NOT NULL DEFAULT '';
ALTER TABLE docs ADD COLUMN fts_tags    TEXT NOT NULL DEFAULT '';
`;

export const MIGRATION_008_FTS_REBUILD_SQL = `-- Migration: 008-cjk-fts-shadow-columns (phase 3 of 3)
-- Schema version: 8
-- Runs AFTER phase 2 (JS backfill) has populated fts_title/fts_content/
-- fts_tags for every row — see migration-008.ts's module JSDoc for why
-- docs_fts itself (not just its triggers) must be redefined against these
-- shadow columns as ITS OWN column names.

DROP TRIGGER IF EXISTS docs_ai;
DROP TRIGGER IF EXISTS docs_ad;
DROP TRIGGER IF EXISTS docs_au;
DROP TABLE IF EXISTS docs_fts;

CREATE VIRTUAL TABLE docs_fts USING fts5(
  fts_title,
  fts_content,
  fts_tags,
  content=docs,
  content_rowid=rowid
);

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

-- Rebuild the full-text index from the (now-backfilled) shadow columns —
-- SQLite FTS5's documented external-content rebuild command; reads
-- docs.fts_title/fts_content/fts_tags directly, row by row, via the
-- content_rowid binding above.
INSERT INTO docs_fts(docs_fts) VALUES('rebuild');

PRAGMA user_version = 8;
`;
