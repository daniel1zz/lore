---
id: TASK-146
type: task
role: plan
title: "[Skill:test] T1 buildBootstrapInjection RED unit suite"
status: draft
priority: high
phase: "Phase 1: Core contract"
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PLAN-032
plan: PLAN-032
links:
  - {id: TASK-145, type: blocks}
---
Estimate: S
Source: SPEC-080 §Test Plan (HAPPY/NEGATIVE/BOUNDARY/ERROR) + AC-080-1
TDD-Role: red | Paired-Impl: [Skill:implement] T2 core fn+schema+config
Dimensions: D-FUNC
Scope-Alt: none — this suite IS AC-080-1's oracle
Covers: AC-080-1

Scenarios (Given/When/Then, all against `buildBootstrapInjection(report, budgets)`):
- Given a representative full BootstrapReport and default budgets {5,3,3,8000}, When projected, Then payload key order equals the literal contract list (resume_hint, my_claims, active_sessions, armed_gates, root, pending_reviews, active_plans, latest_handoffs, corpus, omitted) and json is compact (no "\n  ").
- Given plans with ready=0 AND claimed=0 but recent last_activity_at, When projected, Then they are excluded and counted in omitted.active_plans.
- Given 7 actionable plans, When maxActivePlans=5, Then 5 newest-by-last_activity_at survive, omitted.active_plans=2.
- Given armed_gates entries with feeding_source_slug, When projected, Then armed_gates is a string[] of checkpoint names only.
- Given pending_reviews with 10 slugs, When maxPendingSlugs=3, Then slugs length 3 + omitted.pending_slugs=7 + count field preserved.
- BOUNDARY: payload serializes to exactly charBudget chars → zero drops, no budget_exceeded; one handoff entry over → omitted.budget_drops=1 and json.length <= charBudget; single oversized resume_hint with active_plans/latest_handoffs already empty → budget_exceeded=true, payload intact, no mid-JSON slice; maxActivePlans=0 → active_plans [] + all counted omitted; empty-corpus report (root null, all arrays empty) → valid payload, ledger zeros.
- OCP: report carries an unknown future key, When projected, Then it appears between corpus and omitted (omitted/budget_exceeded always final two keys).
- ERROR/strip-hazard: bootstrapInjectionSchema round-trip preserves every payload field; NEGATIVE control — a field present on the payload literal but deliberately missing from a cloned schema vanishes on parse (pins the active_sessions incident class; proves the round-trip test would catch it).

AC:
- All scenarios exist as executable tests in packages/core/tests/unit/bootstrap-injection.test.ts.
- `bunx vitest run packages/core/tests/unit/bootstrap-injection.test.ts` → all RED; every failure is missing-implementation (module/export absent), not a test bug.
