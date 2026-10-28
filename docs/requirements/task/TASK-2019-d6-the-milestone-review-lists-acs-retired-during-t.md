---
id: TASK-2019
type: task
role: plan
title: "D6 the milestone review lists ACs retired during the plan for one owner confirmation"
status: archived
priority: medium
phase: "D"
created: 2026-10-23
updated: 2026-10-26
tags: []
parent: PLAN-211
plan: PLAN-211
links:
  - {id: TASK-2021, type: blocks}
  - {id: TASK-2023, type: blocks}
---
Implements adr-an-acceptance-criterion-retires-with-the-feature-it: the plan's milestone review lists every AC retired during the plan, for one owner confirmation.

1. `lore assess <plan>...` adds a "retired ACs" section to each plan's review. It lists every AC that one of the plan's tasks superseded, or that belongs to a spec deprecated while the plan was open (from the audit trail, by actor run or task), with its reason and its superseding AC.
2. When the batch has any retired AC, `lore assess` raises one pending owner decision per plan, listing them. That decision is asked in-session through `lore pending --ask`.
3. Plan close waits for that decision. Accept confirms the retirements. Reject restores the listed ACs: superseded_by is cleared and deprecated specs go back to their previous status, the restore is recorded, and the close stays refused until they are re-planned.

Tests: a plan with 2 retired ACs leads to 1 pending decision. Accept lets the plan close. Reject restores both ACs and refuses the close. A plan with no retired ACs raises no decision.
