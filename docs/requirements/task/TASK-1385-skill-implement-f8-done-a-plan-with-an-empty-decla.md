---
id: TASK-1385
type: task
role: plan
title: "[Skill:implement] F8 done: a plan with an empty declared phase is not advised for archive"
status: archived
priority: critical
phase: "Phase 1: fixes"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-189
plan: PLAN-189
links:
  - {id: TASK-1381, type: blocks}
---
Estimate: S
Approach: per spec F8 — in computePlanNowFullyTerminal compare plan.extra.phases with member tasks' extra.phase (reuse the grouping in phase-workflow-service.ts:458 buildDeclaredPhaseScorecard); return {kind:'fully_terminal_with_empty_phases', empty_phases}; formatLastTaskAdvisory renders the empty phases, prints no archive command for that kind, and names how to close the gap ('lore phase rm <plan> <phase>' or add a task) to keep BR-211.
Source: spec F8; packages/lore/src/service/task-workflow-service.ts:4709-4746; packages/lore/src/adapters/cli/done-render.ts:64-71
Resolves: task-lore-done-tells-you-to-archive-a-plan-whose-declared
Dimensions: D-FUNC
Scope-Alt: none
Covers: AC-CRIT-11
AC:
- Given phases [A,B] and one task in A, When lore done archives it, Then the result names B as empty and the formatLastTaskAdvisory output has no '--status archived' and names 'lore phase rm <plan> B' or adding a task; with every phase populated and terminal, the archive advisory is still printed (AC-CRIT-11)
Integration: lore done CLI renders the service result via done-render.ts; the test asserts the CLI stderr, not only the service value.
