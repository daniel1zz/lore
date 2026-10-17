---
id: TASK-1536
type: task
role: plan
title: "[Skill:test] TG-33 declare inputs of the two gh tests that landed before the read check"
status: archived
priority: critical
phase: "Phase 4: selector"
created: 2026-10-17
updated: 2026-10-17
tags: []
parent: PLAN-201
plan: PLAN-201
---
Estimate: S
Approach: main is red since the T13 merge (9bcb6c1f) landed after T11B (5e2a5017): the two files T11B added — packages/lore/tests/integration/cli/report-issue-no-quota-gh.bun.test.ts and issue-read-surfaces-gh.bun.test.ts — read repository inputs without `// @reads` / `// @spawns` declarations, so T13's run-time check fails them (measured on main 070c82a0: 5 failed tests, UndeclaredTestInputError naming each path). Add exactly the declarations the recorder reports (run with LORE_TEST_READS_REPORT=<file> to list them), nothing broader than needed.
Source: spec-test-governance-guards-that-refuse-bad-tests-declared (AC-TG-7; INV-2 main stays green)
AC: both files pass on main under `bunx --bun vitest run`.
