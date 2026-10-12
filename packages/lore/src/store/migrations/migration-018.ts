/**
 * Migration 018 — rule registry state `proposed` (spec-a-spec-carries-its-rule-changes-the-baseline-takes-them,
 * Model): `rule_registry.lifecycle` may now also be `'proposed'` — an id a spec's change set has reserved that is
 * NOT in the tree yet. SQL is an inlined string constant so `bun build --compile` can bundle it without
 * filesystem access (same reason as migration-013/014/015).
 *
 * Public surface: {@link MIGRATION_018_SQL}.
 *
 * Invariants:
 *   - ⛔ SQLite cannot alter a column CHECK, so the table is rebuilt via `rule_registry_new`, exactly as
 *     migration-015 did. The `docs_idx_*` triggers name `rule_registry`, and SQLite refuses `RENAME TABLE` while
 *     a trigger names a table that does not exist at that instant: they are dropped first and re-created from
 *     the one shared definition ({@link DOCS_IDX_TRIGGERS_SQL}) at the end.
 *   - Every pre-existing row is copied unchanged (id, prefix, n, owner, allocation facts, lifecycle, version);
 *     rows are never deleted and `UNIQUE (prefix, n)` stays, so an id stays burned. Re-running is a no-op.
 *   - The `docs_idx_baseline_*` triggers only ever rewrite a registry row's lifecycle from a leaf that LISTS the
 *     rule, and only to live/deprecated/retired: a `proposed` row (listed by no leaf) keeps its state until the
 *     landing writer flips it in the same transaction as the leaf write.
 *   - `PRAGMA user_version = 18` sits INSIDE the transaction so a ROLLBACK reverts it with the DDL.
 *
 * Side-effect class: schema DDL + data copy (executed once per store).
 */
import { DOCS_IDX_TRIGGERS_SQL } from "./migration-014.js";

export const MIGRATION_018_SQL = `-- Migration: 018-rule-registry-proposed
-- Schema version: 18
-- See migration-018.ts's module JSDoc for the invariants this depends on.

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
  leaf_doc_id  TEXT NOT NULL,            -- current owning node (a proposed id: the leaf it will land on); NOT an FK
  allocated_at TEXT NOT NULL,            -- ISO 8601
  allocated_by TEXT NOT NULL,            -- actor identity
  lifecycle    TEXT NOT NULL DEFAULT 'live' CHECK(lifecycle IN ('live','deprecated','retired','proposed')),
  version      INTEGER NOT NULL DEFAULT 0, -- owning node doc's version
  UNIQUE (prefix, n)
);

INSERT INTO rule_registry_new (id, prefix, n, leaf_doc_id, allocated_at, allocated_by, lifecycle, version)
  SELECT id, prefix, n, leaf_doc_id, allocated_at, allocated_by, lifecycle, version
  FROM rule_registry;

DROP TABLE rule_registry;
ALTER TABLE rule_registry_new RENAME TO rule_registry;

${DOCS_IDX_TRIGGERS_SQL}
PRAGMA user_version = 18;

COMMIT;
`;
