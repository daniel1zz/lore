---
id: TASK-1472
type: task
role: plan
title: "[Skill:implement] R0-7 ac_scope resolution ignores deprecated specs (#237)"
status: archived
priority: high
phase: "Phase 1: fixes"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-200
plan: PLAN-200
links:
  - {id: TASK-1477, type: blocks}
---
Estimate: S
Resolves: task-gh-1343388703-237
Approach: in packages/core/src/acceptance.ts (~:1036) ac_scope resolution must ignore deprecated and invalidated specs when choosing the spec that declares an AC id; two live candidates stay ambiguous; only-deprecated is unresolved. Build packages/core before verifying lore dependents.
Covers: AC-R0-4
AC:
- AC-R0-4 red first, then green; scripts/tests/check-ac-ref-integrity.test.ts passes on main
