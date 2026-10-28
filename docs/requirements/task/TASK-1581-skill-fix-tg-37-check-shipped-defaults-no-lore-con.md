---
id: TASK-1581
type: task
role: plan
title: "[Skill:fix] TG-37 check-shipped-defaults 'no .lore/config.yaml exits exactly 4' fails only inside agent worktrees"
status: archived
priority: low
phase: "Phase 3b: one runner"
created: 2026-10-18
updated: 2026-10-25
tags: []
parent: PLAN-201
plan: PLAN-201
---
Estimate: S
Approach: Passes on main (60/60, 2026-10-18) but failed for three agents in .claude/worktrees/* (CT-3b, CL-4 and earlier): the test spawns bun on a fixture that symlinks REPO_ROOT/node_modules; in a worktree REPO_ROOT resolves to the worktree, whose node_modules layout differs. Find the root cause (path resolution of REPO_ROOT or the symlink target) and make the test hold in both; a worktree oracle that is red for environment reasons trains agents to ignore reds.
Source: agent reports 2026-10-17/18
AC: the test passes unfiltered both on main and inside a fresh agent worktree.
