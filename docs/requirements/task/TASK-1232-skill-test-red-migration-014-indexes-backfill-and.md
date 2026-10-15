---
id: TASK-1232
type: task
role: plan
title: "[Skill:test] RED: migration-014 indexes, backfill and mismatch count (AC-BLS2-4)"
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
Source: spec-baseline-slice-2-completeness-census-per-branch-citation AC-BLS2-4 (oracle file named in the AC)
TDD-Role: red
Covers: AC-BLS2-4
Scenarios:
- Given a schema-13 store with 2 leaves, 5 rules (1 retired) and 3 citing criteria, When migration-014 runs, Then rule_registry has lifecycle and version per rule, ac_cites has 3 rows, rule_depends mirrors each leaf's depends_on, ac_exemptions exists empty, user_version = 14
- Given migration-014 run twice, Then idempotent (same rows)
- Given an ac_cites row removed by hand, Then the baseline status mismatch count is 1; on a clean store it is 0
- Given a rule set changing lifecycle, Then registry lifecycle and version update in the same transaction
AC:
- All scenarios written as executable tests in packages/lore/tests/unit/store/migration-014.bun.test.ts
- Run the AC's oracle command BEFORE any implementation: it fails, and the failure is missing implementation (unresolved import / assertion on absent behaviour), not a test bug
- Record that red run on THIS task on the spot: lore evidence <task> --oracle test --command "<the AC command>" --capture --result expected-fail
- Commit the test file in the worktree, then lore release; never edit implementation files
