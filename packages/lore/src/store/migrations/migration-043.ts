/**
 * Migration 043 — `suite_results` and `suite_file_runs`: the full-suite result of one commit, stored once, and the
 * per-file re-runs attached to it (spec-the-milestone-review-measures-its-facts-per-landing-and, AC-AF-2; BR-1497).
 * SQL is an inlined string constant so `bun build --compile` can bundle it without filesystem access.
 *
 * Public surface: {@link MIGRATION_043_SQL}.
 *
 * Invariants:
 *   - Append-only: no UPDATE or DELETE statement exists for either table. A retry of an unrunnable commit is a NEW row
 *     (`attempt` + 1, new id), never an edit of the earlier one.
 *   - `status` is `measured | unrunnable` (CHECK); an `unrunnable` row names its `cause`, a `measured` row has none
 *     (CHECK), so a result that cannot say why it failed is refused rather than stored.
 *   - `commands` / `skipped` / `failing_files` are JSON text, parsed with Zod on read (`store-shared.ts::rowToSuiteResult`).
 *   - `(commit_sha, attempt)` is UNIQUE: two writers racing on the same attempt cannot both store it.
 *   - Local-only, never replicated.
 *   - Re-runnable: `IF NOT EXISTS` everywhere, all inside one BEGIN/COMMIT together with `PRAGMA user_version = 43`.
 *
 * Side-effect class: schema DDL (executed once per store).
 */

export const MIGRATION_043_SQL = `-- Migration: 043-suite-results
-- Schema version: 43

BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS suite_results (
  id            TEXT PRIMARY KEY,
  commit_sha    TEXT NOT NULL,
  tree_sha      TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('measured', 'unrunnable')),
  attempt       INTEGER NOT NULL CHECK (attempt >= 1),
  cause         TEXT,
  commands      TEXT NOT NULL,
  skipped       TEXT NOT NULL,
  failing_files TEXT NOT NULL,
  duration_ms   INTEGER NOT NULL CHECK (duration_ms >= 0),
  measured_at   TEXT NOT NULL,
  CHECK ((status = 'unrunnable' AND cause IS NOT NULL) OR (status = 'measured' AND cause IS NULL)),
  UNIQUE (commit_sha, attempt)
);

CREATE INDEX IF NOT EXISTS idx_suite_results_measured_at ON suite_results (measured_at, id);

CREATE TABLE IF NOT EXISTS suite_file_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  suite_result_id TEXT NOT NULL,
  commit_sha      TEXT NOT NULL,
  file            TEXT NOT NULL,
  exit_code       INTEGER NOT NULL,
  output_tail     TEXT NOT NULL,
  duration_ms     INTEGER NOT NULL CHECK (duration_ms >= 0),
  measured_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_suite_file_runs_result ON suite_file_runs (suite_result_id, id);

PRAGMA user_version = 43;

COMMIT;
`;
