---
id: TASK-2105
type: task
role: plan
title: "Concurrency ledger and unattended autonomy share (successor)"
status: draft
priority: medium
phase: "Measures"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-255
plan: PLAN-255
links:
  - {id: TASK-2091, type: blocks}
  - {id: TASK-2103, type: supersedes}
  - {id: TASK-2066, type: blocks}
---
## Objective
Report questions D and E: live runs per hour, conflict and lost-race shares over all attempts, decided-without-person share and person wait; the attempt ledger keeps every attempt younger than 30 days with start time and step exit codes. Recreated from task-concurrency-ledger-and-unattended-autonomy-share (plan-evaluation-3), which is retracted.

Spec: spec-delivery-concurrency-and-autonomy-metrics-fed-by-live (BR-1447, BR-1448, BR-1449, BR-1450).

Covers: AC-DC-4, AC-DC-5, AC-DC-7

## Must resolve before evidence

Carried verbatim from the original task. Rule ids map to the successor: BR-1397 -> BR-1447, BR-1398 -> BR-1448, BR-1415 -> BR-1449, BR-1419 -> BR-1450; the spec named is now spec-delivery-concurrency-and-autonomy-metrics-fed-by-live.

From the final review of the approved bundle (rev6). Resolve each item before recording evidence for this task.

1. spec-delivery-concurrency-and-autonomy-metrics, BR-1415 / AC-DC-7 / Scope paragraph after the table: a single (non-trend) window starting more than 30 days ago leaves conflict_rate and lost_race_rate undefined ('no_data for that part' cannot apply to one scalar). Decide: the whole figure is no_data (source_absent), or it is computed over the last 30 days only with a marker; add the case to a criterion.
2. spec-delivery-concurrency-and-autonomy-metrics, BR-1419 vs AC-DC-7: the rule says an attempt older than 30 days 'may be dropped', the criterion asserts it 'is gone'. Make them match (pruning required, or the criterion stops asserting removal).
3. spec-delivery-concurrency-and-autonomy-metrics, BR-1398 / AC-DC-5: a human-tty row that answers no escalation is undefined (included, excluded, or counted). Decide and add it to the fixture.

Each decision must be recorded in the spec (rule text via `lore rule propose ... amend`, Design Decisions row, and the criterion if its assertion changes) when this task lands, through the normal review and approval of that spec revision.
