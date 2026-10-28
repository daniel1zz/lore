---
id: TASK-1302
type: task
role: plan
title: "[Skill:implement] UPSTREAM_APPROVED_STATUSES becomes {approved, active} for claim, plan approval and readiness"
status: archived
priority: high
phase: "Phase 1: Status set"
created: 2026-10-15
updated: 2026-10-25
tags: []
parent: PLAN-180
plan: PLAN-180
links:
  - {id: TASK-1301, type: blocks}
---
Estimate: S
Approach: packages/core/src/task-workflow.ts:1071 set + JSDoc (record-lock reason, cite the spec); gate-predicates.ts:248-257 comment; check task-feed-wiring.ts consumes the shared set; update any test pinning active as refused (Risk R1).
Source: spec AC-ACT-1, AC-ACT-2; BR-104 (modified), BR-111
Covers: AC-ACT-1, AC-ACT-2
AC:
- AC-ACT-1 green via its declared command (lore ac list <spec>), red recorded first
- AC-ACT-2 green via its declared command (lore ac list <spec>), red recorded first

Red first (Invariant I3): write the AC test file(s) first, run the AC command, record `lore evidence <this task> --oracle test --result expected-fail --output-tail-file <log>` yourself, then implement to green and record the pass. Commit before attesting. Scoped oracles only in the worktree (I4).
