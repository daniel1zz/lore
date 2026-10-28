---
id: TASK-2084
type: task
role: plan
title: "Close plan 408: verify and apply the BR-261 change"
status: deprecated
priority: medium
phase: "P2 Fix and close"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-265
plan: PLAN-265
---
Covers: none (orchestrator close; AC-EC-1..2 attested by lore verify)
Steps: bun run build; lore verify plan-evidence-check-only-on-finished-tasks-408; lore rule apply spec-the-evidence-check-of-a-task-review-applies-only-to-a; lore anchor add the spec review-checks.ts#runDeterministicChecks; lore assess.
