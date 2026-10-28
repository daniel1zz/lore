---
id: TASK-2104
type: task
role: plan
title: "Delivery measures: lead time, landings, change fail, rework, recovery"
status: draft
priority: medium
phase: "Delivery and concurrency"
created: 2026-10-25
updated: 2026-10-26
tags: []
parent: PLAN-267
plan: PLAN-267
---
> ⚠ INVALIDATED 2026-10-26T02:52:28.071Z — superseded by task-delivery-measures-fed-by-live-recorders-lead-time-landings; O3-S1 stop-and-re-review: spec superseded by spec-delivery-concurrency-and-autonomy-metrics-fed-by-live; task recreated under plan-evaluation-3b so its evidence binds to the successor spec (no re-parent verb)

## Objective
Report questions B and C: lead time from first claim, landings per UTC day, change fail rate (7-day inclusive, attributed main-red only), rework by resolves link, recovery median. Follow branch O3-S1 of plan 1.

Spec: spec-delivery-concurrency-and-autonomy-metrics (BR-1394, BR-1395, BR-1396).

Covers: AC-DC-1, AC-DC-2, AC-DC-3

## Must resolve before evidence

From the final review of the approved bundle (rev6). Resolve each item before recording evidence for this task.

1. spec-delivery-concurrency-and-autonomy-metrics, BR-1414 vs Scope row recovery_median: a main-red record that went red before the window and turned green inside it - is it in the median? Decide (the rule says 'turned green in the window') and assert it.
2. spec-delivery-concurrency-and-autonomy-metrics, BR-1420 / LANDING_COMMIT_PATTERN / AC-DC-1: the rule is enforced_by guaranteed but lore cannot prevent a force-push of main, and a hand-made merge commit matching /^merge\(/ would count as a landing. State both assumptions and how they are enforced or detected (e.g. the existing main ref guard, integrate-only merge marker), or weaken enforced_by.

Each decision must be recorded in the spec (rule text via `lore rule propose ... amend`, Design Decisions row, and the criterion if its assertion changes) when this task lands, through the normal review and approval of that spec revision.
