---
id: TASK-2097
type: task
role: plan
title: "Retire the superseded S-C rule proposals and close plan-evaluation-3"
status: draft
priority: medium
phase: "Measures"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-255
plan: PLAN-255
---
## Objective
Retire the superseded spec-delivery-concurrency-and-autonomy-metrics (S-C) and close plan-evaluation-3, so no duplicate or conflicting rule proposal stays pending (S3 round 2, crossdoc 4; plan 12). Claimable only once the successor spec is approved (task-claim gate on the plan's parent spec), so S-C is never retired before its successor holds.

Steps, run by the main agent on the shared checkout:
1. `lore set spec-delivery-concurrency-and-autonomy-metrics --status deprecated` (its criteria are already superseded by the successor's AC-DC-1..7).
2. `lore rule apply spec-delivery-concurrency-and-autonomy-metrics`: a deprecated spec never lands; apply retires its still-proposed ids BR-1394, BR-1395, BR-1396, BR-1397, BR-1398, BR-1412, BR-1414, BR-1415, BR-1419, BR-1420 with the note "never landed: spec-delivery-concurrency-and-autonomy-metrics" (rule-change-service.ts landing invariants). Check with `lore rule show BR-1395` that it reads retired.
3. `lore bulk archive` (preview, then --apply) on the two retracted tasks task-delivery-measures-lead-time-landings-change-fail-rework and task-concurrency-ledger-and-unattended-autonomy-share (invalidated drafts, superseded by this plan's tasks), then close plan-evaluation-3, whose only other child is the archived main-red task.

Spec: spec-delivery-concurrency-and-autonomy-metrics-fed-by-live (C2-D2).

Covers: none. Closing route: the corpus-only route defined by the landing-predicate governance spec (#356).
