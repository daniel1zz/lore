---
id: TASK-869
type: task
role: plan
title: "[Skill:test] lore context write gate honours adoption — RED"
status: archived
priority: medium
phase: "Phase 2: Surfaces"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-149
plan: PLAN-149
---
Estimate: S
Source: spec-claude-md-root-section-structure-check-and-adoption-mode AC-STR-6; existing gate at packages/lore/src/flows/context-flow.ts (refuses when deterministic non-empty)
TDD-Role: red | Paired-Impl: I2
Covers: AC-STR-6

Scenarios:
- Given adoption enforce and a candidate root CLAUDE.md missing '## Commands', When the context flow writes, Then it returns an error naming section_missing AND the target file bytes are unchanged.
- Given adoption warn, same input, Then the file is written and the result reports an advisory downgraded finding with downgraded_kind section_missing.
- Given adoption absent (defaults warn), Then behaves as warn.

AC:
- Test exists; RED on the current base for missing implementation; record `lore evidence <this-task> --oracle test --result expected-fail --ac AC-STR-6 --command "<cmd>"` at the moment it is red.
