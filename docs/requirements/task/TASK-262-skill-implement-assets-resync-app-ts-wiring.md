---
id: TASK-262
type: task
role: plan
title: "[Skill:implement] Assets resync + app.ts wiring"
status: archived
priority: high
phase: "Phase 3: Adapters and migration"
created: 2026-07-19
updated: 2026-07-19
tags: []
parent: PLAN-068
plan: PLAN-068
links:
  - {id: TASK-260, type: blocks}
---
Estimate: S
Approach: grep assets/ for task-claim/task_claim references; update vendored skills/hooks to phase-claim with alias notes; wire new services in app.ts (optional-DI shapes preserved)
Source: spec-spec-056 PRD §18 sequencing constraint (assets resync SAME change as rename)
Dimensions: D-FUNC
Scope-Alt: none — same-release constraint is hard
Covers: AC-P-6
AC:
- Given assets-ssot conformance suite, When run, Then green with updated references
- Given app.ts wiring, When bare-constructed services in unit tests, Then ungated behavior unchanged (optional-DI regression)
