---
id: TASK-1565
type: task
role: plan
title: "[Skill:design] AU-T15 concurrent sessions merging in ONE shared main checkout can swallow each other's in-progress merge"
status: draft
priority: high
phase: "Phase 1d: apply on main"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-204
plan: PLAN-204
---
Estimate: M
Approach: Incident 2026-10-18: this session's merge of AU-T10 into main was in progress (conflict resolved, staged) when a peer session ran git commit in the same main working tree; its commit e1599818 concluded the merge under its own message and included its own test change. Content was correct by luck; provenance repaired in 0e97fb5b. Also: peers' uncommitted edits in the shared tree blocked merges twice (ledger). North Star: 'what if two sessions do it at once — an answer relying on exclusivity is a refusal of the target state'. Design a mechanism: e.g. merges to main go through a lore verb that takes a repo-level merge lock and works in a dedicated integration worktree (never the shared checkout), or each session gets its own integration worktree and main advances by fast-forward only. Measure the options, decide via ADR (user decision if it changes workflow), then implement.
Source: incident 2026-10-18 (e1599818, 0e97fb5b)
AC: two concurrent merges into main from two sessions both land with their own commits and messages; neither can conclude the other's merge (test with two processes).
