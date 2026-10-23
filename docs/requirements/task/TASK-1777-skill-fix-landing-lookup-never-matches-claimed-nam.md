---
id: TASK-1777
type: task
role: plan
title: "[Skill:fix] Landing lookup never matches: claimed names hold the worktree path, integrate names the merge by branch"
status: archived
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Problem (observed 2026-10-19, `lore done task-skill-fix-a-task-s-commit-range-is-recorded-at-landing-so` right after `lore integrate` landed it as 87c19ef4 "merge(worktree-agent-a1a55b60c3c97b3c8)"): done printed "commit range taken from the claim on /Users/.../worktrees/agent-a1a55b60c3c97b3c8; no landing found: no merge(<name>) commit on main for claimed names /Users/.../worktrees/agent-a1a55b60c3c97b3c8". The claimed names are the worktree PATH only, while integrate names the landing commit by BRANCH; the claim recorded `extra.claim.branch` (or the worktree's branch is derivable), but it is not among the candidates. So no integrate landing is ever found and every task falls back to the claim range — the feature the task delivered is inert.
Approach: the landing candidates include the claim's recorded branch (and the worktree's branch read from git when only the path was recorded); `recordLanding` at integrate time and the done-time lookup use the same candidate derivation (one function).
AC: throwaway repo: claim from a linked worktree on branch B, land with `lore integrate B`: `lore get <task> --json` has extra.landing naming B and the merge commit; `lore done` prints no "commit range taken from the claim" note. Runner-produced red.
