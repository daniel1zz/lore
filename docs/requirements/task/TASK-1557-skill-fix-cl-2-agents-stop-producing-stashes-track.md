---
id: TASK-1557
type: task
role: plan
title: "[Skill:fix] CL-2 agents stop producing stashes; tracked files stop being dirtied by tests and builds"
status: draft
priority: high
phase: "Phase 1: cleanup without a human"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-205
plan: PLAN-205
links:
  - {id: TASK-1556, type: blocks}
---
> ⚠ INVALIDATED 2026-10-18T03:49:20.597Z; Outside the parent spec's scope (plan review 2026-10-18, escalate): agent-hygiene fixes move into the autonomy initiative's spec, where they get structured ACs with named oracles

Estimate: M
Approach: (a) lore-implementer.md:36 lists `git stash push -m wip-<task>` as sanctioned; the gate's safe-hints at pre-bash-git-safety-gate.mjs:591/597/603 also point to stash. Replace with: red-first by committing the test first and running it red before the implementation commit, or `lore verify --falsify` (uses git stash create + a detached worktree, no stash-list entry, verify-runner-service.ts:589-621); a byproduct that dirties a tracked file outside the anchors is a defect to report in the task, not to stash. Keep the gate's refusals unchanged. (b) Find and fix the sources that dirty tracked files during task work: mirror export side effects of test runs, assets-manifest regeneration by bun run build in a worktree (stash entries 12-19, 22, 23, 25 name them); each fixed at the source so a worktree stays clean after build+tests. Verify (a) from a fresh consumer install (assets manifest). Red-first for (b): a test/build run in a fresh worktree leaves git status clean.
Source: RCA 2026-10-18 section B
AC: no stash guidance in shipped assets (grep); build + scoped tests in a fresh worktree leave git status --porcelain empty.
