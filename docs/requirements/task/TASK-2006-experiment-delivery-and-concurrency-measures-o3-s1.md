---
id: TASK-2006
type: task
role: plan
title: "Experiment: delivery and concurrency measures (O3-S1, O4-S1, O4-S3)"
status: archived
priority: medium
phase: "Experiments"
created: 2026-10-25
updated: 2026-10-26
tags: []
parent: PLAN-256
plan: PLAN-256
links:
  - {id: TASK-2106, type: blocks}
  - {id: TASK-2105, type: blocks}
---
## Objective
Run OST experiments O3-S1, O4-S1 and O4-S3 read-only and record results and fired branches.

## Steps
- O3-S1: compute the five delivery measures of S-C for the last 30 days from claims, completions, the attempt ledger, regression records and issues; name any measure that needed a manual label.
- O4-S1: count the share of `.lore/integrate-attempts` records that carry started_at and per-step exit codes, against the 80% trigger; note the 20-per-branch bound.
- O4-S3: correlate live parallel runs per hour with the conflict + lost-race share; report r against 0.3.

## Output
One research knowledge doc linked `informs` to this plan.

Covers: none.

## Closing route
Close it with `lore evidence <task> --oracle other --command "lore get <research doc slug>" --result pass --capture` plus the no-new-tests declaration, then `lore done` (attestation floor route 2, task-workflow-service.ts ATTESTATION_FLOOR_REPAIRS).
