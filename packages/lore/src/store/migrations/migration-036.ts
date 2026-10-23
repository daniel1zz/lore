/**
 * Migration 036 — `review_leases`: the named, expiring lease the post-landing review batch holds
 * (spec-plans-close-themselves-level-triggered-reconciliation-of §"Lease", BR-1379).
 * SQL is an inlined string constant so `bun build --compile` can bundle it without filesystem access.
 *
 * Public surface: {@link MIGRATION_036_SQL}.
 *
 * Invariants:
 *   - One row per lease `name`. `holder` is the party that owns it, `expires_at` an ISO-8601 instant.
 *   - A lease is acquired by ONE atomic upsert that succeeds only when the row is absent, expired or already the
 *     caller's; a dead holder therefore loses it by expiry, with no cleanup step. The holder renews it by moving
 *     `expires_at` forward; release deletes the row.
 *   - It lives in the corpus store (not a file) so it also covers a corpus synced across machines.
 *   - Re-runnable: `IF NOT EXISTS`, inside one BEGIN/COMMIT together with `PRAGMA user_version = 36`.
 *
 * Side-effect class: schema DDL (executed once per store).
 */

export const MIGRATION_036_SQL = `-- Migration: 036-review-leases
-- Schema version: 36

BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS review_leases (
  name       TEXT PRIMARY KEY,
  holder     TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

PRAGMA user_version = 36;

COMMIT;
`;
