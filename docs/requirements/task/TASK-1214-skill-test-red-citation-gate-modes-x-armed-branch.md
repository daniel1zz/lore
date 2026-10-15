---
id: TASK-1214
type: task
role: plan
title: "[Skill:test] RED: citation gate modes x armed branch + feeding pack (AC-BLS2-2)"
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
Source: spec-baseline-slice-2-completeness-census-per-branch-citation AC-BLS2-2 (oracle file named in the AC)
TDD-Role: red
Covers: AC-BLS2-2
Scenarios:
- Given mode enforce and the spec's branch armed, When an added criterion cites no live rule, Then refused; When it cites a retired id, Then refused
- Given mode enforce and the branch NOT armed, Then accepted and no audit row
- Given mode report and the branch armed, Then accepted and exactly 1 would-refuse audit row
- Given an untouched legacy uncited criterion on an armed branch, When a sibling criterion is added with a live cite, Then accepted
- Given a refusal, Then the feeding pack lists at most 5 candidate rules (code-anchor matches first), a paste-ready lore ac cite line and the remaining exemption headroom
- Given a corpus with no baseline documents and no config, Then the resolved mode is off
AC:
- All scenarios written as executable tests in packages/lore/tests/unit/service/cite-gate.test.ts
- Run the AC's oracle command BEFORE any implementation: it fails, and the failure is missing implementation (unresolved import / assertion on absent behaviour), not a test bug
- Record that red run on THIS task on the spot: lore evidence <task> --oracle test --command "<the AC command>" --capture --result expected-fail
- Commit the test file in the worktree, then lore release; never edit implementation files
