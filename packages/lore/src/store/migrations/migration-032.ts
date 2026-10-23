/**
 * Migration 032 — `decision_log.verdict` admits `'milestone'` (task B4, spec-lean-governance-batch-verbs-judgment-only-
 * at-milestones Part B, AC-LG-8; BR-1370): the decision recorded for `override-judgment`, `override-attestation` and
 * `ac-exempt`, which the milestone review resolves instead of a pending human decision.
 * SQL is an inlined string constant so `bun build --compile` can bundle it without filesystem access.
 *
 * Public surface: {@link MIGRATION_032_SQL}.
 * Source: BR-1370, AC-LG-8.
 *
 * Invariants:
 *   - SQLite cannot alter a CHECK, so the table is REBUILT in one BEGIN IMMEDIATE/COMMIT exactly as migration 023 did,
 *     now INCLUDING the `detail` column migration 024 added: `INSERT ... SELECT` copies every column VERBATIM (ids and
 *     the stored text of every column), so every `entry_hash`/`prev_hash` stays valid and `verifyDecisionChain` stays clean.
 *   - The `AUTOINCREMENT` counter follows the rename (sqlite_sequence); the index and both append-only triggers are recreated.
 *   - Re-runnable: a leftover `decision_log_new` from an interrupted run is dropped first; one transaction, so a failure
 *     leaves the old table untouched.
 *   - A `milestone` row is a decision that is neither auto nor pending: it never opens a pending human decision and is
 *     never an `auto` for calibration/sampling (those select `verdict = 'auto'`).
 *
 * Side-effect class: schema DDL (executed once per store).
 */
export const MIGRATION_032_SQL = `-- Migration: 032-decision-log-milestone-verdict
-- Schema version: 32

BEGIN IMMEDIATE;

DROP TABLE IF EXISTS decision_log_new;

CREATE TABLE decision_log_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              TEXT NOT NULL,
  class           TEXT NOT NULL,
  subject_id      TEXT NOT NULL,
  subject_version TEXT NOT NULL,
  facts           TEXT NOT NULL,
  factors         TEXT NOT NULL,
  score           REAL NOT NULL,
  threshold       REAL,
  verdict         TEXT NOT NULL CHECK(verdict IN ('auto','escalate','refuse','superseded','milestone')),
  reasons         TEXT NOT NULL,
  executor_run    TEXT,
  channel         TEXT NOT NULL CHECK(channel IN ('machine','human-tty','agent-asserted')),
  prev_hash       TEXT NOT NULL,
  entry_hash      TEXT NOT NULL,
  detail          TEXT
);

INSERT INTO decision_log_new
  (id, ts, class, subject_id, subject_version, facts, factors, score, threshold, verdict, reasons,
   executor_run, channel, prev_hash, entry_hash, detail)
SELECT id, ts, class, subject_id, subject_version, facts, factors, score, threshold, verdict, reasons,
   executor_run, channel, prev_hash, entry_hash, detail
FROM decision_log ORDER BY id ASC;

DROP TABLE decision_log;
ALTER TABLE decision_log_new RENAME TO decision_log;

CREATE INDEX IF NOT EXISTS decision_log_subject ON decision_log (class, subject_id, subject_version);

CREATE TRIGGER IF NOT EXISTS decision_log_no_update BEFORE UPDATE ON decision_log
BEGIN
  SELECT RAISE(ABORT, 'decision_log is append-only');
END;

CREATE TRIGGER IF NOT EXISTS decision_log_no_delete BEFORE DELETE ON decision_log
BEGIN
  SELECT RAISE(ABORT, 'decision_log is append-only');
END;

PRAGMA user_version = 32;

COMMIT;
`;
