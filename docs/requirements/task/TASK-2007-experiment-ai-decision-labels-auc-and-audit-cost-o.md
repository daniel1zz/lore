---
id: TASK-2007
type: task
role: plan
title: "Experiment: AI decision labels, AUC and audit cost (O2-S1, O2-S3, O2-S2)"
status: archived
priority: medium
phase: "Experiments"
created: 2026-10-25
updated: 2026-10-26
tags: []
parent: PLAN-256
plan: PLAN-256
links:
  - {id: TASK-2060, type: blocks}
  - {id: TASK-2122, type: blocks}
---
## Objective
Run OST experiments O2-S1, O2-S3 and O2-S2 read-only and record the results and fired branches (plan Decisions Log rows O2-S1, O2-S2, O2-S3).

## Steps
- O2-S1 reversal-detection coverage: for each of the 4 after-event kinds (reopen / set back from approved, revert, issue naming the decision, local main-red record) count events in the last 90 days; report how many kinds produced at least one (trigger: fewer than 3).
- O2-S3: label review judgments with the S-B per-verdict table, over AI-judge rows only (judge_provider not deterministic-checks; count the deterministic rows separately, BR-1422); per document type and instruction version with at least 10 labelled per class compute AUC with its DeLong 95% lower bound (single class: no result); report each AI judge against 0.65.
- O2-S2: when a person is asked something in this window, add one sampled judgment as an audit question (D10); record minutes per item and the cannot-tell share; with no asks, record "not run".

## Output
One research knowledge doc linked `informs` to this plan.

Covers: none.

## Closing route
Close it with `lore evidence <task> --oracle other --command "lore get <research doc slug>" --result pass --capture` plus the no-new-tests declaration, then `lore done` (attestation floor route 2, task-workflow-service.ts ATTESTATION_FLOOR_REPAIRS).
