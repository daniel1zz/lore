/**
 * Migration 024 — `decision_log.detail` (task HR-T1, spec-human-review-surface-decisions-audit-items-and-pending D1):
 * nullable JSON text holding the human-readable account of a decision. SQL is an inlined string constant so
 * `bun build --compile` can bundle it.
 *
 * Public surface: {@link MIGRATION_024_SQL}.
 *
 * Invariants:
 *   - Plain `ADD COLUMN` (no rebuild): every existing row keeps its stored text and gets `detail = NULL`, and
 *     `computeDecisionEntryHash` hashes a null detail exactly as before, so every `entry_hash` and every pushed
 *     chain head still verifies. The append-only triggers are untouched (ALTER does not fire them).
 *
 * Side-effect class: schema DDL (executed once per store).
 */
export const MIGRATION_024_SQL = `-- Migration: 024-decision-log-detail
-- Schema version: 24

ALTER TABLE decision_log ADD COLUMN detail TEXT;

PRAGMA user_version = 24;
`;
