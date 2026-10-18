/**
 * Migration 022 — `decision_log.verdict` admits `'superseded'` (task AU-T16, spec-autonomy-phase-1-decision-function-
 * human-channel-lore AC-AU-3): a closing record for a pending decision whose subject is gone or was re-decided on a
 * newer version. SQL is an inlined string constant so `bun build --compile` can bundle it without filesystem access.
 *
 * Public surface: {@link MIGRATION_022_SQL}.
 *
 * Invariants:
 *   - SQLite cannot alter a CHECK, so the table is REBUILT in one BEGIN IMMEDIATE/COMMIT: new table with the widened
 *     CHECK, `INSERT ... SELECT` of every column VERBATIM (ids and the stored text of every column, so every
 *     `entry_hash`/`prev_hash` stays valid and `verifyDecisionChain` stays clean), drop, rename, then the index and
 *     both append-only triggers are recreated. DROP TABLE does not fire the DELETE trigger.
 *   - The `AUTOINCREMENT` counter follows the rename (sqlite_sequence), so ids keep growing from the old maximum.
 *   - Re-runnable: a leftover `decision_log_new` from an interrupted run is dropped first; the whole string is one
 *     transaction, so a failure leaves the old table untouched.
 *   - A `superseded` row is NOT a decision: it never counts as `auto`/`escalate`/`refuse`. Anything that counts,
 *     calibrates or samples auto decisions (AU-T8 outcome calibration, 1-in-10 sampling) MUST filter on
 *     `verdict = 'auto'` and so never sees these rows; `effectiveDecisionVerdict` ignores them too.
 *
 * Side-effect class: schema DDL (executed once per store).
 */
export const MIGRATION_022_SQL = `-- Migration: 022-decision-log-superseded-verdict
-- Schema version: 22

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
  verdict         TEXT NOT NULL CHECK(verdict IN ('auto','escalate','refuse','superseded')),
  reasons         TEXT NOT NULL,
  executor_run    TEXT,
  channel         TEXT NOT NULL CHECK(channel IN ('machine','human-tty','agent-asserted')),
  prev_hash       TEXT NOT NULL,
  entry_hash      TEXT NOT NULL
);

INSERT INTO decision_log_new
  (id, ts, class, subject_id, subject_version, facts, factors, score, threshold, verdict, reasons,
   executor_run, channel, prev_hash, entry_hash)
SELECT id, ts, class, subject_id, subject_version, facts, factors, score, threshold, verdict, reasons,
   executor_run, channel, prev_hash, entry_hash
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

PRAGMA user_version = 22;

COMMIT;
`;
