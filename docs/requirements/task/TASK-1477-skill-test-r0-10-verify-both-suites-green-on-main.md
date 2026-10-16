---
id: TASK-1477
type: task
role: plan
title: "[Skill:test] R0-10 verify both suites green on main"
status: archived
priority: critical
phase: "Phase 2: verify on main"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-200
plan: PLAN-200
---
Estimate: M
Approach: orchestrator on main after the last merge: bun run build; bun run test:vitest; bun run test:bun (exit codes without a pipe); lore verify the plan; any NEW red not in the spec's list is traced to its merge or to a concurrent session's merge.
Covers: AC-R0-1, AC-R0-2, AC-R0-3, AC-R0-4, AC-R0-5
AC:
- AC-R0-1..5 pass via lore verify on main
