---
id: TASK-2121
type: task
role: plan
title: "Safety: reversed automatic decisions per class"
status: draft
priority: medium
phase: "Overhead, fitness and safety"
created: 2026-10-25
updated: 2026-10-25
tags: []
parent: PLAN-272
plan: PLAN-272
links:
  - {id: TASK-2091, type: blocks}
---
## Objective
Report question K as one metric: automatic decisions later reversed over those the outcome sweep has settled, per decision class.

Spec: spec-governance-cost-reuse-stability-and-safety-metrics (BR-1404).

Covers: AC-GV-7

## Must resolve before evidence

From the review of baseline leaf `baseline-measure-safety` (escalated). Resolve before recording evidence for this task.

1. spec-governance-cost-reuse-stability-and-safety-metrics, BR-1404 / AC-GV-7 vs spec-ai-decision-correctness-outcome-attribution-and-audit BR-1409 / AC-AD-8: question K's per-class reversed share of settled automatic decisions is the same figure question A shows. Decide how K differs, e.g. restricted to the operation classes the autonomy registry marks irreversible, as a filtered view of A's figure rather than a second computation.
2. Same rules: K's purpose is "dangerous operations caught before damage", but a reversal is found after the fact. Decide whether K also (or instead) counts interception, with refused or escalated operations of those classes as the numerator, and which recorded fact (decision record verdict refuse / escalate) supplies it.

The decision must be recorded in spec S-D (rule BR-1404 via `lore rule propose ... amend`, a Design Decisions row, and AC-GV-7 if its assertion changes) and in leaf `baseline-measure-safety` (its open question Q1) when this task lands, through the normal review and approval.
