---
id: TASK-562
type: task
role: plan
title: "[Skill:implement] lore done last-task advisory + service result fact"
status: archived
priority: critical
phase: "Phase 2: Loud side effects"
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PLAN-111
plan: PLAN-111
---
Estimate: M
Approach: (a) packages/lore/src/service/task-workflow-service.ts — `_doneImpl` (lines ~1023-1104) already archives the task; after a successful walk, determine whether the task's plan now has zero non-terminal child tasks and, if so, add `plan_now_fully_terminal: { plan_slug }` to `DoneResult`. The service performs NO plan write. (b) packages/lore/src/adapters/cli/commands/done.ts — when that field is present, write a stderr advisory naming the plan slug and the literal command `lore set <plan> --status archived`, stating the plan-close gate will evaluate it. Follow the precedent in packages/lore/src/adapters/cli/utils.ts::resolveActorWithIdentitySource (stderr, ⚠ prefix, actionable text) but WITHOUT the once-per-process guard — this is per-plan-completion and rare.
Source: spec DD-2; explorer fact sheet (done.ts lines 61-108, _doneImpl 1023-1104, advisory precedent utils.ts 533-548)
Dimensions: D-FUNC, D-UX
Scope-Alt: none
Covers: AC-CLOSURE-3

AC:
- Given a plan whose LAST non-terminal task is archived via `lore done`, When the command runs, Then stderr contains the plan slug AND the literal string `--status archived`; stdout's normal success output is unchanged.
- Given `lore done` on a task that is NOT the last non-terminal one, Then no such advisory appears on stderr.
- Given either case, Then the plan doc's status and version are UNCHANGED (assert before/after — this is Invariant 1 of the plan).
- Given an adhoc/planless task, When done runs, Then no advisory and no crash.
- `bun run typecheck` exit 0.
