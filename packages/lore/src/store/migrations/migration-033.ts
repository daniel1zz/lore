/**
 * Migration 033 — `check_outcomes`: one row per run of every retained gate and hook, so a check can show it ever
 * caught something (spec-lean-governance-batch-verbs-judgment-only-at-milestones Part D, AC-LG-13; BR-1373).
 * SQL is an inlined string constant so `bun build --compile` can bundle it without filesystem access.
 *
 * Public surface: {@link MIGRATION_033_SQL}.
 *
 * Invariants:
 *   - `outcome` is one of `pass | deny | error` (CHECK): a check that cannot say which of the three happened
 *     records nothing rather than a guess.
 *   - Append-only: no UPDATE or DELETE statement exists for this table. Stats are aggregates over the rows.
 *   - `idx_check_outcomes_check` serves the per-check aggregate (`GROUP BY check_id`) without a table scan sort.
 *   - Re-runnable: `IF NOT EXISTS` everywhere, all inside one BEGIN/COMMIT together with `PRAGMA user_version = 33`.
 *
 * Side-effect class: schema DDL (executed once per store).
 */

export const MIGRATION_033_SQL = `-- Migration: 033-check-outcomes
-- Schema version: 33

BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS check_outcomes (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  check_id TEXT NOT NULL,
  outcome  TEXT NOT NULL CHECK (outcome IN ('pass', 'deny', 'error')),
  ts       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_check_outcomes_check ON check_outcomes (check_id, ts);

PRAGMA user_version = 33;

COMMIT;
`;
