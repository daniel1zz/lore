---
id: TASK-1556
type: task
role: plan
title: "[Skill:fix] CL-3 no self-matching waits; test helpers and verify reap what they spawn"
status: draft
priority: high
phase: "Phase 1: cleanup without a human"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-205
plan: PLAN-205
---
> ⚠ INVALIDATED 2026-10-18T03:49:21.180Z; Outside the parent spec's scope (plan review 2026-10-18, escalate): agent-hygiene fixes move into the autonomy initiative's spec, where they get structured ACs with named oracles

Estimate: S
Approach: (a) lore-implementer.md termination discipline: wait on a known pid (`cmd & pid=$!; while kill -0 $pid; do ...`) or run in the foreground; never poll with `pgrep -f <pattern>` (two such loops match each other's command lines forever — reproduced on macOS 2026-10-18). (b) run-process-group.ts reaps detached child groups only on process 'exit' (:52), which a signal-killed vitest worker never emits: add SIGTERM/SIGINT handlers that kill the groups and re-raise. Red-first: a worker killed by SIGTERM leaves no orphan. (c) verify-runner-service.ts leaves lore-attested-red-* worktrees in TMPDIR (170 dirs, 3 still registered): remove them in a finally, red-first with a forced failure mid-run. Note: (a) edits the same asset file as CL-2 — CL-2 blocks this task.
Source: RCA 2026-10-18 sections A(1a,1b), D
AC: the three red-first cases go green; no lore-attested-red-* worktree survives a verify --falsify run.
