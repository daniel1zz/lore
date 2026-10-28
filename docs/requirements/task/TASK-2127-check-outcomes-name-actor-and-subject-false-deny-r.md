---
id: TASK-2127
type: task
role: plan
title: "Check outcomes name actor and subject; false-deny rate; retire the retry estimate"
status: draft
priority: medium
phase: "Overhead, fitness and safety"
created: 2026-10-25
updated: 2026-10-25
tags: []
parent: PLAN-272
plan: PLAN-272
links:
  - {id: TASK-2091, type: blocks}
  - {id: TASK-2092, type: blocks}
---
## Objective
Record the judged party, subject and content fingerprint with every gate outcome and every hook outcome taken in from the hook log, in both the SQLite and Turso stores; report per-check deny rate and 24-hour false-deny rate in question F; remove the usage report refusal-then-success estimate (BR-488 retired).

Spec: spec-governance-cost-reuse-stability-and-safety-metrics (BR-1373 modified, BR-1399, BR-488 retired).

Covers: AC-GV-1, AC-GV-2
