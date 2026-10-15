---
id: TASK-1212
type: task
role: plan
title: "[Skill:test] Rollback e2e: mode off / no baseline docs leaves outputs unchanged (AC-BLS2-11)"
status: archived
priority: critical
phase: "Phase 5: Backfill and acceptance"
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PLAN-178
plan: PLAN-178
links:
  - {id: TASK-1209, type: blocks}
---
Estimate: M
Source: spec AC-BLS2-11; slice-1 tests/e2e/baseline-rollback.bun.test.ts pattern
TDD-Role: guard
Covers: AC-BLS2-11
AC:
- Throwaway corpora: (a) no baseline docs, (b) baseline docs with gate mode off; status, ac add/set/cite, feed task-start, get outputs byte-identical to a control built without slice-2a behaviour
- Red-first by mutation: make the gate default to report without baseline docs; the test fails; record that run as expected-fail on THIS task, then restore
- cd packages/lore && bun test tests/e2e/baseline-slice2-rollback.bun.test.ts passes on main after Phases 1-4 merged
