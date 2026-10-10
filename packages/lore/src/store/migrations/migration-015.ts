/**
 * Migration 015 — per-prefix rule ids (spec baseline-slice-3a, BR-979, owner decision D1):
 * `rule_registry` gains a `prefix` column (`BR` | `AS` | `AD`) and its uniqueness moves from
 * `n` alone to `(prefix, n)`, so business rules (`BR-n`), architecture standard rules (`AS-n`) and
 * architecture debt entries (`AD-n`) each count from 1 out of ONE never-reused registry.
 *
 * Public surface: {@link MIGRATION_015_SQL}.
 *
 * Invariants:
 *   - Every pre-existing row is a business rule: `prefix` defaults to `'BR'` and is backfilled from
 *     the id's own prefix (`substr(id, 1, instr(id, '-') - 1)`), so a re-run is a no-op.
 *   - `id` stays the PRIMARY KEY and `n` stays strictly increasing PER PREFIX, never reused: rows are
 *     never deleted. Allocation reads `MAX(n) WHERE prefix = ?` INSIDE its write transaction.
 *   - ⛔ SQLite cannot drop the column-level `UNIQUE` on `n`, so the table is rebuilt via
 *     `rule_registry_new` (same shape as migration-014). The `docs_idx_*` triggers name
 *     `rule_registry`, and SQLite refuses `RENAME TABLE` while a trigger names a table that does not
 *     exist at that instant: they are dropped first and re-created from the one shared definition
 *     ({@link DOCS_IDX_TRIGGERS_SQL}) at the end.
 *   - `PRAGMA user_version = 15` sits INSIDE the transaction so a ROLLBACK reverts it with the DDL.
 *
 * Side-effect class: schema DDL + data copy (executed once per store).
 */
import { DOCS_IDX_TRIGGERS_SQL } from "./migration-014.js";

export const MIGRATION_015_SQL = `-- Migration: 015-rule-registry-prefix
-- Schema version: 15
-- See migration-015.ts's module JSDoc for the invariants this depends on.

BEGIN IMMEDIATE;

DROP TRIGGER IF EXISTS docs_idx_spec_ai;
DROP TRIGGER IF EXISTS docs_idx_spec_au;
DROP TRIGGER IF EXISTS docs_idx_baseline_ai;
DROP TRIGGER IF EXISTS docs_idx_baseline_au;

DROP TABLE IF EXISTS rule_registry_new;

CREATE TABLE rule_registry_new (
  id           TEXT PRIMARY KEY,         -- '<prefix>-<n>'
  prefix       TEXT NOT NULL DEFAULT 'BR' CHECK(prefix IN ('BR','AS','AD')),
  n            INTEGER NOT NULL,         -- strictly increasing per prefix, never reused
  leaf_doc_id  TEXT NOT NULL,            -- current owning node (NOT an FK, see migration-013.ts)
  allocated_at TEXT NOT NULL,            -- ISO 8601
  allocated_by TEXT NOT NULL,            -- actor identity
  lifecycle    TEXT NOT NULL DEFAULT 'live' CHECK(lifecycle IN ('live','deprecated','retired')),
  version      INTEGER NOT NULL DEFAULT 0, -- owning node doc's version
  UNIQUE (prefix, n)
);

INSERT INTO rule_registry_new (id, prefix, n, leaf_doc_id, allocated_at, allocated_by, lifecycle, version)
  SELECT id, substr(id, 1, instr(id, '-') - 1), n, leaf_doc_id, allocated_at, allocated_by, lifecycle, version
  FROM rule_registry;

DROP TABLE rule_registry;
ALTER TABLE rule_registry_new RENAME TO rule_registry;

${DOCS_IDX_TRIGGERS_SQL}
PRAGMA user_version = 15;

COMMIT;
`;
