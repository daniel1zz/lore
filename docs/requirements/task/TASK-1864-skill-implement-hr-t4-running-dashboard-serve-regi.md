---
id: TASK-1864
type: task
role: plan
title: "[Skill:implement] HR-T4 running dashboard/serve registers its live URL per corpus"
status: archived
priority: medium
phase: "record-and-read"
created: 2026-10-18
updated: 2026-10-19
tags: []
parent: PLAN-237
plan: PLAN-237
links:
  - {id: TASK-1861, type: blocks}
---
Estimate: S
Approach: lore dashboard and lore serve write a runtime record {url, pid, started_at, corpus root} for the corpus they serve at start and remove it on stop (BR-869 signal path); a reader module returns the live URL for a corpus or 'absent: <reason>' when the pid is dead or no record exists. Location under the user's lore runtime dir keyed by corpus root. No literal port anywhere.
Source: spec-human-review-surface-decisions-audit-items-and-pending D4.
AC: AC-HR-5.
