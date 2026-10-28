---
id: TASK-2083
type: task
role: plan
title: "Red tests: diagnosis flags, issue parts and label, listing diagnosis, diagnose verb"
status: draft
priority: high
phase: "P1 Red"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-254
plan: PLAN-254
links:
  - {id: TASK-2115, type: blocks}
---
Covers: AC-MI-1, AC-MI-2, AC-MI-3, AC-MI-4
TDD-Role: red
Approach: fake GitHub port only (never the real repository). Name the new it() blocks 'AC-MI-1' and 'AC-MI-2' in the two existing files; keep their current cases unchanged (the field-block assertions are invariant I2). AC-MI-3 fixtures: four issues with label states mechanism, symptom-only, none, both. AC-MI-4 asserts byte identity of the text outside the diagnosis parts.
Done when: all four commands run red; expected-fail captured.
