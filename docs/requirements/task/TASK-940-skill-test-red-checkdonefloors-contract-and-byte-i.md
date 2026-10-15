---
id: TASK-940
type: task
role: plan
title: "[Skill:test] RED - checkDoneFloors contract and byte-identical done refusals (#47)"
status: archived
priority: high
phase: "plan-close-floors"
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PLAN-154
plan: PLAN-154
links:
  - {id: TASK-939, type: blocks}
---
Estimate: S
Source: spec-approval-and-plan-closure-go-through-the-same-checks-on AC-AP-9
TDD-Role: red | Paired-Impl: task-skill-implement-extract-checkdonefloors-and-wire-the
Scenarios:
- NEW packages/lore/tests/unit/service/check-done-floors.test.ts (AC-AP-9 cases a-g): TaskWorkflowService on InMemoryStore; one task per floor; deep-equality between checkDoneFloors' error and done()'s refusal; override case; floor order case.
Dimensions: HAPPY (e), NEGATIVE (a-d), BOUNDARY (g order), STATE (no writes on refusal), REGRESSION (f override unchanged).
AC:
- Run every listed file against current main. New cases must fail on ASSERTIONS, not harness errors; a red that is a call to the not-yet-existing method the paired task adds (TypeError ... is not a function) is acceptable only for that method; say so in the evidence.
- At the moment of red, the agent that ran it records `lore evidence <this task> --oracle <test|e2e> --command "<exact command> 2>&1" --result expected-fail --capture`, one row per file (`2>&1` is required: --capture stores all stdout then all stderr, so without it the runner summary can fall out of the stored tail). Never transcribe a red later.
- Commit the tests on this task's branch; the paired implement task branches from that commit; never merge red to main alone.
