/**
 * Migration 020 — `decision_log`: the append-only, hash-chained autonomy decision log
 * (spec-autonomy-phase-1-decision-function-human-channel-lore AC-AU-2; ADR D5).
 * SQL is an inlined string constant so `bun build --compile` can bundle it without filesystem access.
 *
 * Public surface: {@link MIGRATION_020_SQL}.
 *
 * Invariants:
 *   - One BEGIN IMMEDIATE/COMMIT, every statement `IF NOT EXISTS`, so a crash mid-exec re-runs cleanly;
 *     `PRAGMA user_version = 20` sits inside the transaction.
 *   - APPEND-ONLY is enforced by two triggers (BEFORE UPDATE / BEFORE DELETE -> RAISE(ABORT)). They stop an
 *     accidental or in-product rewrite; a deliberate tamper (drop the trigger, edit the file) is what the hash
 *     chain exists to detect — see store/decision-log.ts::verifyDecisionChain.
 *   - JSON columns (`facts`, `factors`, `reasons`) hold the exact canonical text that was hashed; they are never
 *     re-serialised on read.
 *   - `executor_run` is a plain nullable TEXT (not an FK; same reasoning as audit.harness_run).
 *   - Local-only: NOT in sync-push's replicated table set (the chain head is exported through mirror commits, AU-T9).
 *
 * Side-effect class: schema DDL (executed once per store).
 */
export const MIGRATION_020_SQL = `-- Migration: 020-decision-log
-- Schema version: 20

BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS decision_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              TEXT NOT NULL,
  class           TEXT NOT NULL,
  subject_id      TEXT NOT NULL,
  subject_version TEXT NOT NULL,
  facts           TEXT NOT NULL,
  factors         TEXT NOT NULL,
  score           REAL NOT NULL,
  threshold       REAL,
  verdict         TEXT NOT NULL CHECK(verdict IN ('auto','escalate','refuse')),
  reasons         TEXT NOT NULL,
  executor_run    TEXT,
  channel         TEXT NOT NULL CHECK(channel IN ('machine','human-tty','agent-asserted')),
  prev_hash       TEXT NOT NULL,
  entry_hash      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS decision_log_subject ON decision_log (class, subject_id, subject_version);

CREATE TRIGGER IF NOT EXISTS decision_log_no_update BEFORE UPDATE ON decision_log
BEGIN
  SELECT RAISE(ABORT, 'decision_log is append-only');
END;

CREATE TRIGGER IF NOT EXISTS decision_log_no_delete BEFORE DELETE ON decision_log
BEGIN
  SELECT RAISE(ABORT, 'decision_log is append-only');
END;

PRAGMA user_version = 20;

COMMIT;
`;
