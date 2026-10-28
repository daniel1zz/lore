---
id: TASK-1490
type: task
role: plan
title: "lore done prints 'worktree: gone' for a worktree that still exists"
status: deprecated
priority: medium
created: 2026-10-16
updated: 2026-10-25
tags: []
parent: PLAN-194
plan: PLAN-194
---
> ⚠ INVALIDATED 2026-10-18T04:37:00.578Z — superseded by task-skill-fix-cl-1-lore-done-resolves-a-branch-name-claim-to; Fixed by CL-1: branch-name claims resolve to their worktree; verified live on main 2026-10-18 (lore done removed agent-aa77f6fe6c25add09)

Estimate: S
Approach: Observed 2026-10-16 on main 3b947725: `lore done task-skill-test-tg-18-ac-ox-6-oracle-regains-its-positive` printed `worktree: gone worktree-agent-a14aed99d594ac1cd` while `git worktree list` still listed /Users/apple/Projects/zz/lore/.claude/worktrees/agent-a14aed99d594ac1cd at ffee046a on that branch (removed by hand afterwards). The same line printed after T9/T3, where the worktree had already been removed. Find where lore done derives the worktree state (done-render.ts / worktree-removal-service.ts / real-git-port.ts) and make it report the real state (present / removed / not found by which lookup), never "gone" for a live worktree.
Source: root CLAUDE.md North Star (labels are honest)
AC: in a temp repo with a live linked worktree for the task's branch, lore done does not print "gone"; after removal it does.
Reproduced at scale 2026-10-17: after 12 successive `lore done` runs printed `worktree: gone <branch or path>` (T11A/B, T11D1-D3, T13, T18-T22, T32, CT-1, CT-2, CT-4, CT-7), `git worktree list` still listed every one of those worktrees and their branches; the orchestrator removed them by hand. One run (T31) printed `worktree: removed <path>` and did remove it, so the two messages diverge on some condition (lease / run end / claim state) — find it.
