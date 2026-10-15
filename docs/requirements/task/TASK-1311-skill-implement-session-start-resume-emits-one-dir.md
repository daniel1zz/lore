---
id: TASK-1311
type: task
role: plan
title: "[Skill:implement] session-start-resume emits one directive upgrade advisory from the global and project check caches"
status: draft
priority: high
phase: "Phase 2: Advisory and outlet retirement"
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PLAN-182
plan: PLAN-182
links:
  - {id: TASK-1309, type: blocks}
---
Estimate: M
Approach: Rework Phase F of assets/hooks/session-start-resume.mjs: read both caches (cache-first, detached refresh as today), render ONE line naming side(s), reason and command; diverged files named, never advised to overwrite; silent when in sync.
Source: spec AC-UR-2; BR-1086
Covers: AC-UR-2
AC:
- AC-UR-2 green via its declared command (lore ac list <spec>), red recorded first

Red first (Invariant I3): write the AC test file(s) first, run the AC command, record `lore evidence <this task> --oracle test --result expected-fail --output-tail-file <log>` yourself, then implement to green and record the pass. Commit before attesting. Scoped oracles only in the worktree (I4).
