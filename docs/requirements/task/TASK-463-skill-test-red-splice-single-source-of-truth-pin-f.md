---
id: TASK-463
type: task
role: plan
title: "[Skill:test] RED splice single source of truth pin for setup project flow"
status: archived
priority: medium
phase: "Phase 2: Capability"
created: 2026-07-27
updated: 2026-08-01
tags: []
parent: PLAN-088
plan: PLAN-088
---
Objective: author the RED vitest pin for AC-CTX-4 at packages/lore/tests/unit/flows/setup-splice-ssot.test.ts — assert setup-project-flow imports spliceManagedSections from context-projection AND no second marker-splice implementation remains (grep-pin on the retired computeClaudeMdCandidate splice body, keyed on lone tokens per contiguous-substring lesson). MUST be red before the refactor lands.
