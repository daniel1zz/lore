---
id: TASK-1554
type: task
role: plan
title: "[Skill:fix] CL-1 lore done resolves a branch-name claim to its worktree and removes it"
status: archived
priority: critical
phase: "Phase 1: cleanup without a human"
created: 2026-10-18
updated: 2026-10-25
tags: []
parent: PLAN-205
plan: PLAN-205
links:
  - {id: TASK-1555, type: blocks}
  - {id: TASK-1490, type: supersedes}
---
Estimate: M
Approach: gatherWorktreeFacts (worktree-cleanup.ts:267) existsSync()s the claim's --worktree value; the dispatch protocol records the BRANCH name there (lore-implementer.md:51; comment worktree-cleanup.ts:142-145), so it always reports gone. Resolve a non-path value through `git worktree list --porcelain` of this repository (exact branch match), as resolveClaimHead (task-workflow-service.ts:4003) and detectWorktreeBranch (commands/run.ts:217-219) already do — reuse one resolver, don't add a third. Report gone only when neither a path nor a branch resolves, naming which lookup failed. Then the existing removal test decides remove/keep. Red-first: add a branch-name claim fixture to done-worktree-cleanup-compiled.bun.test.ts (AC-WS-3's oracle) — today exits with 'worktree: gone' while the dir exists. Absorbs task-lore-done-prints-worktree-gone-for-a-worktree-that-still (invalidate it superseded-by this task after merge).
Source: spec-one-worktree-removal-test-for-the-guard-lore-done-and-a D3/AC-WS-3; RCA 2026-10-18 (162 branch-form audit rows all gone)
AC: branch-name claim worktree removed by lore done when clean+merged+unoccupied+run ended, kept with reason otherwise; gone only when unresolvable, naming the lookup.
