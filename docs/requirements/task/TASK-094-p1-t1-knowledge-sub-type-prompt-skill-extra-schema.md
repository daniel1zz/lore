---
id: TASK-094
type: task
role: plan
title: "P1-T1: knowledge sub_type prompt/skill + extra schemas"
status: archived
priority: high
phase: Phase 1 - core sub_type
created: 2026-07-08
updated: 2026-07-08
tags: []
parent: PLAN-023
plan: PLAN-023
links:
  - {id: TASK-097, type: blocks}
  - {id: TASK-095, type: blocks}
---
Approach: KNOWLEDGE_SUB_TYPES += prompt,skill (packages/core/src/types.ts); promptExtraSchema {variables?:string[],target_surface?:string} + skillExtraSchema {applies_to?:string,trigger?:string} (schemas.ts); knowledge superRefine dispatches extra by sub_type (mirror assessment branch). TDD RED→GREEN.
AC (=AC-P1-1): sub_type=prompt/skill validate; malformed extra.prompt/extra.skill → VALIDATION_ERROR; existing sub_types (reference/assessment/retro/ideation/research) still validate; full suite 673 bun + 2890 vitest green.
Estimate: M
Files: packages/core/src/types.ts, packages/core/src/schemas.ts, + unit tests
