---
id: TASK-2076
type: task
role: plan
title: "Telemetry opt-in rule texts and on/off oracle"
status: draft
priority: medium
phase: "Honesty"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-256
plan: PLAN-256
links:
  - {id: TASK-2091, type: blocks}
  - {id: TASK-2109, type: blocks}
  - {id: TASK-2075, type: supersedes}
---
## Objective
Pin telemetry's opt-in behaviour (AC-C3) with the on/off oracle test AC-EM-5, and land the rule texts BR-993 and BR-1013 ("off unless the project switches it on") through `lore rule apply` when the spec lands. Narrowed in S3 round 2 (crossdoc 1): this task does NOT edit the Current values row of baseline-measure-corpus-usage and does not resolve #409; the #409 governance spec owns those rows and how the telemetry setting is governed. The AC-EM-5 falsifier lives in packages/core/src/telemetry-node.ts (createTelemetry's opt-in check), which the #409 change keeps.

Spec: spec-evaluation-metric-envelope-and-honest-origins (BR-993, BR-1013 modified). Related: #409 (resolved by its own governance plan).

Covers: AC-EM-5
