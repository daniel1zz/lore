---
id: TASK-2075
type: task
role: plan
title: "Telemetry rules and current values describe opt-in recording"
status: draft
priority: medium
phase: "Honesty"
created: 2026-10-25
updated: 2026-10-26
tags: []
parent: PLAN-256
plan: PLAN-256
---
> ⚠ INVALIDATED 2026-10-26T04:43:06.263Z — superseded by task-telemetry-opt-in-rule-texts-and-on-off-oracle; Carried #409 in extra.issues; archiving it would close #409 before the #409 governance plan fixes it, and no CLI verb removes an issue ref. Recreated without the issue, same plan, phase, AC-EM-5 scope, body and blocks links

## Objective
Pin telemetry's opt-in behaviour (AC-C3) with the on/off oracle test AC-EM-5, and land the rule texts BR-993 and BR-1013 ("off unless the project switches it on") through `lore rule apply` when the spec lands. Narrowed in S3 round 2 (crossdoc 1): this task does NOT edit the Current values row of baseline-measure-corpus-usage and does not resolve #409; the #409 governance spec owns those rows and how the telemetry setting is governed. The AC-EM-5 falsifier lives in packages/core/src/telemetry-node.ts (createTelemetry's opt-in check), which the #409 change keeps.

Spec: spec-evaluation-metric-envelope-and-honest-origins (BR-993, BR-1013 modified). Related: #409 (resolved by its own governance plan).

Covers: AC-EM-5
