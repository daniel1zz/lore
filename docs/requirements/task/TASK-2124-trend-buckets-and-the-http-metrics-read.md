---
id: TASK-2124
type: task
role: plan
title: "Trend buckets and the HTTP metrics read"
status: draft
priority: medium
phase: "Surface"
created: 2026-10-25
updated: 2026-10-25
tags: []
parent: PLAN-262
plan: PLAN-262
links:
  - {id: TASK-2101, type: blocks}
  - {id: TASK-2091, type: blocks}
---
## Objective
Add `lore metrics --trend day|week` computed per bucket on read, and the HTTP read that returns the same JSON for the dashboard.

Spec: spec-evaluation-thresholds-and-trend-surface (BR-1408).

Covers: AC-TS-4
