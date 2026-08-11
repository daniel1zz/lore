---
id: TASK-527
type: task
role: plan
title: "T1 core constants + leading scope field in buildBootstrapInjection"
status: archived
priority: medium
phase: "P1 core constants"
created: 2026-07-30
updated: 2026-07-30
tags: []
parent: PLAN-101
plan: PLAN-101
links:
  - {id: TASK-525, type: blocks}
  - {id: TASK-524, type: blocks}
  - {id: TASK-526, type: blocks}
---
Export BOOTSTRAP_SCOPE_DECLARATION, REQUIRED_DISCLAIMER_TOKENS, BOOTSTRAP_FRAMING_LINE, RESUME_SCOPE_CLOSURE, SOURCE_CATEGORY_TOKENS from @lore/core. Add the scope declaration as the FIRST key of the buildBootstrapInjection payload, extending the SPEC-080 projection contract (never duplicating its trimming policy). Implement the pinned degenerate case: when the declaration alone meets or exceeds the char budget, emit declaration + omitted + budget_exceeded and nothing else, never dropping or mid-slicing the declaration. Satisfies AC-CP-1 and AC-CP-2.
