---
id: TASK-272
type: task
role: plan
title: "[Skill:test] PWS + phase-claim gate rename — RED"
status: archived
priority: critical
phase: "Phase 2: Services"
created: 2026-07-19
updated: 2026-07-19
tags: []
parent: PLAN-068
plan: PLAN-068
links:
  - {id: TASK-266, type: blocks}
---
Estimate: S
Source: SPEC-056 AC-P-3; SPEC-042 fixture file (IMPORT, never copy — plan invariant R4)
TDD-Role: red | Paired-Impl: PWS rename task
Covers: AC-P-3
Scenarios:
- Given the imported SPEC-042 anchor-overlap fixture on phase docs, When claimed by a foreign actor with overlapping anchors, Then rejected with phase-claim discriminator
- Given same-actor overlap, When claimed, Then NOT rejected (NEGATIVE)
- Given workflow.gates."task-claim" config on a phase-claim call, When resolved, Then honored with exactly 1 deprecation warning per process
AC:
- Both named test files exist and are RED for missing-implementation reasons only
