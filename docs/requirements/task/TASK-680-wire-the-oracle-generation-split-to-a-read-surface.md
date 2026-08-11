---
id: TASK-680
type: task
role: plan
title: "Wire the oracle-generation split to a read surface so a retired oracle is visible as retired"
status: archived
priority: medium
phase: "read-surfaces"
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PLAN-127
plan: PLAN-127
---
Closes the capability-vs-wiring gap the M5 implementer reported: computeAcCoverage now carries oracle_generation {current, current_refs, prior_refs}, but NO renderer reads it, so an AC whose oracle reversed polarity still displays plain green. AC-DC-10's oracle MUST drive the surface (spawn the CLI), never the aggregator. This gap was a defect in the spec's M5 scope, not in the implementation.
