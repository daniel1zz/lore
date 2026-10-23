---
id: TASK-1890
type: task
role: plan
title: "[Skill:fix] INT-T8 the main-ref hook does not run in a consumer's linked worktree when hooks/ is untracked (relative core.hooksPath)"
status: archived
priority: medium
phase: "Phase 1: integrate"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-238
plan: PLAN-238
links:
  - {id: TASK-1893, type: blocks}
---
Estimate: S
Approach: setup --project sets core.hooksPath=hooks (relative). Git resolves a relative hooksPath against each working tree, so in a consumer repo where hooks/ is untracked, a linked worktree has no hooks/ and the main-ref guard (and pre-push) does not run there (INT-T2 report). The integrate CAS and the shared checkout are covered; a session committing on main inside its own worktree is not. Decide from facts: an absolute hooksPath into the main checkout vs requiring hooks/ to be tracked vs installing per worktree — measure with real git in a throwaway repo (git 2.50) and pick the one that holds for every worktree with no exclusivity; update setup --project and its tests.
Source: INT-T2 report 2026-10-18
AC: in a throwaway consumer repo with untracked hooks/, a commit on main from a linked worktree is refused by the hook.
