/**
 * Migration 049 — `judge_verdicts`: the judge's raw answer for one unit (a changed file, an AI criterion) of a milestone review,
 * stored under the sha256 key of that unit's inputs so a re-review reuses it (spec-a-re-review-reuses-the-judge-s-verdict-for-every-unit,
 * S4; BR-1535). SQL is an inlined string constant so `bun build --compile` can bundle it without filesystem access.
 *
 * Public surface: {@link MIGRATION_049_SQL}.
 *
 * Invariants:
 *   - `key` is the PRIMARY KEY: two reviews writing one key cannot both store it (insert-if-absent, the first writer wins).
 *   - `last_read_at` is refreshed by every review that reads a row; the only deletion is by that age (30 days), never by
 *     `template_hash` or `model`, so reviews running different builds never delete each other's live rows.
 *   - `raw_answer` is JSON text parsed with Zod on read; a row that no longer parses is replaced by compare-and-swap on its exact text.
 *   - Local-only, never replicated.
 *   - Re-runnable: `IF NOT EXISTS`, all inside one BEGIN/COMMIT together with `PRAGMA user_version = 49`.
 *
 * Side-effect class: schema DDL (executed once per store).
 */

export const MIGRATION_049_SQL = `-- Migration: 049-judge-verdicts
-- Schema version: 49

BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS judge_verdicts (
  key           TEXT PRIMARY KEY,
  unit_kind     TEXT NOT NULL CHECK (unit_kind IN ('file', 'criterion')),
  unit_id       TEXT NOT NULL,
  raw_answer    TEXT NOT NULL,
  provider      TEXT NOT NULL,
  model         TEXT NOT NULL,
  template_hash TEXT NOT NULL,
  first_review  TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  last_read_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_judge_verdicts_last_read ON judge_verdicts (last_read_at);

PRAGMA user_version = 49;

COMMIT;
`;
