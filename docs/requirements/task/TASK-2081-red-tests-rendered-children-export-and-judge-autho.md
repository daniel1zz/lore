---
id: TASK-2081
type: task
role: plan
title: "Red tests: rendered children, export and judge, authored-list check, migration"
status: draft
priority: medium
phase: "P1 Red"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-263
plan: PLAN-263
links:
  - {id: TASK-2072, type: blocks}
  - {id: TASK-2078, type: blocks}
  - {id: TASK-2071, type: blocks}
---
Covers: AC-CL-1, AC-CL-2, AC-CL-3, AC-CL-4
TDD-Role: red
Approach: throwaway corpora (mkdtemp + lore init), baseline nodes built with lore baseline add; CL-3 covers the missing-child, deleted-child (same row count) and count-sentence cases plus one exact match; CL-4 approves the two parents first, then asserts approved text unchanged and a pending revision staged, and a second run staging nothing.
Done when: all four commands run red; expected-fail captured.
