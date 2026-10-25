/**
 * Migration 037 — `known-defect` link type (#404): a plan accepted with known defects links its defect issues with
 * `known-defect`, never `resolves`, so archiving the plan no longer closes them.
 * SQL is an inlined string constant so `bun build --compile` can bundle it without filesystem access.
 *
 * Public surface: {@link MIGRATION_037_SQL}.
 *
 * Invariants:
 *   - `links.link_type`'s CHECK is widened to admit 'known-defect' by a table recreate (same shape as migration-012),
 *     inside ONE BEGIN/COMMIT together with `PRAGMA user_version = 37`; `DROP TABLE IF EXISTS links_new` first keeps a
 *     retry after an aborted attempt idempotent.
 *   - The same INSERT..SELECT converts ONLY batch links: a `resolves` link whose FROM is a plan and whose TO carries a
 *     non-empty array `extra.milestone_findings` becomes `known-defect`. A hand `resolves` link (no record), a
 *     non-array record, and a `resolves` link from a task/spec are copied unchanged. No reader handles both shapes.
 *   - Every other column, the primary key and the three link indexes are preserved.
 *
 * Side-effect class: schema DDL + data rewrite (executed once per store).
 *
 * Source: task-r1-known-defects-use-their-own-link-type-archiving-never.
 */

export const MIGRATION_037_SQL = `-- Migration: 037-known-defect-link-type
-- Schema version: 37

BEGIN IMMEDIATE;

DROP TABLE IF EXISTS links_new;

CREATE TABLE links_new (
  from_id     TEXT NOT NULL REFERENCES docs(id),
  to_id       TEXT NOT NULL REFERENCES docs(id),
  link_type   TEXT NOT NULL CHECK(link_type IN ('parent','implements','informs','supersedes','relates-to','blocks','governs','resolves','known-defect')),
  created_at  TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  PRIMARY KEY (from_id, to_id, link_type)
);

INSERT INTO links_new (from_id, to_id, link_type, created_at, created_by)
  SELECT
    l.from_id,
    l.to_id,
    CASE
      WHEN l.link_type = 'resolves'
        AND EXISTS (SELECT 1 FROM docs p WHERE p.id = l.from_id AND p.type = 'plan')
        AND EXISTS (
          SELECT 1 FROM docs i
          WHERE i.id = l.to_id
            AND json_valid(i.extra)
            AND json_type(i.extra, '$.milestone_findings') = 'array'
            AND json_array_length(i.extra, '$.milestone_findings') > 0
        )
      THEN 'known-defect'
      ELSE l.link_type
    END,
    l.created_at,
    l.created_by
  FROM links l;

DROP TABLE links;

ALTER TABLE links_new RENAME TO links;

CREATE INDEX idx_links_from ON links(from_id);
CREATE INDEX idx_links_to   ON links(to_id);
CREATE INDEX idx_links_type ON links(link_type);

PRAGMA user_version = 37;

COMMIT;
`;
