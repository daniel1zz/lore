---
id: TASK-2036
type: task
role: plan
title: "Q2 stale refresh replaces its own evidence row instead of growing the log"
status: archived
priority: medium
phase: "Q"
created: 2026-10-24
updated: 2026-10-26
tags: []
parent: PLAN-269
plan: PLAN-269
---
Resolves #393.

The milestone review's stale refresh (assess-stale-refresh.ts) appends an attested row to the declaring task each batch; task-workflow-service.ts:2870 caps a task's evidence log at 50, so the refresh stops for good (live: "could not re-verify AC-HID-1, AC-HID-2, AC-HID-3, AC-HID-5, AC-HID-6 ... Evidence log is full (50 entries max)"). Make evidence bounded by design without losing the current verdict: a refresh re-run of the same AC command replaces that AC's previous refresh row on the task (one current row per AC per runner kind), so repeated batches never grow the log. Keep the 50-row cap for every other writer. Reference: Bazel action cache keeps one entry per action key.

Tests: a task at 50 rows whose AC is refreshed again records the new verdict (the old refresh row for that AC is replaced, the count does not grow); a non-refresh append at 50 rows is still refused.
