---
id: TASK-1218
type: task
role: plan
title: "[Skill:test] RED: census completeness + determinism (AC-BLS2-15)"
status: archived
priority: medium
phase: "Phase 2: Indexes and census"
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PLAN-178
plan: PLAN-178
---
Estimate: S
Source: issues #59 and #60 (filed by the slice-2a backfill agents); AC-BLS2-15
TDD-Role: red
Covers: AC-BLS2-15
Scenarios:
- Given a fixture command whose service calls a core pure function returning `{ ok: false, error: { code: "VALIDATION_ERROR", field: "x" } }` (no err() call), When the census runs, Then that construction is a site
- Given a fixture CLI handler that refuses with a usage error object typed as the product error, Then it is a site
- Given one function with two `err({ code: "VALIDATION_ERROR", field: "a" })` and `err({ code: "VALIDATION_ERROR", field: "b" })`, Then two distinct keys ending in #a and #b
- Given the same fixture analysed with node_modules/@lore/core pointing (a) at the workspace package and (b) at a copy outside the analysed root, Then the two key lists are byte-identical
AC:
- Tests in packages/lore/tests/unit/service/site-census-fidelity.test.ts (+ fixtures under packages/lore/tests/fixtures/site-census-fidelity/), dynamic imports only, typecheck-clean
- Red for missing behaviour; expected-fail recorded on THIS task on the spot
