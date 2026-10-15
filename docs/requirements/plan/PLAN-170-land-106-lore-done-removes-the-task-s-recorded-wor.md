---
id: PLAN-170
type: plan
role: plan
title: "Land #106: lore done removes the task's recorded worktree; lore worktree sweep"
status: archived
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: SPEC-158
phases:
  - {name: "fix", description: "RED then implement"}
---
# Land #106: lore done removes the task's recorded worktree; lore worktree sweep

governance_mode: unattended (owner: "继续，快速全部做完")

## Acceptance
AC-WTC-1, AC-WTC-2, AC-WTC-3 on spec-lore-owns-worktree-cleanup-archive-removes-the-task-s.

## Invariants
- RED first by a separate tester; the implementer never edits test assertions.
- No silent fallback; exit codes measured without pipes.
- Census coverage of every armed branch stays 0 gaps.

## Tasks
1. RED (tester, worktree)
2. Implement (implementer, worktree)

## Risk register
| Risk | Impact | Mitigation |
|---|---|---|
| Change reaches consumers of the touched module | M | test:changed + main re-run after merge |


## Coverage of the spec by task
- RED: AC-WTC-1 (done hook: removed / each keep reason / unrecorded untouched / locked), AC-WTC-2 (report-only byte-identical, --apply exact, not-measured on git failure, `gone` when already removed).
- Implement: predicate module (pure decision over measured git facts + one IO probe layer), done hook with audit-row outcome, `lore worktree sweep [--apply] [--json]`, census mapping list for AC-WTC-3 (orchestrator maps on main, #72).

| Risk | Impact | Mitigation |
|---|---|---|
| Removing a worktree with unlanded work or a live session | H | never --force / -D; >=1 own commit reachable from main; 30-min quiet window; git-locked kept; any failed probe -> not-measured, never remove; RED covers each keep path |
| Two sessions sweep at once | L | git refuses the second removal; reported `gone` |
