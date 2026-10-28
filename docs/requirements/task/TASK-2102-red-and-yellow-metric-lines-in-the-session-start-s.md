---
id: TASK-2102
type: task
role: plan
title: "Red and yellow metric lines in the session-start snapshot"
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
Print one line per metric red or yellow vs baseline or whose target is not met (id, value, baseline, target, action line; D17) in the `lore bootstrap` snapshot and nothing when none; leave the compact session-start injection unchanged; report-only (D6).

Spec: spec-evaluation-thresholds-and-trend-surface (BR-1413).

Covers: AC-TS-7
