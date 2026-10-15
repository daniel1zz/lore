---
id: TASK-1240
type: task
role: plan
title: "[Skill:test] RED: rule-state snapshot parses only 4 doc types (AC-BLS2-9)"
status: archived
priority: medium
phase: "Phase 4: Rule read path"
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PLAN-178
plan: PLAN-178
---
Estimate: S
Source: spec-baseline-slice-2-completeness-census-per-branch-citation AC-BLS2-9 (oracle file named in the AC)
TDD-Role: red
Covers: AC-BLS2-9
Scenarios:
- Given an in-memory store with 1000 knowledge docs and a few baseline/spec/plan/task docs, When the rule-state snapshot loads, Then the store is queried only for baseline, spec, plan and task types (spy on findMany filters) and 0 knowledge docs are parsed
- Given the narrowed snapshot, Then computed rule states equal the unnarrowed computation on the same fixture
AC:
- All scenarios written as executable tests in packages/lore/tests/unit/service/rule-state-snapshot-scope.test.ts
- Run the AC's oracle command BEFORE any implementation: it fails, and the failure is missing implementation (unresolved import / assertion on absent behaviour), not a test bug
- Record that red run on THIS task on the spot: lore evidence <task> --oracle test --command "<the AC command>" --capture --result expected-fail
- Commit the test file in the worktree, then lore release; never edit implementation files
