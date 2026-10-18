---
id: TASK-1562
type: task
role: plan
title: "[Skill:implement] IV-3 rooted write port: roots at construction, VALIDATION_ERROR outside, Result on write/delete"
status: archived
priority: medium
phase: "P2 contract"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-208
plan: PLAN-208
links:
  - {id: TASK-1559, type: blocks}
---
Implement spec-ambient-state-is-read-once-at-the-entry-owned-only-prune D3 (BR-1177). Real and InMemory ports share one root check (realpath of deepest existing ancestor). One shared assertion suite runs against both. All FsWritePort callers propagate the Result.
