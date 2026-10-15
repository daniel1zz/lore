---
id: TASK-1235
type: task
role: plan
title: "[Skill:test] RED: claim-scoped corpus authoring from a worktree (AC-BLS2-8)"
status: archived
priority: medium
phase: "Phase 1: Write paths"
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PLAN-178
plan: PLAN-178
---
Estimate: S
Source: spec-baseline-slice-2-completeness-census-per-branch-citation AC-BLS2-8 (oracle file named in the AC)
TDD-Role: red
Covers: AC-BLS2-8
Scenarios:
- Given a throwaway corpus and a task claimed from a git worktree with corpus scope = branch X, When that session adds a rule to a leaf of X, Then it lands and the version and audit rows carry the claiming actor
- Given the same session, When it writes a leaf of branch Y or a non-baseline doc, Then refused with the foreign-corpus-write token
- Given a worktree session without corpus scope, When it adds a rule, Then refused
- Given 2 scoped sessions on 2 leaves of X in parallel, Then both writes land with distinct actors
- Given scoped writes of ac cite and baseline map, Then accepted inside scope
AC:
- All scenarios written as executable tests in packages/lore/tests/integration/cli/corpus-scope-lease.bun.test.ts
- Run the AC's oracle command BEFORE any implementation: it fails, and the failure is missing implementation (unresolved import / assertion on absent behaviour), not a test bug
- Record that red run on THIS task on the spot: lore evidence <task> --oracle test --command "<the AC command>" --capture --result expected-fail
- Commit the test file in the worktree, then lore release; never edit implementation files
