---
id: TASK-1901
type: task
role: plan
title: "[Skill:fix] AU-T24 open-claim resolution runs git worktree list from the judged (often removed) working copy -> ENOENT; run it from the repository"
status: archived
priority: medium
phase: "Phase 1d: apply on main"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-204
plan: PLAN-204
---
Estimate: S
Approach: AU-T23 resolves an open claim's branch-name worktree with resolveClaimWorktree(probe, claim.worktree, workingCopy) (packages/lore/src/service/run-service.ts:394), i.e. it runs `git worktree list` with cwd = the helper's working copy. A helper's working copy is often already removed (lore done removes the merged worktree before the turn-end review runs), so spawn fails with "ENOENT: no such file or directory, posix_spawn 'git'" (observed in the turn-end review 2026-10-18 for INT-T9's open claim) and every branch-name claim reads not-measured. git worktree list is repo-wide: run it from the repository (the corpus's repo root / git common dir's checkout, from the Invocation), never from the judged working copy.
Red-first: working copy directory deleted + open branch-name claim for another live worktree -> today not-measured ENOENT (red); after: resolved. Control: unchanged results when the working copy exists.
Source: turn-end review 2026-10-18
AC: test green; AU-T23 tests pass.
