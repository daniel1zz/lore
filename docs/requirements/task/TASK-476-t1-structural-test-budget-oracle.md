---
id: TASK-476
type: task
role: plan
title: "T1 structural test-budget oracle"
status: archived
priority: medium
created: 2026-07-31
updated: 2026-08-01
tags: []
parent: PLAN-097
plan: PLAN-097
links:
  - {id: TASK-485, type: blocks}
---
## Task

Covers AC-TB-1, AC-TB-2, AC-TB-3, AC-TB-5. Add scripts/check-test-budgets.ts plus the check:test-budgets package.json script. It counts direct spawn-helper invocations per test body; at or above 3 it requires an explicit timeout argument of any value. It judges DECLARATION, never the number. An unparseable file exits non-zero naming the path — never a silent skip.
