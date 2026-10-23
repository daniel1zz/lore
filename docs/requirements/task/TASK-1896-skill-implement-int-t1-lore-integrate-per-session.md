---
id: TASK-1896
type: task
role: plan
title: "[Skill:implement] INT-T1 lore integrate: per-session integration worktree, floor, CAS update of main, 3-attempt bound, loss counts in status"
status: archived
priority: medium
phase: "Phase 1: integrate"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-238
plan: PLAN-238
links:
  - {id: TASK-1895, type: blocks}
  - {id: TASK-1893, type: blocks}
---
Estimate: L
Approach: per the plan table row INT-T1 and adr-main-advances-only-by-lore-integrate-per-session (Option A, Retry bound, Corpus home). New CLI verb + service; the post-merge floor command is project config (this repo: bun run check:static). Loss counts persisted where lore status can list them (corpus, not a file in the tree). Red-first: AC-INT-1 halves fail before the verb exists.
Source: spec-main-advances-only-through-lore-integrate-per-session
AC: AC-INT-1.
