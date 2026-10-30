/**
 * Migration 044 — stored suite results whose command exited with anything but 0 or 1 become `unrunnable`
 * (BR-1497: a run that could not complete is stored `unrunnable` with its cause; spec-a-plan-s-tests-and-criteria-are-measured-once-at-its).
 * SQL is an inlined string constant so `bun build --compile` can bundle it without filesystem access.
 *
 * Public surface: {@link MIGRATION_044_SQL}.
 *
 * Why: `bun run test` exits 5 when the checkout's oracle lock is held by another run, which means NO test ran. Such a run
 * was stored `measured` with no failing file, and a reader took it for "every file passed there" (regression at the
 * assessed commit then bisected from a false green lower bound). The writer now stores such a run `unrunnable`
 * (`SuiteResultService.lookupOrRun`); this migration corrects the rows written before that.
 *
 * Invariants:
 *   - Rows are kept: only `status` and `cause` change (`commands`, `failing_files`, `attempt`, ids stay as recorded), so the
 *     history of what was stored is intact and a later lookup retries the commit as `attempt + 1`.
 *   - Only a `measured` row with a command whose exit code is outside {0, 1} is touched; a red (exit 1) or green (exit 0)
 *     row, and a measured row with no command at all, are untouched.
 *   - `suite_file_runs` has no status column; a single-file run with such an exit code is now refused at write time and
 *     none existed on the live corpus when this migration was written, so no row of that table is changed.
 *   - Idempotent (a second run matches no `measured` row) and run inside one BEGIN/COMMIT with `PRAGMA user_version = 44`.
 *
 * Side-effect class: schema/data migration (executed once per store).
 */

export const MIGRATION_044_SQL = `-- Migration: 044-suite-results-non-run-exits-unrunnable
-- Schema version: 44

BEGIN IMMEDIATE;

UPDATE suite_results
SET status = 'unrunnable',
    cause = 'reclassified by migration 044: \`' ||
      (SELECT json_extract(j.value, '$.command') FROM json_each(suite_results.commands) AS j
        WHERE json_extract(j.value, '$.exit_code') NOT IN (0, 1) LIMIT 1) ||
      '\` exited with code ' ||
      (SELECT json_extract(j.value, '$.exit_code') FROM json_each(suite_results.commands) AS j
        WHERE json_extract(j.value, '$.exit_code') NOT IN (0, 1) LIMIT 1) ||
      ', which is not a test result (0 = pass, 1 = failures): the tests did not run'
WHERE status = 'measured'
  AND EXISTS (SELECT 1 FROM json_each(suite_results.commands) AS j WHERE json_extract(j.value, '$.exit_code') NOT IN (0, 1));

PRAGMA user_version = 44;

COMMIT;
`;
