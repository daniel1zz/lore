---
id: TASK-2103
type: task
role: plan
title: "Concurrency ledger and unattended autonomy share"
status: draft
priority: medium
phase: "Delivery and concurrency"
created: 2026-10-25
updated: 2026-10-26
tags: []
parent: PLAN-267
plan: PLAN-267
---
> ⚠ INVALIDATED 2026-10-26T02:52:28.364Z — superseded by task-concurrency-ledger-and-unattended-autonomy-share-successor; O3-S1 stop-and-re-review: spec superseded by spec-delivery-concurrency-and-autonomy-metrics-fed-by-live; task recreated under plan-evaluation-3b so its evidence binds to the successor spec (no re-parent verb)

## Objective
Report questions D and E: live runs per hour, conflict and lost-race shares over all attempts, attempts per landing, queue wait, bounded-source disclosure, decided-without-person share and person wait. Follow branches O4-S1 and O4-S3 of plan 1 (path B adds capture to the attempt ledger here).

Spec: spec-delivery-concurrency-and-autonomy-metrics (BR-1397, BR-1398).

Covers: AC-DC-4, AC-DC-5

## Must resolve before evidence

From the final review of the approved bundle (rev6). Resolve each item before recording evidence for this task.

1. spec-delivery-concurrency-and-autonomy-metrics, BR-1415 / AC-DC-7 / Scope paragraph after the table: a single (non-trend) window starting more than 30 days ago leaves conflict_rate and lost_race_rate undefined ('no_data for that part' cannot apply to one scalar). Decide: the whole figure is no_data (source_absent), or it is computed over the last 30 days only with a marker; add the case to a criterion.
2. spec-delivery-concurrency-and-autonomy-metrics, BR-1419 vs AC-DC-7: the rule says an attempt older than 30 days 'may be dropped', the criterion asserts it 'is gone'. Make them match (pruning required, or the criterion stops asserting removal).
3. spec-delivery-concurrency-and-autonomy-metrics, BR-1398 / AC-DC-5: a human-tty row that answers no escalation is undefined (included, excluded, or counted). Decide and add it to the fixture.

Each decision must be recorded in the spec (rule text via `lore rule propose ... amend`, Design Decisions row, and the criterion if its assertion changes) when this task lands, through the normal review and approval of that spec revision.
