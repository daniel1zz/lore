---
id: TASK-946
type: task
role: plan
title: "Single worktree-removal test used by the hook, lore done and lore worktree sweep"
status: archived
priority: medium
phase: "unify"
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PLAN-152
plan: PLAN-152
---
Covers AC-WS-1..6 of spec-one-worktree-removal-test-for-the-guard-lore-done-and-a (D1-D5). Single removal test in lore (pure decide + IO probe; process scan via lsof else /proc moved from the hook into lore); lore worktree check <path> [--session] [--json] and lore worktree sweep [--apply] [--session] [--json]; lore done cleanup uses it (delete recent-activity, DEFAULT_WORKTREE_QUIET_MINUTES, parseQuietMinutes, LORE_WORKTREE_QUIET_MINUTES; keep own-commit/claim-base clauses); hook occupancy step calls lore worktree check --session <payload session_id> --json. Owned-or-abandoned clause (foreign live session keeps). Never --force / branch -D. Red-first.
