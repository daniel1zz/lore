---
id: TASK-1547
type: task
role: plan
title: "[Skill:implement] AU-T10 worktree removal through decide(worktree-remove) with the ignored-file rule"
status: archived
priority: high
phase: "Phase 1b: human channel and verbs"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-204
plan: PLAN-204
links:
  - {id: TASK-1543, type: blocks}
---
Estimate: M
Approach: lore done, sweep --apply and verify --falsify cleanup call decide(worktree-remove) after the existing removal test (unchanged); R from git status --ignored vs the regenerable set; verify --falsify removes its lore-attested-red-* worktree in finally via the same path; sweep handles registered orphan temp worktrees of ended runs. Red-first halves (1)-(4).
Source: spec-autonomy-phase-1-decision-function-human-channel-lore; decision: adr-autonomy-is-decided-by-measured-facts-one-decision-function
AC: AC-AU-11.
