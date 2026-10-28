---
id: TASK-2061
type: task
role: plan
title: "The change batch validates every current-value binding against the registry at stage and approve"
status: draft
priority: medium
phase: "P3 Refusal, integrity, export and judge"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-261
plan: PLAN-261
links:
  - {id: TASK-2062, type: blocks}
---
Covers: AC-CV-6
Approach: before any write, change-batch-service checks every binding of every entry's patch.current_values with the literal 'if (!isGovernedValueId(binding.source.governed)) return refuseBatch(' (falsifier) at lore batch stage (no batch created) and again at lore approve (the registry may have changed; no node changes). Refusal exit 4 names the node and the id (BR-1432). change-batch-service.ts is created by the #416 plan's change-batch task, which blocks this task.
