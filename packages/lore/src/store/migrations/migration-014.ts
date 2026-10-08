/**
 * Migration 014 — rule/citation indexes (spec-baseline-slice-2-completeness-census-per-branch-citation
 * §C5): `rule_registry` gains `lifecycle` + `version`; new tables `ac_cites(doc_id, ac_id, rule_id)`,
 * `rule_depends(leaf_id, rule_id)` and `ac_exemptions`; all backfilled FROM THE DOCUMENTS here, and
 * kept in step afterwards by SQL triggers on `docs` (same statement, therefore same transaction, as
 * the source-doc write — identically on SQLite and Turso/libsql). SQL is an inlined string constant
 * so `bun build --compile` can bundle it without filesystem access (same reason as migration-013).
 *
 * Public surface: {@link MIGRATION_014_SQL}.
 *
 * Invariants:
 *   - Re-runnable on a migrated file with no error and no row change: `rule_registry` is rebuilt via
 *     `rule_registry_new` from its five original columns (present in both the 13 and 14 shapes), the
 *     index tables are `CREATE TABLE IF NOT EXISTS` and rebuilt from `docs`, triggers are DROP+CREATE
 *     (the triggers are dropped FIRST: SQLite refuses `RENAME TABLE` while a trigger names a table
 *     that does not exist at that instant).
 *   - `rule_registry.version` = the owning leaf doc's `version`; `lifecycle` = the rule's lifecycle in
 *     that leaf (`live` when the leaf lists no valid lifecycle for it). Rows are never deleted.
 *   - ⛔ A future migration that recreates `docs` (as 006 and 013 did) DROPS the `docs_idx_*` triggers
 *     with it and MUST re-create them: copy the trigger block from this file.
 *   - Triggers are defensive about JSON shape — `json_each` over a scalar, or `json_each` of a
 *     non-JSON text element, RAISES and would block EVERY write to that doc. Every array is guarded by
 *     `json_type(..) = 'array'` and every element by `json_each.type` BEFORE it is re-fed to another
 *     `json_each`.
 *   - `ac_cites` / `rule_depends` hold rows only for non-soft-deleted docs of type spec / baseline.
 *   - `ac_exemptions` is written only by the (later) exemption verb; reason, expiry and actor are all
 *     NOT NULL (spec C4: an exemption needs a reason, an expiry and an actor).
 *   - `PRAGMA user_version = 14` sits INSIDE the transaction so a ROLLBACK reverts it with the DDL.
 *
 * Side-effect class: schema DDL + data backfill (executed once per store).
 */

export const MIGRATION_014_SQL = `-- Migration: 014-registry-lifecycle-version-and-citation-indexes
-- Schema version: 14
-- See migration-014.ts's module JSDoc for the invariants this depends on.

BEGIN IMMEDIATE;

DROP TRIGGER IF EXISTS docs_idx_spec_ai;
DROP TRIGGER IF EXISTS docs_idx_spec_au;
DROP TRIGGER IF EXISTS docs_idx_baseline_ai;
DROP TRIGGER IF EXISTS docs_idx_baseline_au;

-- (1) rule_registry gains lifecycle + version -------------------------------------------------
DROP TABLE IF EXISTS rule_registry_new;

CREATE TABLE rule_registry_new (
  id           TEXT PRIMARY KEY,         -- 'BR-<n>'
  n            INTEGER NOT NULL UNIQUE,  -- strictly increasing, never reused
  leaf_doc_id  TEXT NOT NULL,            -- current owning leaf (NOT an FK, see migration-013.ts)
  allocated_at TEXT NOT NULL,            -- ISO 8601
  allocated_by TEXT NOT NULL,            -- actor identity
  lifecycle    TEXT NOT NULL DEFAULT 'live' CHECK(lifecycle IN ('live','deprecated','retired')),
  version      INTEGER NOT NULL DEFAULT 0 -- owning leaf doc's version
);

INSERT INTO rule_registry_new (id, n, leaf_doc_id, allocated_at, allocated_by)
  SELECT id, n, leaf_doc_id, allocated_at, allocated_by FROM rule_registry;

UPDATE rule_registry_new SET
  version = COALESCE((SELECT d.version FROM docs d WHERE d.id = rule_registry_new.leaf_doc_id), 0),
  lifecycle = COALESCE((
    SELECT json_extract(r.value, '$.lifecycle')
    FROM docs d,
         json_each(CASE WHEN json_type(d.extra, '$.rules') = 'array' THEN d.extra ELSE '{}' END, '$.rules') AS r
    WHERE d.id = rule_registry_new.leaf_doc_id
      AND r.type = 'object'
      AND json_extract(r.value, '$.id') = rule_registry_new.id
      AND json_extract(r.value, '$.lifecycle') IN ('live','deprecated','retired')
    LIMIT 1), 'live');

DROP TABLE rule_registry;
ALTER TABLE rule_registry_new RENAME TO rule_registry;

-- (2) citation / dependency / exemption tables --------------------------------------------------
CREATE TABLE IF NOT EXISTS ac_cites (
  doc_id  TEXT NOT NULL,   -- the citing spec doc id
  ac_id   TEXT NOT NULL,   -- the criterion id inside that spec
  rule_id TEXT NOT NULL,   -- the cited rule id 'BR-<n>'
  PRIMARY KEY (doc_id, ac_id, rule_id)
);
CREATE INDEX IF NOT EXISTS idx_ac_cites_rule ON ac_cites(rule_id);

CREATE TABLE IF NOT EXISTS rule_depends (
  leaf_id TEXT NOT NULL,   -- the depending baseline leaf doc id
  rule_id TEXT NOT NULL,   -- the rule id it depends on
  PRIMARY KEY (leaf_id, rule_id)
);
CREATE INDEX IF NOT EXISTS idx_rule_depends_rule ON rule_depends(rule_id);

CREATE TABLE IF NOT EXISTS ac_exemptions (
  doc_id     TEXT NOT NULL,
  ac_id      TEXT NOT NULL,
  reason     TEXT NOT NULL,
  expires_at TEXT NOT NULL,  -- ISO 8601
  granted_by TEXT NOT NULL,
  granted_at TEXT NOT NULL,  -- ISO 8601
  PRIMARY KEY (doc_id, ac_id)
);

-- (3) backfill FROM THE DOCUMENTS (rebuilt from scratch so a re-run is a no-op) -------------------
DELETE FROM ac_cites;
INSERT OR IGNORE INTO ac_cites (doc_id, ac_id, rule_id)
  SELECT d.id, json_extract(a.value, '$.id'), c.value
  FROM docs d,
       json_each(CASE WHEN json_type(d.extra, '$.acceptance_criteria') = 'array' THEN d.extra ELSE '{}' END, '$.acceptance_criteria') AS a,
       json_each(CASE WHEN a.type = 'object' AND json_type(a.value, '$.cites') = 'array' THEN a.value ELSE '{}' END, '$.cites') AS c
  WHERE d.type = 'spec' AND d.deleted_at IS NULL
    AND a.type = 'object' AND json_type(a.value, '$.id') = 'text' AND c.type = 'text';

DELETE FROM rule_depends;
INSERT OR IGNORE INTO rule_depends (leaf_id, rule_id)
  SELECT d.id, j.value
  FROM docs d,
       json_each(CASE WHEN json_type(d.extra, '$.depends_on') = 'array' THEN d.extra ELSE '{}' END, '$.depends_on') AS j
  WHERE d.type = 'baseline' AND d.deleted_at IS NULL AND j.type = 'text';

-- (4) same-transaction writers: triggers on docs --------------------------------------------------
CREATE TRIGGER docs_idx_spec_ai AFTER INSERT ON docs WHEN new.type = 'spec' AND new.deleted_at IS NULL
BEGIN
  INSERT OR IGNORE INTO ac_cites (doc_id, ac_id, rule_id)
    SELECT new.id, json_extract(a.value, '$.id'), c.value
    FROM json_each(CASE WHEN json_type(new.extra, '$.acceptance_criteria') = 'array' THEN new.extra ELSE '{}' END, '$.acceptance_criteria') AS a,
         json_each(CASE WHEN a.type = 'object' AND json_type(a.value, '$.cites') = 'array' THEN a.value ELSE '{}' END, '$.cites') AS c
    WHERE a.type = 'object' AND json_type(a.value, '$.id') = 'text' AND c.type = 'text';
END;

CREATE TRIGGER docs_idx_spec_au AFTER UPDATE ON docs WHEN new.type = 'spec' OR old.type = 'spec'
BEGIN
  DELETE FROM ac_cites WHERE doc_id = new.id;
  INSERT OR IGNORE INTO ac_cites (doc_id, ac_id, rule_id)
    SELECT new.id, json_extract(a.value, '$.id'), c.value
    FROM json_each(CASE WHEN json_type(new.extra, '$.acceptance_criteria') = 'array' THEN new.extra ELSE '{}' END, '$.acceptance_criteria') AS a,
         json_each(CASE WHEN a.type = 'object' AND json_type(a.value, '$.cites') = 'array' THEN a.value ELSE '{}' END, '$.cites') AS c
    WHERE new.type = 'spec' AND new.deleted_at IS NULL
      AND a.type = 'object' AND json_type(a.value, '$.id') = 'text' AND c.type = 'text';
END;

CREATE TRIGGER docs_idx_baseline_ai AFTER INSERT ON docs WHEN new.type = 'baseline'
BEGIN
  INSERT OR IGNORE INTO rule_depends (leaf_id, rule_id)
    SELECT new.id, j.value
    FROM json_each(CASE WHEN json_type(new.extra, '$.depends_on') = 'array' THEN new.extra ELSE '{}' END, '$.depends_on') AS j
    WHERE new.deleted_at IS NULL AND j.type = 'text';
  UPDATE rule_registry SET
    version = new.version,
    lifecycle = COALESCE((
      SELECT json_extract(r.value, '$.lifecycle')
      FROM json_each(CASE WHEN json_type(new.extra, '$.rules') = 'array' THEN new.extra ELSE '{}' END, '$.rules') AS r
      WHERE r.type = 'object' AND json_extract(r.value, '$.id') = rule_registry.id
        AND json_extract(r.value, '$.lifecycle') IN ('live','deprecated','retired')
      LIMIT 1), rule_registry.lifecycle)
  WHERE leaf_doc_id = new.id;
END;

CREATE TRIGGER docs_idx_baseline_au AFTER UPDATE ON docs WHEN new.type = 'baseline' OR old.type = 'baseline'
BEGIN
  DELETE FROM rule_depends WHERE leaf_id = new.id;
  INSERT OR IGNORE INTO rule_depends (leaf_id, rule_id)
    SELECT new.id, j.value
    FROM json_each(CASE WHEN json_type(new.extra, '$.depends_on') = 'array' THEN new.extra ELSE '{}' END, '$.depends_on') AS j
    WHERE new.type = 'baseline' AND new.deleted_at IS NULL AND j.type = 'text';
  UPDATE rule_registry SET
    version = new.version,
    lifecycle = COALESCE((
      SELECT json_extract(r.value, '$.lifecycle')
      FROM json_each(CASE WHEN json_type(new.extra, '$.rules') = 'array' THEN new.extra ELSE '{}' END, '$.rules') AS r
      WHERE r.type = 'object' AND json_extract(r.value, '$.id') = rule_registry.id
        AND json_extract(r.value, '$.lifecycle') IN ('live','deprecated','retired')
      LIMIT 1), rule_registry.lifecycle)
  WHERE leaf_doc_id = new.id AND new.type = 'baseline';
END;

PRAGMA user_version = 14;

COMMIT;
`;
