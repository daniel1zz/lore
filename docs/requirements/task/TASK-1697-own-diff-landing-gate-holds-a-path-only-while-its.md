---
id: TASK-1697
type: task
role: plan
title: "Own-diff landing gate holds a path only while its holder is still editing: released, committed branches land in any order"
status: archived
priority: critical
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PRD-001
links:
  - {id: TASK-1699, type: supersedes}
---
Observed 2026-10-20: BR-1346 (integrate refuses a branch whose own change touches a path held by an anchor of another unarchived, unlanded task) deadlocked four released, committed branches that all change packages/core/src/config.ts (audit worktree-agent-a2d5bb987fa32878d, identity a0dd74342106e7518, integrate-migration a610911b54622c3eb, config takeover a2e21971ddf014690): each is 'held' by the others, so none can land first, and the gate fix itself touches integrate-service.ts, also held. The owner authorised a one-time LORE_GATE_BYPASS for that ordered batch. End state: a hold blocks only while the holding task is claimed (edit in progress); a released task's committed but unlanded change never blocks another landing — the first to integrate lands and the rest merge main, which they must do anyway; the landing record names the unlanded overlapping branches so their owners know to merge. AC: red-first integrate test with two released branches touching the same file — the first lands (exit 0), the second, after merging main, lands; a claimed holder still refuses with exit 4 naming it. After landing: restate BR-1346.
