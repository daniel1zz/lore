/**
 * Migration 022 — `autonomy_thresholds`: the ONE governed autonomy threshold record
 * (spec-autonomy-phase-1-decision-function-human-channel-lore AC-AU-9; ADR D8).
 * SQL is an inlined string constant so `bun build --compile` can bundle it without filesystem access.
 *
 * Public surface: {@link MIGRATION_022_SQL}.
 *
 * Invariants:
 *   - Exactly ONE row (`id = 1`, CHECK-enforced): the record is a single document, not a history. The history is the
 *     `decision_log` chain: every write through lore appends an `autonomy-threshold-write` decision row carrying
 *     the sha256 of `content`, so a row edited outside lore no longer matches its chain (service/autonomy-threshold-service.ts).
 *   - NOT append-only on purpose: lore updates the row in place on every governed write. An edit from outside lore
 *     is what the content-hash-in-the-chain exists to detect, not something a trigger here could tell apart.
 *   - `content` is the exact canonical JSON text that was hashed; it is never re-serialised on read.
 *   - Local-only: NOT in sync-push's replicated table set (the record is mirrored as a git-tracked file by mirror export).
 *
 * Side-effect class: schema DDL (executed once per store).
 */
export const MIGRATION_022_SQL = `-- Migration: 022-autonomy-thresholds
-- Schema version: 22

BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS autonomy_thresholds (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  content    TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

PRAGMA user_version = 22;

COMMIT;
`;
