---
id: TASK-1213
type: task
role: plan
title: "[Skill:test] RED: retire-vs-cite race (AC-BLS2-3)"
status: archived
priority: medium
phase: "Phase 3: Citation gate"
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PLAN-178
plan: PLAN-178
---
Estimate: S
Source: spec-baseline-slice-2-completeness-census-per-branch-citation AC-BLS2-3 (oracle file named in the AC)
TDD-Role: red
Covers: AC-BLS2-3
Scenarios:
- Given an armed branch and rule BR-a live, When 8 sessions concurrently retire BR-a and cite BR-a on 8 criteria, Then every criterion citing BR-a after the run is either refused or flagged; 0 unflagged
- Given the same race in report mode, Then each criterion citing a retired rule is counted in cites_to_inactive
AC:
- All scenarios written as executable tests in packages/lore/tests/unit/store/cite-retire-race.bun.test.ts
- Run the AC's oracle command BEFORE any implementation: it fails, and the failure is missing implementation (unresolved import / assertion on absent behaviour), not a test bug
- Record that red run on THIS task on the spot: lore evidence <task> --oracle test --command "<the AC command>" --capture --result expected-fail
- Commit the test file in the worktree, then lore release; never edit implementation files
