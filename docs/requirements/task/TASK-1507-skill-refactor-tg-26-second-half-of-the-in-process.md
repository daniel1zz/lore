---
id: TASK-1507
type: task
role: plan
title: "[Skill:refactor] TG-26 second half of the in-process command test migration"
status: archived
priority: medium
phase: "Phase 3b: one runner"
created: 2026-10-17
updated: 2026-10-17
tags: []
parent: PLAN-201
plan: PLAN-201
links:
  - {id: TASK-1498, type: blocks}
  - {id: TASK-1496, type: blocks}
---
Estimate: L
Approach: Second half of the 67 command-logic files onto T25's in-process helper. Report the before/after binary-start count and the serial-time change.
Source: spec-test-governance-guards-that-refuse-bad-tests-declared; decision: adr-tg-1-test-runner-decision-measured-comparison-of-bun-only (option b, accepted 2026-10-17)
AC: only the 17 binary-only files (named in the ADR) still start dist/lore.
