---
id: TASK-1307
type: task
role: plan
title: "[Skill:implement] the turn record carries the editing agent's id and a turn-start working-tree snapshot"
status: archived
priority: high
phase: "Phase 1: Foundations"
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PLAN-181
plan: PLAN-181
links:
  - {id: TASK-1305, type: blocks}
  - {id: TASK-1303, type: blocks}
---
Estimate: S
Approach: post-edit-mark.mjs: record agent_id/agent_type from the payload. user-prompt-turn-start.mjs: record a tree id via a temporary index (GIT_INDEX_FILE=<tmp> git add -A && git write-tree), never touching the real index; record the snapshot duration (Risk R2).
Source: spec AC-TE-2, AC-TE-7 (snapshot half); BR-1088
Covers: AC-TE-2
AC:
- AC-TE-2 green via its declared command (lore ac list <spec>), red recorded first

Red first (Invariant I3): write the AC test file(s) first, run the AC command, record `lore evidence <this task> --oracle test --result expected-fail --output-tail-file <log>` yourself, then implement to green and record the pass. Commit before attesting. Scoped oracles only in the worktree (I4).
