---
id: TASK-560
type: task
role: plan
title: "[Skill:test] done last-task advisory RED scenarios"
status: archived
priority: high
phase: "Phase 2: Loud side effects"
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PLAN-111
plan: PLAN-111
links:
  - {id: TASK-562, type: blocks}
---
Estimate: S
Source: AC of the paired impl task (done advisory), spec DD-2
TDD-Role: red | Paired-Impl: done last-task advisory
Dimensions: D-FUNC

Scenarios (packages/lore/tests/unit/cli/done-command.test.ts — extend; vitest runner; group name MUST contain "last non-terminal task" so the AC -t filter matches):
- HAPPY: last non-terminal task archived → stderr contains the plan slug and the literal `--status archived`.
- NEGATIVE: a non-last task archived → stderr contains no such advisory.
- STATE: in BOTH cases the plan doc's status and version are identical before and after (no plan write).
- BOUNDARY: adhoc/planless task → no advisory, no throw.
- ERROR: a plan whose other tasks are `deprecated` (terminal) counts as fully terminal → advisory fires.

AC:
- All scenarios executable; run → RED with "missing implementation" reasons.
- Matched count for the `-t` filter asserted > 0.
