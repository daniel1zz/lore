---
id: TASK-598
type: task
role: plan
title: "[M4] worktree corpus resolution via git-common-dir fallback (AC-WH-4)"
status: archived
priority: medium
created: 2026-07-27
updated: 2026-07-27
tags: []
parent: PLAN-106
plan: PLAN-106
---
findLoreDbPath (+ findLoreDbPathQuiet) fallback: walk-up miss + linked worktree -> resolve main checkout via git rev-parse --git-common-dir, use its .lore/; neither -> existing loud failure; primary checkout byte-identical (REGRESSION pin). Compiled-binary e2e in temp repo + worktree. RED-first. AC: AC-WH-4.
