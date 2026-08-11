---
id: TASK-392
type: task
role: plan
title: "Eight more plan-member queries still key on parent_id instead of extra.plan_id — two of them gate task-claim and drive plan-close archival, so the membership error changes writes, not just displays"
status: archived
priority: high
created: 2026-08-02
updated: 2026-08-03
tags: []
parent: PRD-001
links:
  - {id: TASK-397, type: relates-to}
  - {id: ADR-028, type: relates-to}
---
Follow-up to `task-plan-membership-is-extra-plan-id-but-the-last-task` (merged `4168b1c`), which
fixed the two call sites it named plus the phase tier's legacy-task query. Its implementer grepped
the whole service layer and FOUND eight more queries with the identical shape, correctly did not
touch them (out of anchor), and reported them. Filed so the sweep is not lost.

## The eight sites (reported by the implementer, not yet independently re-verified)

| file | site | what it feeds |
|---|---|---|
| `packages/lore/src/service/ac-service.ts` | `:482` `findTasksUnderPlans` | AC-coverage aggregation across a spec's child plans |
| `packages/lore/src/service/corpus-service.ts` | `:2401` `cascadeArchiveOnPlanClose` | plan-close cascade task archival |
| `packages/lore/src/service/corpus-service.ts` | `:2895` `getPlanBundle` | the assess/judge bundle AND the `task-claim` gate |
| `packages/lore/src/service/corpus-service.ts` | `:3083` | assessment-freshness-adjacent task lookup |
| `packages/lore/src/service/verification-projection-service.ts` | `:90` `evidencePanel` | dashboard projection |
| `packages/lore/src/service/phase-service.ts` | `:366` `allChildrenResult` | phase add/migrate validation |
| `packages/lore/src/service/outline-service.ts` | `:827` | MDX `ActivePlans` / `ChildrenOf` resolution |
| `packages/lore/src/service/session-service.ts` | `:766` | bootstrap active-plan task listing |

⛔ Line numbers are from the pre-merge tree and WILL drift. Re-grep rather than trusting them:
`findMany({ parent_id` combined with `type: "task"`.

## Why this is not a mechanical sweep

`lore create task --plan-id P --parent Q` with the two differing is a SUPPORTED shape
(`commands/create.ts:7-10`, SPEC-065 D4), so `parent_id` and `extra.plan_id` legitimately diverge
and every one of these queries silently drops or misattributes a diverged member. But the
CONSEQUENCE differs per site, and two of them are not merely cosmetic:

- **`getPlanBundle` (`:2895`) feeds the `task-claim` gate.** A membership error there changes which
  writes are allowed, not just what is displayed.
- **`cascadeArchiveOnPlanClose` (`:2401`) archives documents.** Getting membership wrong here either
  archives a non-member or silently strands a real member as the plan closes.

The remaining six are read/projection paths where the failure is a wrong number or a missing row.
Fix all eight, but treat those two as the ones needing their own dedicated RED tests.

## Proxy / Silence / Opt-in

- **Proxy** — same as the parent task, and it CLOSES the same way: `extra.plan_id` IS the property,
  `parent_id` is the proxy. The parent task established there is no input satisfying
  `extra.plan_id === P` while not being a member of P. Nothing new to accept here.
- **Silence** — this is the interesting part and it differs per site. The parent task added a
  `plan_membership_disagreement` value so the two-query contradiction is REPORTED rather than
  silently resolved. Decide per site whether the same disagreement signal is warranted or whether
  the site can simply read the right field: ⛔ do NOT let a site silently return the smaller set. In
  particular `cascadeArchiveOnPlanClose` must not silently skip a member it should archive.
- **Opt-in** — none of these are opt-in; all run unconditionally. That is why the defect is uniform.

## Required

- Re-grep first and publish the ACTUAL list you find — the table above is a report, not a
  verification, and the parent task's own line numbers had already drifted by the time it landed.
- Reuse the parent's `isPlanMember(task, planId)` predicate rather than re-implementing the check
  eight times. ⛔ Eight independent copies of a membership rule is how the next divergence hides.
  If it must move to a shared module for cross-service reuse, say where and why.
- Note the parent's fix replaced a `parent_id`-scoped query with a corpus-wide
  `findMany({ type: "task" })` plus an in-memory predicate. Confirm that shape is acceptable at each
  of these sites (especially the dashboard projection and bootstrap paths, which run often), or
  choose a store-level filter — and state the choice.

## Oracle

- RED first, per site: construct case H from the parent task (T6 with `parent_id = P4`,
  `extra.plan_id = P3`, so T6 belongs to P3) and assert each site's output currently misattributes
  or drops it. Report the actual pre-fix failure for every site — a sweep with one shared test is
  not evidence that eight sites were fixed.
- CONTROL per site: a plan whose tasks all have `parent_id === extra.plan_id` produces a
  byte-identical result to today's.
- CONTROL: `--adhoc` tasks (no `plan_id`, parented to the root PRD) stay excluded everywhere.
- CONTROL, dedicated: the `task-claim` gate's decision for a diverged member is asserted directly,
  not inferred from `getPlanBundle`'s return shape.
- CONTROL, dedicated: `cascadeArchiveOnPlanClose` archives exactly the plan's real members —
  assert both directions (no non-member archived, no member stranded).
- CONTROL: the parent task's own suite stays green — `packages/lore/tests/unit/service/task-workflow-plan-membership.test.ts`.
