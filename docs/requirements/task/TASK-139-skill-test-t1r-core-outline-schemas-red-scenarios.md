---
id: TASK-139
type: task
role: plan
title: "[Skill:test] T1r core outline schemas — RED scenarios"
status: archived
priority: critical
phase: "Phase 1: Core schemas & outline writer"
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PLAN-031
plan: PLAN-031
links:
  - {id: TASK-138, type: blocks}
---
Estimate: S
Source: AC of task T1 (SPEC-080 C1/C2/C3 schema shapes)
TDD-Role: red | Paired-Impl: T1 core schemas

Scenarios:
- Given a valid OutlineEntry object with tier "core", When outlineEntrySchema.parse runs, Then it passes and preserves all 7 fields.
- Given an OutlineEntry with unknown tier value, When parsed, Then ZodError names the tier field.
- Given links entry with rel outside detail|landing-spec|adr, When parsed, Then ZodError names rel.
- Given extra.outline_budget with non-positive section budget, When parsed, Then ZodError.
- Given spec extra with spec_kind "domain-overview", When createDocInputSchema validates, Then it passes; Given "domain-orview" (typo), Then VALIDATION_ERROR.
- Given prd_sync_exempt missing reason, When schema validates, Then error names reason as required.

AC:
- All scenarios written as executable tests (vitest, packages/lore/tests/unit/core/outline-schemas.test.ts)
- Run tests → all RED (fail because implementation missing, not test bugs)
