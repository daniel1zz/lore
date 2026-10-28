---
id: TASK-2042
type: task
role: plan
title: "Milestone review records main red locally"
status: archived
priority: medium
phase: "Delivery and concurrency"
created: 2026-10-25
updated: 2026-10-26
tags: []
parent: PLAN-267
plan: PLAN-267
links:
  - {id: TASK-2060, type: blocks}
  - {id: TASK-2106, type: blocks}
  - {id: TASK-2002, type: blocks}
---
## Objective
Make the milestone review record main red locally at detection (commit range checked, failing checks, time) whether or not issue filing succeeds, and record the green time on the open record later; delivery and AI-decision metrics read these records, never the issue tracker over the network. Issue filing stays behind its injectable port.

Spec: spec-delivery-concurrency-and-autonomy-metrics (BR-1412).

Covers: AC-DC-6

## Must resolve before evidence

From the final review of the approved bundle (rev6). Resolve each item before recording evidence for this task.

1. spec-delivery-concurrency-and-autonomy-metrics, BR-1412 / BR-1395 / BR-1414 / C-D3 / C-D6: main-red and green times are written when the milestone review runs, so if it runs less often than every 7 days the change fail rate drifts towards 0 and recovery_median measures review spacing. Decide the detection cadence guarantee, or base the failure time on the first failing commit / time of failure instead of detection time.

Each decision must be recorded in the spec (rule text via `lore rule propose ... amend`, Design Decisions row, and the criterion if its assertion changes) when this task lands, through the normal review and approval of that spec revision.
