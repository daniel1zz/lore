/**
 * Migration 035 — backfill `extra.progress` on every existing plan
 * (spec-plans-close-themselves-level-triggered-reconciliation-of, AC-PCR-2; BR-1379).
 * SQL is an inlined string constant so `bun build --compile` can bundle it without filesystem access.
 *
 * Public surface: {@link MIGRATION_035_SQL}.
 *
 * Invariants:
 *   - After this migration no plan lacks `extra.progress = {state, open, total, at}`: the write path keeps it current
 *     from then on, so there is no standing recompute command and no reader handles a missing value.
 *   - Membership is the one rule of `store/plan-progress.ts`: a plan's non-deleted tasks (`extra.plan_id`) plus its
 *     non-deleted `phase` docs (`parent_id`); `open` excludes `archived` / `deprecated` members; `empty` = no member.
 *   - The backfill is a derived-value write: no version row (a version row needs its audit row, whose hash chain only
 *     the stores can compute), so the plan's version is unchanged. It overwrites any existing `progress`, which makes
 *     a re-run idempotent in effect.
 *   - One BEGIN/COMMIT together with `PRAGMA user_version = 35`.
 *
 * Side-effect class: schema DML (executed once per store).
 */

/** The member rows of the plan being updated, as a correlated predicate over alias `m`. */
const MEMBER_OF_PLAN =
  "m.deleted_at IS NULL AND ((m.type = 'task' AND json_extract(m.extra, '$.plan_id') = docs.id) OR (m.type = 'phase' AND m.parent_id = docs.id))";

const TOTAL = `(SELECT COUNT(*) FROM docs m WHERE ${MEMBER_OF_PLAN})`;
const OPEN = `(SELECT COUNT(*) FROM docs m WHERE ${MEMBER_OF_PLAN} AND m.status NOT IN ('archived', 'deprecated'))`;

export const MIGRATION_035_SQL = `-- Migration: 035-plan-progress-backfill
-- Schema version: 35

BEGIN IMMEDIATE;

UPDATE docs
SET extra = json_set(
  COALESCE(extra, '{}'),
  '$.progress',
  json_object(
    'state', CASE WHEN ${TOTAL} = 0 THEN 'empty' WHEN ${OPEN} = 0 THEN 'complete' ELSE 'in-progress' END,
    'open', ${OPEN},
    'total', ${TOTAL},
    'at', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
)
WHERE type = 'plan' AND deleted_at IS NULL;

PRAGMA user_version = 35;

COMMIT;
`;
