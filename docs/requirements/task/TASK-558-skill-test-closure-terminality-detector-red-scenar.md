---
id: TASK-558
type: task
role: plan
title: "[Skill:test] closure terminality detector RED scenarios"
status: archived
priority: high
phase: "Phase 1: Terminality detector"
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PLAN-111
plan: PLAN-111
links:
  - {id: TASK-561, type: blocks}
---
Estimate: S
Source: AC of the paired impl task (terminality detector), spec DD-1
TDD-Role: red | Paired-Impl: terminality detector
Dimensions: D-FUNC

Scenarios (packages/lore/tests/unit/service/tree-check-service.bun.test.ts — extend the existing file; group name MUST contain "plan-terminality" so the AC's -t filter matches):
- HAPPY: Given a non-terminal plan with 2 child tasks, both archived, When checkTree runs, Then drifts include kind "plan-terminality" naming that plan.
- BOUNDARY (vacuous guard): Given a non-terminal plan with ZERO child tasks, Then NO plan-terminality drift.
- NEGATIVE: Given a non-terminal plan with 2 children, one archived and one active, Then NO plan-terminality drift.
- STATE: Given an ALREADY archived plan whose children are all archived, Then NO plan-terminality drift.
- BOUNDARY: a child task that is `deprecated` counts as terminal (same as archived).

AC:
- All scenarios exist as executable tests; run → all RED with failure reason "missing implementation" (kind not produced), not test bugs.
- Assert the matched test count is > 0 for the `-t "plan-terminality"` filter (a zero-match filter is indistinguishable from a pass in some runners).
