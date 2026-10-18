---
id: TASK-1563
type: task
role: plan
title: "[Skill:fix] AU-T14 a subagent run's orphans are proven by its exclusive worktree, not by a dead pid it shares with the main session"
status: draft
priority: high
phase: "Phase 1d: apply on main"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-204
plan: PLAN-204
---
Estimate: S
Approach: AU-T5 report concern 4: subagent runs record the shared main-session harness pid; while the main session lives (always, during orchestration) an ended subagent run is never 'pid dead', so its orphans (the CT-3 case: self-matching pgrep loops, npm pack orphans inside the subagent's worktree) escalate instead of being reaped. Add proof C: the run is ended (ended_at recorded), the process's cwd is inside a worktree recorded as that run's exclusively (runs.worktree / its claim), no live run or session has that worktree or an ancestor of the cwd as its checkout, and the process does not descend from any LIVE run's harness pid other than the shared one... (decide carefully: the main session pid is a common ancestor of every subagent's tool processes, so ancestry to it must not count as 'live owner' when the cwd is exclusively an ended subagent's worktree). Red-first: orphan loop inside an ended subagent's worktree while the 'main' pid is alive -> reaped; control: same while the subagent run is not ended -> kept.
Source: AU-T5 report 2026-10-18 concern 4; spec AC-AU-5
AC: red-first + control; AC-AU-5 oracle still passes.
