---
id: TASK-2099
type: task
role: plan
title: "Metric envelope, eleven-question registry and lore metrics command"
status: draft
priority: medium
phase: "Honesty"
created: 2026-10-25
updated: 2026-10-26
tags: []
parent: PLAN-256
plan: PLAN-256
links:
  - {id: TASK-2098, type: blocks}
  - {id: TASK-2060, type: blocks}
  - {id: TASK-2122, type: blocks}
  - {id: TASK-2127, type: blocks}
  - {id: TASK-2126, type: blocks}
  - {id: TASK-2125, type: blocks}
  - {id: TASK-2121, type: blocks}
  - {id: TASK-2092, type: blocks}
  - {id: TASK-2124, type: blocks}
  - {id: TASK-2106, type: blocks}
  - {id: TASK-2105, type: blocks}
  - {id: TASK-2110, type: blocks}
---
## Objective
Build the metric envelope, the ordered A–K question registry (one module per question under `service/metrics/questions/`, registering no metric until its slice lands, so each question is listed unanswered with reason "no metric registered", A-D12, AC-EM-4) and the read-only `lore metrics [--question] [--since] [--until] [--json]` command.

Spec: spec-evaluation-metric-envelope-and-honest-origins (rules BR-1382, BR-1384, BR-1385). Keep the falsifier literals named in the spec's Design Decisions.

Covers: AC-EM-1, AC-EM-3, AC-EM-4
