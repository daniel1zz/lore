---
id: TASK-1228
type: task
role: plan
title: "[Skill:test] RED: criterion exemptions with cap under concurrency (AC-BLS2-10)"
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
Source: spec-baseline-slice-2-completeness-census-per-branch-citation AC-BLS2-10 (oracle file named in the AC)
TDD-Role: red
Covers: AC-BLS2-10
Scenarios:
- Given an exemption without a reason or without an expiry, Then refused
- Given 20 live criteria and 1 exemption, When a 2nd and 3rd are granted, Then the 3rd (15%) is refused naming the 10% cap
- Given 8 concurrent grants that would each fit alone, Then at most the cap is granted and the rest refused, never exceeding 10%
- Given an expired exemption, Then it no longer counts toward exemption totals and status shows it as expired
AC:
- All scenarios written as executable tests in packages/lore/tests/unit/service/ac-exempt.test.ts
- Run the AC's oracle command BEFORE any implementation: it fails, and the failure is missing implementation (unresolved import / assertion on absent behaviour), not a test bug
- Record that red run on THIS task on the spot: lore evidence <task> --oracle test --command "<the AC command>" --capture --result expected-fail
- Commit the test file in the worktree, then lore release; never edit implementation files
