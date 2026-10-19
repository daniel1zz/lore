/**
 * Migration 026 — `versions.action` admits `'undelete'` (spec-defect-clusters-round-2-part-a D6): `lore undelete`
 * writes a real version row (N+1) with that action. SQL is inlined string constants so `bun build --compile`
 * can bundle it without filesystem access.
 *
 * Public surface: {@link MIGRATION_026_STEPS}, {@link MIGRATION_026_SQL}, {@link applyMigration026},
 * {@link MigrationFailedError}.
 *
 * Invariants:
 *   - SQLite cannot alter a CHECK, so `versions` is REBUILT (the migration-023 pattern): new table with the widened
 *     CHECK, `INSERT ... SELECT` of every column VERBATIM (no stored text of any row changes), drop, rename, then both
 *     indexes are recreated (`idx_versions_doc` from 001, `idx_versions_keys` from 025).
 *   - ATOMIC: every step, including `PRAGMA user_version = 26`, runs between ONE `BEGIN IMMEDIATE` and ONE `COMMIT`
 *     ({@link applyMigration026}; {@link MIGRATION_026_SQL} is the same text for Turso's `executeMultiple`). Any
 *     failure (disk full, kill, a bad row) rolls the whole transaction back: the corpus stays at schema 25, readable,
 *     with the original `versions` table. A hard kill leaves SQLite's journal, which the next open rolls back.
 *   - FAILS LOUD: a failed step throws {@link MigrationFailedError} naming the step and the corpus path; the process
 *     exits non-zero and never continues on a half-built table.
 *   - Re-runnable: a leftover `versions_new` is dropped first, inside the transaction.
 *   - Cost: one pass over the versions table, once per store; the old and new tables coexist until COMMIT, so the
 *     disk needs free space of about the size of `versions`.
 *   - The column list is the union of 001 + 007 (`slug`) + 016 (`harness_run`).
 *
 * Side-effect class: schema DDL (executed once per store).
 */

/** One named statement of the rebuild; the name is what a failure reports. */
export interface MigrationStep {
  readonly name: string;
  readonly sql: string;
}

/** The ordered steps run between BEGIN IMMEDIATE and COMMIT. */
export const MIGRATION_026_STEPS: readonly MigrationStep[] = [
  { name: "drop leftover versions_new", sql: "DROP TABLE IF EXISTS versions_new;" },
  {
    name: "create versions_new with the widened action CHECK",
    sql: `CREATE TABLE versions_new (
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
);`,
  },
  {
    name: "copy every versions row into versions_new",
    sql: `INSERT INTO versions_new
  (doc_id, version, content, extra, status, title, action, created_at, created_by, change_summary, slug, harness_run)
SELECT doc_id, version, content, extra, status, title, action, created_at, created_by, change_summary, slug, harness_run
FROM versions;`,
  },
  { name: "drop the old versions table", sql: "DROP TABLE versions;" },
  { name: "rename versions_new to versions", sql: "ALTER TABLE versions_new RENAME TO versions;" },
  { name: "recreate idx_versions_doc", sql: "CREATE INDEX IF NOT EXISTS idx_versions_doc  ON versions(doc_id, version DESC);" },
  {
    name: "recreate idx_versions_keys",
    sql: "CREATE INDEX IF NOT EXISTS idx_versions_keys ON versions(created_at, doc_id, version, action);",
  },
  { name: "set user_version 26", sql: "PRAGMA user_version = 26;" },
];

/** The same steps as one transactional script (Turso's `executeMultiple`). */
export const MIGRATION_026_SQL = `-- Migration: 026-versions-undelete-action
-- Schema version: 26

BEGIN IMMEDIATE;

${MIGRATION_026_STEPS.map((s) => `-- ${s.name}\n${s.sql}`).join("\n\n")}

COMMIT;
`;

/** A migration step failed; the transaction was rolled back and the corpus is still at the prior schema. */
export class MigrationFailedError extends Error {
  readonly context: { readonly migration: number; readonly step: string; readonly corpusPath: string };

  constructor(migration: number, step: string, corpusPath: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(
      `migration ${migration} failed at step "${step}" on corpus ${corpusPath}: ${detail} — ` +
        `rolled back; the corpus is unchanged at schema ${migration - 1}`,
      { cause },
    );
    this.name = "MigrationFailedError";
    this.context = { migration, step, corpusPath };
  }
}

/** The part of `bun:sqlite`'s `Database` this runner needs. */
export interface SqlExecutor {
  exec(sql: string): unknown;
}

/**
 * Runs migration 026 atomically on a SQLite handle.
 *
 * @param db - an open handle at schema 25
 * @param corpusPath - the corpus file, named in a failure
 * @param steps - the steps to run (default {@link MIGRATION_026_STEPS}; a test injects a failing one)
 * @throws {MigrationFailedError} when any step fails, after rolling the transaction back
 */
export function applyMigration026(
  db: SqlExecutor,
  corpusPath: string,
  steps: readonly MigrationStep[] = MIGRATION_026_STEPS,
): void {
  let current = "begin transaction";
  try {
    db.exec("BEGIN IMMEDIATE;");
    for (const step of steps) {
      current = step.name;
      db.exec(step.sql);
    }
    current = "commit";
    db.exec("COMMIT;");
  } catch (error) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // reason: no open transaction to roll back (BEGIN itself failed, or COMMIT already closed it) — the
      // original failure below is the one to report.
    }
    throw new MigrationFailedError(26, current, corpusPath, error);
  }
}
