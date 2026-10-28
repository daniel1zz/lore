---
id: TASK-2091
type: task
role: plan
title: "Record this repo's metric baselines"
status: draft
priority: medium
phase: "Surface"
created: 2026-10-25
updated: 2026-10-26
tags: []
parent: PLAN-262
plan: PLAN-262
links:
  - {id: TASK-2120, type: blocks}
---
## Objective
On the shared checkout after plans 2-4, the threshold task and plan 1 telemetry and test-run tasks land: run `lore metrics baseline` (preview), then `lore metrics baseline --apply` (a corpus write; on exit 4 re-run), then `lore metrics target --apply` (records only the targets of the spec's Target table that cite external evidence or carry a recorded owner decision from S4; proposed ones without a decision stay unstored and read no_target, BR-1452), then `lore verify` AC-TS-6: every ok metric shows a stored baseline row with its audit entry and 30-day window, every other metric states a reason, and the totals answered / explicit_no_data / unanswered are printed.

Spec: spec-evaluation-thresholds-and-trend-surface (BR-1405, BR-1452).

Covers: AC-TS-6
