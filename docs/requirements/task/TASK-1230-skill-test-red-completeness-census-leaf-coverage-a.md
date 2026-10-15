---
id: TASK-1230
type: task
role: plan
title: "[Skill:test] RED: completeness census + leaf coverage (AC-BLS2-5)"
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
Source: spec-baseline-slice-2-completeness-census-per-branch-citation AC-BLS2-5 (oracle file named in the AC)
TDD-Role: red
Covers: AC-BLS2-5
Scenarios:
- Given a fixture command entry calling a service method with 3 `return err({code})` sites, 1 gate-predicate failure and 1 call through a registry lookup, When the census runs, Then it lists 4 sites keyed file#symbol#code and 1 not_measured
- Given a fixture leaf whose site_map maps 3 of the 4 sites, Then coverage reports exactly 1 gap and 1 not_measured and exits non-zero
- Given a site mapped to a retired rule, Then reported as a gap
- Given every site mapped (or non-business with a reason) and the dynamic site justified, Then coverage exits 0
- Given lore baseline map writes, Then site_map is a dedicated extra key refused by wholesale set
AC:
- All scenarios written as executable tests in packages/lore/tests/unit/service/site-census.test.ts
- Run the AC's oracle command BEFORE any implementation: it fails, and the failure is missing implementation (unresolved import / assertion on absent behaviour), not a test bug
- Record that red run on THIS task on the spot: lore evidence <task> --oracle test --command "<the AC command>" --capture --result expected-fail
- Commit the test file in the worktree, then lore release; never edit implementation files
