---
id: TASK-1135
type: task
role: plan
title: "RED: AC-BLS2-19 test for exempted uncited criteria under enforce (#105)"
status: archived
priority: medium
phase: "fix"
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PLAN-175
plan: PLAN-175
links:
  - {id: TASK-1134, type: blocks}
---
Tester in a worktree writes packages/lore/tests/unit/service/cite-gate-exemption.bun.test.ts (describe 'cite gate admits exempted uncited criteria (#105)') per AC-BLS2-19. Exempted-removal case must be RED on main; refusal cases green. Record --result expected-fail evidence at the red moment. Estimate: S
