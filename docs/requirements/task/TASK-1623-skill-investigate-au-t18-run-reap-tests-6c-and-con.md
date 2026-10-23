---
id: TASK-1623
type: task
role: plan
title: "[Skill:investigate] AU-T18 run-reap tests (6c) and CONTROL 3 failed once each under load; suspected legacy registration from a failed start-time probe"
status: deprecated
priority: medium
phase: "Phase 1d: apply on main"
created: 2026-10-18
updated: 2026-10-23
tags: []
parent: PLAN-204
plan: PLAN-204
---
Estimate: S
Approach: AU-T17 (2026-10-18) fixed the late-child timer race but two other one-off failures under load (load avg 40-60) stayed unexplained: (6c) returned empty runs; CONTROL 3 returned an action other than kept-live-owner. Both fit a harness pid registered with no recorded start time (legacy run), hypothesis: a transient ps failure during lore run register. AU-T17 added an assertion that fails loudly naming session and pid when register cannot probe; when it fires, find why the probe failed at its root (run-registration pid/start-time probe), no retries. If 30 days of runs never fire it, record that and close.
Source: AU-T17 report 2026-10-18
AC: root cause named with file:line and fixed, or the assertion never fired in 30 days (recorded).
