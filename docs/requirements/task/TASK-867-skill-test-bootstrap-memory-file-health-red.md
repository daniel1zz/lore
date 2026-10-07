---
id: TASK-867
type: task
role: plan
title: "[Skill:test] bootstrap memory_file_health — RED"
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
Source: spec-claude-md-root-section-structure-check-and-adoption-mode AC-STR-5, Public Interface memory_file_health; pattern tests/integration/bootstrap-*.bun.test.ts (bun:sqlite → .bun.test.ts)
TDD-Role: red | Paired-Impl: I3
Covers: AC-STR-5

Scenarios (throwaway corpus via mkdtemp + lore init):
- warn + root missing Commands and Module Index → `lore bootstrap --json` has memory_file_health {mode:'warn', missing:['Commands','Module Index'] (exact, in contract order), downgraded_count>=2}.
- enforce + clean root → field ABSENT.
- enforce + root over line ceiling (no structure issue) → field PRESENT with mode 'enforce' (capacity counts as failing); downgraded_count 0 because nothing is downgraded under enforce.
- warn + clean root → present with promotable true, downgraded_count 0.
- warn + only section_extra → promotable true (advisory never affects it).
- The non-JSON bootstrap text contains one line naming the missing sections when the field is present.

AC:
- RED on the current base for missing implementation; record expected-fail evidence at the moment it is red (--ac AC-STR-5).
