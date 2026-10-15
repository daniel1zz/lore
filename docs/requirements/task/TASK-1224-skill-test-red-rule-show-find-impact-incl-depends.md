---
id: TASK-1224
type: task
role: plan
title: "[Skill:test] RED: rule show/find/impact incl. depends-on cycle (AC-BLS2-6)"
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
Source: spec-baseline-slice-2-completeness-census-per-branch-citation AC-BLS2-6 (oracle file named in the AC)
TDD-Role: red
Covers: AC-BLS2-6
Scenarios:
- Given rule BR-x cited by 2 criteria, When rule show BR-x, Then statement, leaf, confidence, computed state and both citing criteria are printed
- Given a spec with a code anchor on file F citing BR-y, When rule find --file F, Then BR-y is returned; --spec and --text likewise
- Given leaves L1->L2->L3->L1 via depends-on, When rule impact on a rule of L1, Then the cycle is reported by its 3 members and the command ends in under 1 s
- Given rule impact on BR-x, Then citing criteria and transitively dependent leaves are listed
AC:
- All scenarios written as executable tests in packages/lore/tests/unit/service/rule-read-impact.test.ts
- Run the AC's oracle command BEFORE any implementation: it fails, and the failure is missing implementation (unresolved import / assertion on absent behaviour), not a test bug
- Record that red run on THIS task on the spot: lore evidence <task> --oracle test --command "<the AC command>" --capture --result expected-fail
- Commit the test file in the worktree, then lore release; never edit implementation files
