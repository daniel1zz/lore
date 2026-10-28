---
id: TASK-2005
type: task
role: plan
title: "Experiment: overhead, cost, reuse and safety sources (O5, O6, O7, O8)"
status: archived
priority: medium
phase: "Experiments"
created: 2026-10-25
updated: 2026-10-26
tags: []
parent: PLAN-256
plan: PLAN-256
links:
  - {id: TASK-2127, type: blocks}
  - {id: TASK-2126, type: blocks}
  - {id: TASK-2125, type: blocks}
  - {id: TASK-2121, type: blocks}
---
## Objective
Run OST experiments O5-S1, O5-S3, O6-S1, O7-S1 and O8-S2 read-only and record results and fired branches.

## Steps
- O5-S1/S3: confirm the check outcome record lacks actor and subject; compute the existing per-checkpoint refusal-then-success estimate (BR-488) as the comparison point for the false-deny rate.
- O6-S1: parse one harness session record of this repo; report whether it carries per-request token usage and whether its session id joins to a run (cc:<session>).
- O7-S1: join served documents (usage trace, feed/search) to later links, citations and anchors by the same run; report the linkable share against 10%.
- O8-S2: count issues that are corpus or data-loss incidents (for example #189); report against 3.

## Output
One research knowledge doc linked `informs` to this plan.

Covers: none.

## Closing route
Close it with `lore evidence <task> --oracle other --command "lore get <research doc slug>" --result pass --capture` plus the no-new-tests declaration, then `lore done` (attestation floor route 2, task-workflow-service.ts ATTESTATION_FLOOR_REPAIRS).
