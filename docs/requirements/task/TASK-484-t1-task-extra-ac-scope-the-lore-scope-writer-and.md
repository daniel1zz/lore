---
id: TASK-484
type: task
role: plan
title: "T1 task.extra.ac_scope, the lore scope writer, and assertScopeFreeze wiring"
status: archived
priority: medium
phase: "Field and writer"
created: 2026-07-31
updated: 2026-08-01
tags: []
parent: PLAN-095
plan: PLAN-095
links:
  - {id: TASK-481, type: blocks}
---
## Task

Covers AC-VS-9, AC-VS-10, AC-VS-11 of spec-declared-scope-attestation-contract-task-owned-ac-scope. Read the spec's Contract Details for the fixed names, exit codes and message literals — do not invent them.

Add `task.extra.ac_scope` (empty array allowed, distinct from absent), the dedicated `lore scope add|rm|list` read-merge-write writer serving BOTH task and phase tiers, `lore create task --ac-scope` (repeatable), and wire `assertScopeFreeze` at that writer (it currently has ZERO production call sites). Removing the last id leaves an empty array, never an absent key. `lore set` gains no --ac-scope flag.
