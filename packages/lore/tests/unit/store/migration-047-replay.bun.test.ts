/**
 * @spec_ref spec-review-test-runs-are-capped-per-machine-and-a-run-that
 * @ac_ref AC-MC-3
 *
 * Migration 047 adds `suite_file_runs.classification` / `inconclusive_cause` only where `PRAGMA table_info` lacks them (#587), and its
 * backfill never reclassifies an already-classified row, so a store whose `user_version` was rewound and reopened with migrate replays
 * it without throwing `duplicate column name`.
 *
 * Coverage: HAPPY (a fresh migrate lands on head) / STATE (rewind to 46 and to 34, reopen: succeeds, version back at head) /
 * REGRESSION (a `red` row stays `red`, an `inconclusive` timeout row keeps its cause, a green row stays green) /
 * BOUNDARY (a v46 file that lacks the columns still gets them and its failing row is backfilled `unclassified`) / both SQLite and Turso.
 */

import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LATEST_SCHEMA_VERSION } from "../../../src/store/schema-version.js";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { TursoStore } from "../../../src/store/turso-store.js";
import { actedStore } from "../../live-invocation.js";

interface FileRunRow {
  classification: string;
  inconclusive_cause: string | null;
}

const CASES = [
  { label: "SQLiteStore", open: (path: string) => actedStore(new SQLiteStore(path, { migrate: true })) },
  { label: "TursoStore", open: (path: string) => actedStore(new TursoStore({ localPath: path, migrate: true })) },
] as const;

function insertRun(db: Database, id: number, exitCode: number, classification: string, cause: string | null): void {
  db.prepare(
    `INSERT INTO suite_file_runs (id, suite_result_id, commit_sha, file, exit_code, output_tail, duration_ms, measured_at, classification, inconclusive_cause)
     VALUES (?, ?, 'abc', ?, ?, '', 1, '2026-01-01T00:00:00Z', ?, ?)`,
  ).run(id, `file-${id}@abc`, `f${id}.test.ts`, exitCode, classification, cause);
}

function readRuns(path: string): Map<number, FileRunRow> {
  const db = new Database(path, { readonly: true });
  try {
    const rows = db.query("SELECT id, classification, inconclusive_cause FROM suite_file_runs ORDER BY id").all() as (FileRunRow & { id: number })[];
    return new Map(rows.map((r) => [r.id, r]));
  } finally {
    db.close();
  }
}

function rewind(path: string, version: number): void {
  const db = new Database(path);
  db.exec(`PRAGMA user_version = ${version}`);
  db.close();
}

describe.each(CASES)("migration 047 replay ($label)", ({ open }) => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lore-m047-"));
    path = join(dir, "lore.db");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function seedMigrated(): void {
    open(path).close();
    const db = new Database(path);
    insertRun(db, 1, 1, "red", null);
    insertRun(db, 2, 0, "green", null);
    insertRun(db, 3, 1, "inconclusive", "timeout");
    db.close();
  }

  it.each([46, 34])("reopening a store rewound to user_version %i succeeds and keeps every classification", (version) => {
    seedMigrated();
    rewind(path, version);

    open(path).close();

    const runs = readRuns(path);
    expect(runs.get(1)).toMatchObject({ classification: "red", inconclusive_cause: null });
    expect(runs.get(2)).toMatchObject({ classification: "green", inconclusive_cause: null });
    expect(runs.get(3)).toMatchObject({ classification: "inconclusive", inconclusive_cause: "timeout" });
    const db = new Database(path, { readonly: true });
    expect((db.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(LATEST_SCHEMA_VERSION);
    db.close();
  });

  it("a v46 file without the columns gets them and its failing row is backfilled inconclusive/unclassified", () => {
    seedMigrated();
    const db = new Database(path);
    db.exec("DROP INDEX IF EXISTS uq_suite_file_runs_single_file_key");
    db.exec("ALTER TABLE suite_file_runs DROP COLUMN classification");
    db.exec("ALTER TABLE suite_file_runs DROP COLUMN inconclusive_cause");
    db.exec("PRAGMA user_version = 46");
    db.close();

    open(path).close();

    const runs = readRuns(path);
    expect(runs.get(1)).toMatchObject({ classification: "inconclusive", inconclusive_cause: "unclassified" });
    expect(runs.get(2)).toMatchObject({ classification: "green", inconclusive_cause: null });
  });
});
