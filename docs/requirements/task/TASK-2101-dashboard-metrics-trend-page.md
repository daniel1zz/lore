---
id: TASK-2101
type: task
role: plan
title: "Dashboard metrics trend page"
status: draft
priority: medium
phase: "Surface"
created: 2026-10-25
updated: 2026-10-26
tags: []
parent: PLAN-262
plan: PLAN-262
links:
  - {id: TASK-2091, type: blocks}
---
## Objective
Add the dashboard metrics trend page (single-project and per-project routes) rendering the HTTP metrics JSON: one section per question, per-bucket raw values, the trend labelled 'vs baseline', the target attainment (met, not met, within noise, no target; never green for no target or not met), sample size and status, with no data / insufficient in words (D17, BR-1454).

Spec: spec-evaluation-thresholds-and-trend-surface (BR-1408).

Covers: AC-TS-5
