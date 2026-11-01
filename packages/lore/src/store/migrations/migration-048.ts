/**
 * Migration 048 — judging a templated document per template dimension, and the single pending revision of a template
 * (spec-every-document-is-stored-as-structured-fields-validated-by, Scope "Judge" and "Template growth"; BR-1530).
 * SQL is an inlined string constant so `bun build --compile` can bundle it without filesystem access.
 *
 * Public surface: {@link MIGRATION_048_ADD_COLUMNS}, {@link MIGRATION_048_SQL}.
 *
 * Tables / columns:
 *   - `review_judgments.template_ref` (nullable TEXT, `slug@version`) and `review_judgments.missing_dimensions`
 *     (nullable JSON TEXT, the judge's missing_dimension findings). NULL = a legacy-document judgment (v1-v8) / none.
 *   - `review_judgment_dimensions`: one row per (judgment, dimension) with verdict pass|fail|unclear, reason, evidence.
 *   - `template_revisions`: one row per template revision; at most ONE `pending` row per `template_slug` (partial unique
 *     index), so a second pending revision for a template is refused by the database, not just by the service.
 *   - `template_proposals`: one row per proposed dimension of a revision; `decision` / `dimension_id` / `drop_reason` are
 *     NULL until the revision is approved (CHECK keeps the three consistent: accepted needs a dimension id, dropped a reason).
 *   - `template_proposal_findings`: one row per finding that named a proposal; a proposal's count is the number of these
 *     rows, so "the same gap again" is an INSERT (no read-modify-write counter to race on).
 *
 * Invariants:
 *   - Same two-phase shape as migration-019 (SQLite has no `ADD COLUMN IF NOT EXISTS`): the calling store applies
 *     {@link MIGRATION_048_ADD_COLUMNS} only where `PRAGMA table_info` lacks the column, then runs {@link MIGRATION_048_SQL}
 *     (`IF NOT EXISTS` everywhere; `PRAGMA user_version = 48` inside one BEGIN/COMMIT; re-runnable).
 *   - No existing row is changed.
 *
 * Side-effect class: schema DDL (executed once per store).
 */

/** Phase 1 — nullable columns on `review_judgments`, applied only where missing. */
export const MIGRATION_048_ADD_COLUMNS: readonly { table: string; column: string; ddl: string }[] = [
  { table: "review_judgments", column: "template_ref", ddl: "ALTER TABLE review_judgments ADD COLUMN template_ref TEXT" },
  { table: "review_judgments", column: "missing_dimensions", ddl: "ALTER TABLE review_judgments ADD COLUMN missing_dimensions TEXT" },
];

/** Phase 2 — the tables and the version bump. */
export const MIGRATION_048_SQL = `-- Migration: 048-judge-per-dimension
-- Schema version: 48

BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS review_judgment_dimensions (
  judgment_id  TEXT NOT NULL REFERENCES review_judgments(id),
  dimension_id TEXT NOT NULL,
  verdict      TEXT NOT NULL CHECK (verdict IN ('pass', 'fail', 'unclear')),
  reason       TEXT NOT NULL,
  evidence     TEXT NOT NULL,
  PRIMARY KEY (judgment_id, dimension_id)
);

CREATE TABLE IF NOT EXISTS template_revisions (
  id            TEXT PRIMARY KEY,
  template_slug TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('pending', 'approved')),
  base_version  INTEGER NOT NULL CHECK (base_version >= 1),
  created_at    TEXT NOT NULL,
  resolved_at   TEXT,
  resolved_by   TEXT,
  CHECK ((status = 'pending' AND resolved_at IS NULL) OR (status = 'approved' AND resolved_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_template_revisions_one_pending
  ON template_revisions (template_slug) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS template_proposals (
  id           TEXT PRIMARY KEY,
  revision_id  TEXT NOT NULL REFERENCES template_revisions(id),
  question     TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  decision     TEXT CHECK (decision IN ('accepted', 'dropped')),
  dimension_id TEXT,
  drop_reason  TEXT,
  CHECK (
    (decision IS NULL AND dimension_id IS NULL AND drop_reason IS NULL) OR
    (decision = 'accepted' AND dimension_id IS NOT NULL AND drop_reason IS NULL) OR
    (decision = 'dropped' AND dimension_id IS NULL AND drop_reason IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_template_proposals_revision ON template_proposals (revision_id, created_at, id);

CREATE TABLE IF NOT EXISTS template_proposal_findings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_id TEXT NOT NULL REFERENCES template_proposals(id),
  judgment_id TEXT NOT NULL REFERENCES review_judgments(id),
  reason      TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_template_proposal_findings_proposal ON template_proposal_findings (proposal_id, id);

PRAGMA user_version = 48;

COMMIT;
`;
