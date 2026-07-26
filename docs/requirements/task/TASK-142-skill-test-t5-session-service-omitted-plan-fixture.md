---
id: TASK-142
type: task
role: plan
title: "[Skill:test] T5 session-service omitted-plan fixture (extend-only)"
status: draft
priority: medium
phase: "Phase 2: Surfaces (parallel)"
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PLAN-032
plan: PLAN-032
links:
  - {id: TASK-141, type: blocks}
---
Estimate: S
Source: AC-080-2; SPEC-057 frozen-baseline discipline (extend-only); SPEC-080 §Test Plan STATE dimension
TDD-Role: red-green in one task (fixture authored against T2's landed fn — projection is core-side, this task pins the service→projection seam)
Dimensions: D-FUNC
Scope-Alt: none — this is AC-080-2's oracle
Covers: AC-080-2

Scenarios:
- Given a corpus with 3 actionable plans (each ready>0) where ONLY the 3rd-by-last_activity_at plan's task holds a fresh claim, When SessionService.bootstrap produces the full report and buildBootstrapInjection runs with maxActivePlans=2, Then payload.active_plans has 2 entries + omitted.active_plans=1 AND payload.active_sessions still lists the omitted plan's session (projection never feeds derivation — the report's own active_sessions was computed over ALL plans).
- Given the existing SPEC-057 frozen-baseline suite, When this fixture lands, Then the frozen describe blocks are byte-untouched (appended describe only).

AC:
- `bunx vitest run packages/lore/tests/unit/service/session-service.test.ts` → GREEN, matched file count 1 asserted.
- `git diff --stat` for session-service.test.ts shows additions only inside a NEW describe block (no hunks intersect the frozen baseline ranges).
