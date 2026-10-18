---
id: TASK-1544
type: task
role: plan
title: "[Skill:implement] AU-T9 threshold record integrity: fail-safe escalate, git-tracked mirror, pre-push head check"
status: archived
priority: high
phase: "Phase 1c: overrides, calibration, integrity"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-204
plan: PLAN-204
links:
  - {id: TASK-1543, type: blocks}
  - {id: TASK-1546, type: blocks}
---
Estimate: M
Approach: one corpus record for class thresholds/priors/tiers written only through lore (chain-linked); mismatch -> every factor unmeasured -> escalate with reason threshold-integrity, lore status names it; mirrored as a git-tracked file by mirror export; pre-push (hooks/pre-push and assets/project/pre-push) verifies the local decision chain reproduces every head already pushed. Red-first halves (1)-(4).
Source: spec-autonomy-phase-1-decision-function-human-channel-lore; decision: adr-autonomy-is-decided-by-measured-facts-one-decision-function
AC: AC-AU-9.
