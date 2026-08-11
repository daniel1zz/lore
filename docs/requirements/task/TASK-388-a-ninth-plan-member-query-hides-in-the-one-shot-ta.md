---
id: TASK-388
type: task
role: plan
title: "A ninth plan-member query hides in the one-shot task→phase migration, where a dropped member cannot be recovered by a second run — plus one comment this sweep made stale and one orthogonal parent_id dependence to settle"
status: archived
priority: medium
created: 2026-08-03
updated: 2026-08-03
tags: []
parent: PRD-001
links:
  - {id: TASK-392, type: relates-to}
  - {id: TASK-397, type: relates-to}
  - {id: ADR-028, type: relates-to}
---
Three residuals reported by the implementer of
`task-eight-more-plan-member-queries-still-key-on-parent-id` (merged `de53eb0`), all correctly left
untouched as out-of-anchor. Filed together because they are one sweep's tail, not three unrelated
items.

## 1. The ninth site (the actual defect)

`packages/lore/src/service/phase-migration-service.ts:234` — `PhaseMigrationService.migrateTasks`,
backing the one-shot `lore migrate tasks-to-phases`, carries the identical
`findMany({ parent_id: plan.id, type: "task" })` shape. It was in neither the original report nor
the sweep's anchors; the implementer found it by re-grepping rather than trusting the list, which is
exactly why AC 1 demanded a fresh grep.

⛔ Consequence is migration-specific and worth stating: a diverged member (`parent_id = P4`,
`extra.plan_id = P3`) is invisible to P3's migration and would be silently left un-migrated, or
migrated under the wrong plan. A one-shot migration that drops rows is worse than a read path that
does — there is no second run to correct it.

## 2. A doc comment this sweep made stale

`packages/core/src/archive-candidates.ts` — `computePlanCloseCascadeTargets`'s comment still says its
input is "filtered by the CALLER via `parent_id === plan.id`". The caller now filters via
`isPlanMember`. The code is correct; the comment describes the pre-`de53eb0` contract and will
mislead the next reader into re-introducing the `parent_id` shape.

## 3. An orthogonal `parent_id` dependence, deliberately not swept

`phase-service.ts` / `corpus-service.ts` create-time phase validation (`_createImpl` / `set()`)
validates a task's `extra.phase` against the plan resolved from its `parent_id`, not from
`extra.plan_id`. The implementer judged this a separate design decision rather than part of the
membership defect, and did not change it. That judgement is probably right — but it now sits directly
beside a `findTasksByPhase` that IS membership-based, so the two disagree about which plan a task
belongs to for phase purposes. Decide explicitly: either it is intentional (write down why, next to
the code) or it is the tenth site.

## Proxy / Silence / Opt-in

- **Proxy** — items 1 and 3 are the same `parent_id`-as-membership-proxy already settled by the parent
  tasks: `extra.plan_id` is the property. Nothing new to accept.
- **Silence** — item 1's silence is the most dangerous of the family so far: a migration that skips a
  member reports success and cannot be re-run. Whatever the fix, a member the migration DECLINED to
  move must be named in its output, not merely absent from it.
- **Opt-in** — none of the three is opt-in.

## Required

- Fix site 9 with the shared `isPlanMember` from `packages/lore/src/service/plan-membership.ts` —
  ⛔ do NOT add a fourth private copy of the predicate. Note `task-workflow-service.ts` and
  `phase-workflow-service.ts` still carry their own byte-identical private copies; consolidating all
  of them onto the shared module is a named follow-up the sweep could not perform (both files were
  off-limits). Do it here if both files are free when you claim this.
- Correct the `archive-candidates.ts` comment to describe the current contract.
- Settle item 3 in writing, in the code, either way.

## Oracle

- RED first: construct case H (T6 with `parent_id = P4`, `extra.plan_id = P3`) and assert
  `migrateTasks` for P3 currently omits T6. Report the actual failure text. ⛔ Confirm your edit
  landed with a non-empty `git diff` before trusting any RED/GREEN result.
- CONTROL: a plan whose tasks all have `parent_id === extra.plan_id` migrates byte-identically.
- CONTROL: `--adhoc` tasks stay excluded.
- CONTROL: the sweep's suites stay green — `eight-more-plan-member-queries.test.ts`,
  `plan-bundle-task-claim-gate-plan-membership.test.ts`,
  `plan-close-cascade-plan-membership.test.ts`, `task-workflow-plan-membership.test.ts`.
- If you consolidate the private copies: assert by deletion that no private copy remains —
  `grep -c "function isPlanMember" packages/lore/src/service/*.ts` must report exactly one file.
