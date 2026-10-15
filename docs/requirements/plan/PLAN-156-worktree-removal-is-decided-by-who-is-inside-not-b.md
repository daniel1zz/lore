---
id: PLAN-156
type: plan
role: plan
title: "Worktree removal is decided by who is inside, not by how long it has been quiet"
status: archived
priority: medium
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: SPEC-171
phases:
  - {name: "occupancy", description: "run occupancy read + hook switch"}
---
# Plan — Worktree removal is decided by who is inside

Implements `spec-worktree-removal-is-decided-by-who-is-inside-not-by-how` (AC-WL-1..5), baseline `baseline-remove-a-seat` BR-1070. User instruction 2026-10-12: "如果限制的是时间就不合理，直接改" — taken as S1 decision and S4 approval for this one-task change.

## Overview

One task: `lore run occupancy --worktree <path>` (store lookup of runs by agent_ref, run-end state incl. parent, open claims with their harness_run's end state) and the git-safety hook's `probeWorktreeRemove` switched from the 30-minute reflog window to the three occupancy signals (owning run, process cwd via lsof, open claims). Retire the reflog-window test cases.

## Invariants

| # | Invariant | How it is checked |
|---|---|---|
| I1 | Dirty / unmerged / unparseable refusals and every other gate rule unchanged | AC-WL-3(h), AC-WL-4 existing suite |
| I2 | No test writes the live `.lore/` | InMemoryStore / mkdtemp + lore init |
| I3 | Installed copy refreshed only by `lore setup` after landing | orchestrator, after merge |

## Risk register

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | A run whose end was never recorded (hook missing, crash) blocks removal indefinitely | M | refusal names `lore run end <id> --reason` — explicit and audited instead of a timer |
| R2 | `lsof` slow or absent on a consumer machine | L | absent → refused and named (D4); one `-d cwd` listing, no recursive `+D` scan |

## Decisions Log

- 2026-10-12 — reflog window replaced by occupancy signals (user instruction above).
