---
id: TASK-480
type: task
role: plan
title: "T1 pure decision-status value-restriction module"
status: archived
priority: medium
created: 2026-07-31
updated: 2026-08-01
tags: []
parent: PLAN-096
plan: PLAN-096
links:
  - {id: TASK-479, type: blocks}
---
## Task

Covers AC-DS-8. Create packages/lore/src/adapters/cli/decision-status-validation.ts as a PURE, vitest-reachable module (commands/*.ts transitively import loader.ts and bun:sqlite, so they are unreachable from vitest). It decides the closed value set: accepted is allowed; deprecated and superseded are refused with a message naming lore invalidate; an unrecognised value is refused listing the accepted value.
