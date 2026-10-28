---
id: TASK-1946
type: task
role: plan
title: "lore land, main route: integrate, verify, archive and clean the worktree in one command (AC-LND-2)"
status: deprecated
priority: high
phase: "P3 Land, dispatch, log, drift"
created: 2026-10-27
updated: 2026-10-28
tags: []
parent: PLAN-247
plan: PLAN-247
links:
  - {id: TASK-1952, type: blocks}
---
Covers: AC-LND-2
TDD-Role: green
Approach: land-service.ts composes existing capabilities and adds no second integrate path: IntegrateService.integrate for the branch (main still moves only by its compare-and-swap; its LandingCompleter already runs the done walk for the branch's tasks, BR-1356), then verify for the task's ACs, then the worktree removal of BR-1079. Idempotent: a landed task exits 0 with no change. An unmet contract is refused before integrate with the finish-style all-unmet report (exit 4). commands/land.ts is registered in index.ts in the same task; integrate-service.ts is touched only if a seam for the composed call is needed.
Done when: AC-LND-2 passes through the compiled binary; the existing integrate tests selected by --changed are green; typecheck passes.
