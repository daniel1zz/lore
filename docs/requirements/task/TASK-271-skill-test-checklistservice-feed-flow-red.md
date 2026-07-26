---
id: TASK-271
type: task
role: plan
title: "[Skill:test] ChecklistService + feed-flow — RED"
status: archived
priority: high
phase: "Phase 2: Services"
created: 2026-07-19
updated: 2026-07-19
tags: []
parent: PLAN-068
plan: PLAN-068
links:
  - {id: TASK-267, type: blocks}
  - {id: TASK-269, type: blocks}
---
Estimate: S
Source: SPEC-056 AC-P-4 + PhaseFeedFlowDeps interface; PhaseChecklistService verbs (AcService shape)
TDD-Role: red | Paired-Impl: T7+T8
Covers: AC-P-4
Scenarios:
- Given a seeded fixture with an invalidated linked knowledge doc, When buildPhaseStartPack, Then T3 excludes it and T1 sections complete
- Given over-budget section, When packed, Then truncated[] records it
- Given a plan with zero phases, When packed, Then typed err (not empty pack)
- Given checklist manual item statement edit, When checked existed, Then check voided
AC:
- Both named test files exist and are RED for missing-implementation reasons only
