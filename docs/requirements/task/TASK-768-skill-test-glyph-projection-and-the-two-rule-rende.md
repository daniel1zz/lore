---
id: TASK-768
type: task
role: plan
title: "[Skill:test] glyph projection and the two-rule renderer scan — RED test scenarios"
status: draft
priority: critical
phase: "P1 Independent labels"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-137
plan: PLAN-137
links:
  - {id: TASK-767, type: blocks}
---
Estimate: M
Source: AC of the paired glyph/scan task; SPEC-143 AC-CT-1, AC-CT-7, C4, C8, D7
TDD-Role: red | Paired-Impl: the AC-CT-1 + AC-CT-7 task
Dimensions: D-FUNC, D-CODE

Scenarios:
- Given all seven deriveAcCoverageState outputs, When each is projected, Then the resulting glyph set has size exactly 7 (enumerate all seven; ⛔ spot-checking two does not satisfy this).
- Given an eighth state added to the union, When tsc runs, Then the build fails at the never exhaustiveness check — a compile-failure fixture, not prose.
- Given a fixture violating ONLY scan rule 2 (a non-allowlisted function taking an AcCoverageFact and yielding a glyph), When the scan runs with --rule glyph-projection, Then it exits EXACTLY 1 naming that function.
- Given a fixture violating ONLY scan rule 1 (a .fail read outside acceptance.ts), When the scan runs with --rule glyph-projection, Then it exits EXACTLY 0 — ⛔ this direction is what proves the flag is not silently inert.
- Given a fixture violating only rule 1, When the scan runs with NO --rule flag, Then it exits EXACTLY 1 (no flag runs both rules).
- Given the scan cannot complete at all, Then it exits EXACTLY 2, distinct from a violation.

AC:
- All six scenarios exist as executable tests/fixtures.
- Running them before the implementation is RED for missing-implementation reasons.
- ⛔ Red recorded by THIS agent at the moment it is red: `lore evidence <this task> --oracle test --command "<cmd>" --result expected-fail --ac AC-CT-1 --ac AC-CT-7`.
  ⛔ The `--ac` reference is mandatory, not decoration: without it the red is free prose and "which ACs have an observed-red falsifier" stays unqueryable corpus-wide — the exact residual SPEC-143's own Falsifier-debt section names.
