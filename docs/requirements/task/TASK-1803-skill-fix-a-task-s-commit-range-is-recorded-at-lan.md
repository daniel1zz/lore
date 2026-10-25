---
id: TASK-1803
type: task
role: plan
title: "[Skill:fix] A task's commit range is recorded at landing, so a later re-claim cannot replace it"
status: archived
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Estimate: M
Problem (measured 2026-10-19): `extra.commit_range` of task-skill-fix-dcl-1-done-floors-judge-real-runs-on-landed-work and task-skill-fix-dcl-4-one-cwd-aware-shell-command-parser-used-by is `{head: <main commit>, base: <same commit>, head_source: "worktree", worktree: .claude/worktrees/evid-dcl1 | evid-dcl}`: the orchestrator re-claimed each task with `--worktree` from a fresh detached worktree only to record extra --capture evidence after landing, and `lore done` took the range from that LATEST claim's worktree. The implementing branch's commits are lost, so `lore assess plan-defect-clusters-round-1` (76/100) still reports "DCL-1/DCL-3/DCL-4 source diffs not included". Any re-claim (evidence repair, release/reclaim) silently replaces the work's commit range.
Approach: the commit range of a task is a fact of its LANDING, not of its last claim. `lore integrate <branch>` records, on every task whose claim (current or historical, per audit) recorded that branch, the landing: {branch, branch_head, main_before, main_after, landing_commit}. `lore done` and assess derive the task's diff from that landing record (first-parent / own commits rule already in assess-commit-derivation.ts). A claim from a worktree whose head equals main contributes nothing and never overwrites a landing record. Backfill: for tasks landed before this change, derive the landing from the integrate merge commit message `merge(<branch>)` on main.
AC: throwaway repo: (a) task claimed on branch B, B landed via integrate, then the task re-claimed from a detached worktree of main to add evidence, then done -> commit_range names B's head and the landing commit, and assess's derived diff contains B's own file; (b) backfill from a `merge(<branch>)` commit produces the same record. Runner-produced red on current code.
