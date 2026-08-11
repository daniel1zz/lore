---
id: TASK-546
type: task
role: plan
title: "[T6] CLOSE: full suite, typecheck, code anchors"
status: archived
priority: medium
phase: "CLOSE"
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: PLAN-105
plan: PLAN-105
---
Run bun run build first (compiled-binary oracles), then the full two-runner suite (bun run test) plus bun run typecheck on a CLEAN tree at a named commit — a dirty tree turns concurrent sessions' edits into phantom regressions. Record attested evidence for all seven ACs via lore verify. Then declare the spec's code anchors with lore anchor add (AFTER landing, never before — an undeclared path reads as an instant false file_missing). Satisfies AC-OOB-7 and the plan's Exit Criteria.
