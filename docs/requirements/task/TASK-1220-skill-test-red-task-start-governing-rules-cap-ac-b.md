---
id: TASK-1220
type: task
role: plan
title: "[Skill:test] RED: task-start governing-rules cap (AC-BLS2-7)"
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
Source: spec-baseline-slice-2-completeness-census-per-branch-citation AC-BLS2-7 (oracle file named in the AC)
TDD-Role: red
Covers: AC-BLS2-7
Scenarios:
- Given a task whose spec cites 120 rules, When the task-start feed renders, Then at most 40 rules are listed (cited first) and a line '+80 more' follows
- Given a task touching file F covered by another spec's anchors citing BR-z, Then BR-z appears after the cited rules
- Given no baseline documents, Then the section is absent (byte-identical to today's feed)
AC:
- All scenarios written as executable tests in packages/lore/tests/unit/service/feed-governing-rules.test.ts
- Run the AC's oracle command BEFORE any implementation: it fails, and the failure is missing implementation (unresolved import / assertion on absent behaviour), not a test bug
- Record that red run on THIS task on the spot: lore evidence <task> --oracle test --command "<the AC command>" --capture --result expected-fail
- Commit the test file in the worktree, then lore release; never edit implementation files
