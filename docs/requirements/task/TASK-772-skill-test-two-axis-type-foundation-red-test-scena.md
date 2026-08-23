---
id: TASK-772
type: task
role: plan
title: "[Skill:test] Two-axis type foundation — RED test scenarios"
status: draft
priority: critical
phase: "P0 Type foundation"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-137
plan: PLAN-137
links:
  - {id: TASK-771, type: blocks}
---
Estimate: S
Source: SPEC-143 C1/C2, AC-CT-9(c); real-git-port.ts::BranchMeasurement as the shape precedent
TDD-Role: red | Paired-Impl: the P0 type-foundation task
Dimensions: D-CODE

Scenarios:
- Given the five StampVerdict readings, When readStampVerdict is called with each of the five (stamp,radius) combinations, Then it returns bound / stale / radius_unmeasured / unbound / legacy_unbound respectively and the returned set has size 5.
- Given a sixth hypothetical StampClass member added to the union, When tsc compiles, Then the build FAILS at readStampVerdict's never exhaustiveness check (compile-failure fixture, not a runtime assertion).
- Given a RadiusMeasurement value, When it is {status:"measured",changed:true} and {status:"unmeasured"}, Then both arms are constructible and narrow correctly; ⛔ a bare boolean or the string "unmeasured" MUST NOT type-check as RadiusMeasurement.
- Given StateStamp and ARMING_REV, When imported from @lore/core, Then no Node builtin is pulled into the browser-safe barrel (the dashboard imports it).

AC:
- All four scenarios exist as executable tests/fixtures.
- Running them BEFORE the implementation lands is RED, and the failure reason is "missing implementation" (unresolved import / unknown symbol), NOT a test bug.
- ⛔ The red is recorded by THIS agent at the moment it is red: lore evidence <this task> --oracle test --command "<cmd>" --result expected-fail.
