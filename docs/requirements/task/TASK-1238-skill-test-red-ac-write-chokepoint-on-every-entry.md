---
id: TASK-1238
type: task
role: plan
title: "[Skill:test] RED: AC write chokepoint on every entry point (AC-BLS2-1)"
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
Source: spec-baseline-slice-2-completeness-census-per-branch-citation AC-BLS2-1 (oracle file named in the AC)
TDD-Role: red
Covers: AC-BLS2-1
Scenarios:
- Given an approved spec with criteria, When CorpusService.set replaces extra with a changed acceptance_criteria array, Then refused with code AC_WRITE_NOT_VIA_AC_VERB and the spec is unchanged
- Given the same spec, When the MCP lore_set handler sends a changed criteria array, Then the same refusal code
- Given the same spec, When the HTTP PATCH route sends a changed criteria array, Then the same refusal code
- Given a create with acceptance_criteria in extra, Then refused unless created through the AC verbs path
- Given a set whose criteria array is byte-identical to the stored one (other keys change), Then accepted
- Given lore ac add/set/cite, Then accepted and the audit row's actor is the calling actor, not 'system'
AC:
- All scenarios written as executable tests in packages/lore/tests/unit/service/ac-write-chokepoint.test.ts
- Run the AC's oracle command BEFORE any implementation: it fails, and the failure is missing implementation (unresolved import / assertion on absent behaviour), not a test bug
- Record that red run on THIS task on the spot: lore evidence <task> --oracle test --command "<the AC command>" --capture --result expected-fail
- Commit the test file in the worktree, then lore release; never edit implementation files
