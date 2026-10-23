---
id: TASK-1866
type: task
role: plan
title: "[Skill:implement] HR-T2 every other escalating producer records a plain-language detail"
status: archived
priority: medium
phase: "record-and-read"
created: 2026-10-18
updated: 2026-10-19
tags: []
parent: PLAN-237
plan: PLAN-237
---
Estimate: M
Approach: Fill detail at every other escalating producer: worktree-remove (the ignored paths that blocked removal, BR-1235 — today only hashed into the version fingerprint), stash-drop (attribution reason, branch, run), run-end-stale / process-reap (run ids, pids), override-* / ac-exempt / verify-new-command (document, refused judgment or command). Each with summary, requested_by, on_accept, on_reject in plain English.
Source: spec-human-review-surface-decisions-audit-items-and-pending D1.
AC: AC-HR-1 — every class listed in the AC; falsifier: removing detail from any one producer turns the test red naming the class.
