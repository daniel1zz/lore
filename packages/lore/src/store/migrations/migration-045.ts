/**
 * Migration 045 — a single-file run is stored once per (key, file): `suite_file_runs` gets a UNIQUE index over
 * `(suite_result_id, file)` for rows whose `suite_result_id` is a single-file key (`file-<kind>@<commit>`).
 * SQL is an inlined string constant so `bun build --compile` can bundle it without filesystem access.
 *
 * Public surface: {@link MIGRATION_045_SQL}.
 *
 * Why (#528, BR-1497): two reviews racing at one head could both run and store a bisect/confirm run of the same file, and a
 * reader picked one, so a flaky file classified differently under one fingerprint. The writer now stores
 * insert-or-ignore (`SuiteResultService.runSingleFile` reads the first stored row back); this index is the store-level guard.
 *
 * Invariants:
 *   - The index is PARTIAL (`WHERE suite_result_id LIKE 'file-%@%'`), not a table-wide UNIQUE: `rerunFiles` appends several
 *     re-runs of one file under a real suite result id on purpose (the history of each re-run is the record), and 18 such
 *     duplicate groups exist on the live corpus. A table-wide UNIQUE would have to delete those rows.
 *   - No row is deleted or changed. The live corpus holds no duplicate among single-file keys (75 bisect + 142 confirm rows,
 *     all distinct), so the index builds without dropping anything. A corpus that DID hold one would fail the migration
 *     loudly (rolled back, schema stays 44) rather than lose a run silently.
 *   - The predicate must match `isSingleFileRunKey` in `store-shared.ts` (the InMemory store applies the same rule).
 *   - Idempotent (`IF NOT EXISTS`) and run inside one BEGIN/COMMIT with `PRAGMA user_version = 45`.
 *
 * Side-effect class: schema migration (executed once per store).
 */

export const MIGRATION_045_SQL = `-- Migration: 045-suite-file-runs-single-file-key-unique
-- Schema version: 45

BEGIN IMMEDIATE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_suite_file_runs_single_file_key
  ON suite_file_runs (suite_result_id, file)
  WHERE suite_result_id LIKE 'file-%@%';

PRAGMA user_version = 45;

COMMIT;
`;
