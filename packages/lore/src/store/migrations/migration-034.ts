/**
 * Migration 034 — `pending_asks`: the question lore wrote for a pending decision, bound to a single-use nonce
 * (spec-human-decisions-are-asked-in-the-session-and-recorded-by, AC-ASK-1, AC-ASK-2; BR-1374).
 * SQL is an inlined string constant so `bun build --compile` can bundle it without filesystem access.
 *
 * Public surface: {@link MIGRATION_034_SQL}.
 *
 * Invariants:
 *   - One row per `lore pending --ask` issue of one decision: `(decision_id, subject_version, nonce, question_hash)`.
 *     `question_hash` is the sha256 of the exact question object lore issued; the nonce is only honoured together
 *     with a question that hashes to it.
 *   - `nonce` is UNIQUE. `used_at` is set exactly once (single use); the only UPDATE is that one transition.
 *   - A newer issue for the same decision makes every older row stale (latest `id` per `decision_id` wins); rows are
 *     never deleted.
 *   - Local-only, never replicated, and holds no secret beyond the nonce lore already printed into the question.
 *   - Re-runnable: `IF NOT EXISTS` everywhere, all inside one BEGIN/COMMIT together with `PRAGMA user_version = 34`.
 *
 * Side-effect class: schema DDL (executed once per store).
 */

export const MIGRATION_034_SQL = `-- Migration: 034-pending-asks
-- Schema version: 34

BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS pending_asks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  decision_id     INTEGER NOT NULL,
  subject_version TEXT NOT NULL,
  nonce           TEXT NOT NULL UNIQUE,
  question_hash   TEXT NOT NULL,
  issued_at       TEXT NOT NULL,
  used_at         TEXT
);

CREATE INDEX IF NOT EXISTS idx_pending_asks_decision ON pending_asks (decision_id, id);

PRAGMA user_version = 34;

COMMIT;
`;
