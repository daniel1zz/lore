/**
 * Migration 047 — every stored file run is classified (BR-1533, spec-review-test-runs-are-capped-per-machine-and-a-run-that):
 * `suite_file_runs` gets `classification` (`red` | `green` | `inconclusive`) and `inconclusive_cause`.
 * SQL is an inlined string constant so `bun build --compile` can bundle it without filesystem access.
 *
 * Public surface: {@link MIGRATION_047_SQL}.
 *
 * Why: a test or hook timeout used to be stored as a failing (red) run and could be charged to a plan. A run whose failures are all
 * timeouts says nothing about the file; the writer now classifies each run, and the readers consult only conclusive runs.
 *
 * Invariants:
 *   - One-time backfill, no row deleted: a passing row (exit 0) becomes `green`; a failing row becomes `inconclusive` with cause
 *     `unclassified` (its output was never kept in a form that could tell a timeout from an assertion, so it is retried, not trusted).
 *     After this migration no row lacks a classification: the column is NOT NULL and a reader has no branch for an unclassified row.
 *   - The single-file unique index (migration-045) is rebuilt over CONCLUSIVE rows only, so a retry's inconclusive runs are all kept
 *     while a (key, file) still has at most one conclusive run (first wins, #528). The InMemory store applies the same rule.
 *   - The DEFAULT 'green' exists only because SQLite requires one to add a NOT NULL column; the UPDATE below corrects every failing row,
 *     and every writer (`insertSuiteFileRuns`) names the classification explicitly.
 *   - Idempotent re-run is not needed: `PRAGMA user_version = 47` is inside the transaction with the DDL, so a failure rolls back whole.
 *
 * Side-effect class: schema migration (executed once per store).
 */

export const MIGRATION_047_SQL = `-- Migration: 047-suite-file-runs-classification
-- Schema version: 47

BEGIN IMMEDIATE;

ALTER TABLE suite_file_runs ADD COLUMN classification TEXT NOT NULL DEFAULT 'green'
  CHECK (classification IN ('red', 'green', 'inconclusive'));
ALTER TABLE suite_file_runs ADD COLUMN inconclusive_cause TEXT
  CHECK (inconclusive_cause IS NULL OR inconclusive_cause IN ('timeout', 'no-report', 'unclassified'));

UPDATE suite_file_runs SET classification = 'inconclusive', inconclusive_cause = 'unclassified' WHERE exit_code <> 0;

DROP INDEX IF EXISTS uq_suite_file_runs_single_file_key;
CREATE UNIQUE INDEX uq_suite_file_runs_single_file_key
  ON suite_file_runs (suite_result_id, file)
  WHERE suite_result_id LIKE 'file-%@%' AND classification <> 'inconclusive';

PRAGMA user_version = 47;

COMMIT;
`;
