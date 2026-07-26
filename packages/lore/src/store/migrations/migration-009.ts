/**
 * Migration 009 — tamper-evident audit hash chain (SPEC-079 G3). SQL is
 * inlined as string constants so `bun build --compile` can bundle them
 * without requiring filesystem access to `.sql` files at runtime. Never edit
 * migration-001..008 in place — this is a NEW migration, additive only.
 *
 * ## Why this is a two-phase sequence, not one self-contained SQL string
 *
 * Mirrors migration-007/008's ADD COLUMN + JS backfill split: chaining the
 * `audit` table requires computing each row's sha256 `entry_hash`
 * (`computeAuditEntryHash`, `store-shared.ts`) over a canonical JSON
 * serialization — a JS-level transform SQLite has no built-in equivalent
 * for. The migration is therefore:
 *
 *   1. {@link MIGRATION_009_ADD_COLUMNS_SQL} — `ALTER TABLE audit ADD COLUMN`
 *      × 2, both nullable (mirrors migration-007's single nullable
 *      `versions.slug` column — a plain `ADD COLUMN`, not migration-004/006's
 *      table-recreate dance, which was only forced by a widened CHECK
 *      constraint).
 *   2. The calling store SELECTs every `audit` row in `id ASC` order,
 *      threads a running `prevHash` (starting at `""` for the genesis row)
 *      through `computeAuditEntryHash`, and UPDATEs `prev_hash`/`entry_hash`
 *      back per row — this loop cannot be expressed as a SQL string.
 *   3. {@link MIGRATION_009_FINALIZE_SQL} — bumps `PRAGMA user_version = 9`.
 *
 * @invariant Neither SQL fragment contains its own `BEGIN`/`COMMIT` — same
 *   reasoning as migration-008: transaction ownership sits with the CALLING
 *   store code (`sqlite-store.ts::runMigrations` / `turso-store.ts::initSchema`),
 *   because phase 2 (JS backfill) must run INSIDE the same transaction as
 *   phases 1 and 3. Wrapping all three phases in ONE `BEGIN IMMEDIATE`/
 *   `COMMIT` means a crash anywhere in the sequence leaves `user_version` at
 *   8 with NEITHER new column durably present — a clean restart from
 *   scratch, never a half-chained table.
 * @invariant Rows are processed in `id ASC` order — the audit table's own
 *   `INTEGER PRIMARY KEY AUTOINCREMENT` insertion order, which is also the
 *   order every future `appendAuditEntrySync`/`appendAuditEntryTx` extends
 *   the chain in (`ORDER BY id DESC LIMIT 1` reads exactly the tail of this
 *   same order) and the order {@link StoreInterface.listAuditChain} reads
 *   rows back in for `lore audit --verify`'s chain walk (a separate task).
 * @invariant This migration IS the trust anchor (SPEC-079 D4): the backfill
 *   trusts whatever `timestamp`/`actor`/`session_id`/`action`/`doc_id`/
 *   `details` values already sit in each pre-existing row — tampering with
 *   audit history BEFORE this migration ran is explicitly NOT detectable by
 *   the resulting chain. This is a documented, accepted limitation, not a
 *   defect: `lore audit --verify` (and the `lore audit anchor` git-tracked
 *   snapshot, a later task) can only attest to integrity FROM this point
 *   forward.
 * @invariant An empty `audit` table (a brand-new `lore init` corpus that has
 *   never written an audit row before this migration runs) backfills zero
 *   rows and leaves the chain trivially empty/consistent — the FIRST row
 *   ever inserted afterward (via the now-chain-aware `appendAuditEntrySync`/
 *   `appendAuditEntryTx`) reads back an empty head and correctly starts its
 *   own genesis (`prev_hash = ""`).
 */

export const MIGRATION_009_ADD_COLUMNS_SQL = `-- Migration: 009-audit-hash-chain (phase 1 of 3)
-- Adds the two nullable hash-chain columns migration-009's JS backfill loop
-- (phase 2, run by the calling store) populates for every existing row
-- before phase 3 bumps the schema version.

ALTER TABLE audit ADD COLUMN prev_hash TEXT;
ALTER TABLE audit ADD COLUMN entry_hash TEXT;
`;

export const MIGRATION_009_FINALIZE_SQL = `-- Migration: 009-audit-hash-chain (phase 3 of 3)
-- Schema version: 9
-- Runs AFTER phase 2 (JS backfill) has populated prev_hash/entry_hash for
-- every existing audit row.

PRAGMA user_version = 9;
`;
