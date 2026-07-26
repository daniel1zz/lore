---
id: TASK-268
type: task
role: plan
title: "[Skill:test] Migration — RED (bun test)"
status: archived
priority: critical
phase: "Phase 3: Adapters and migration"
created: 2026-07-19
updated: 2026-07-19
tags: []
parent: PLAN-068
plan: PLAN-068
links:
  - {id: TASK-264, type: blocks}
---
Estimate: S
Source: SPEC-056 AC-P-5 + T3 fixture seed
TDD-Role: red | Paired-Impl: T10
Covers: AC-P-5
Scenarios:
- Given the T3-seeded fixture (>=8 tasks, 3 plans, legacy_phase, multi-claim, >50 evidence, empty declared phase), When migrated, Then aggregate diff=0 AND per-field fidelity on >=2 phases (claim holder, every ac_ref+origin, anchors byte-equal)
- Given a second run, When migrated again, Then 0 new writes
AC:
- phase-migration.bun.test.ts exists, RED for missing-implementation reasons only
