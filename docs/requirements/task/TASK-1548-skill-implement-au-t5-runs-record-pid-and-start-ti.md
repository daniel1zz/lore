---
id: TASK-1548
type: task
role: plan
title: "[Skill:implement] AU-T5 runs record pid and start time; lore run reap with ownership proof"
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
Estimate: L
Approach: extend run registration (hook + store) with harness pid + process start time; lore run reap [--apply]: processes with cwd inside an ended run's worktree; ownership proof per AC-AU-5 (ancestry, or PPID 1 + start-time window + no overlapping live run + pid-reuse check); SIGTERM, SIGKILL after 5 s if alive, final rescan; ESRCH = already-gone. Also: lore run end for runs whose recorded pid is dead and no end recorded (28 today) through decide() — state the class in the task if added. Red-first halves (1)-(5).
Source: spec-autonomy-phase-1-decision-function-human-channel-lore; decision: adr-autonomy-is-decided-by-measured-facts-one-decision-function
AC: AC-AU-5.
