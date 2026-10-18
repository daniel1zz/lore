---
id: TASK-1594
type: task
role: plan
title: "[Skill:fix] AU-T17 autonomy-run-reap test (1) failed once on a process-timing assertion; also (4b) timed out once under load"
status: draft
priority: medium
phase: "Phase 1d: apply on main"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-204
plan: PLAN-204
---
Estimate: S
Approach: Two separate agents observed one-off failures in packages/lore/tests/integration/autonomy-run-reap.test.ts: (1) a process-timing assertion (AU-T16 run, 2026-10-18), and (4b) the two concurrent lore run reap --apply processes timing out under heavy load (AU-T14 run). Both passed on rerun. A flaky oracle is a defect (AS-17: three green runs do not clear it). Find the time-dependent assumption (start-time second precision vs the run's registered_at window; SIGTERM->SIGKILL 5 s grace vs the test's wait; process table read before the child has started) and make the test deterministic without retries or bigger timeouts (e.g. wait on a readiness signal from the spawned child, assert on recorded state not on elapsed time).
Source: AU-T14 and AU-T16 reports 2026-10-18
AC: the test file passes 20 consecutive runs under `bunx --bun vitest run` with 8 parallel CPU-burner processes running (record the loop command and result).
