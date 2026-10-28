---
id: TASK-1990
type: task
role: plan
title: "DR-T1 decision record schema and the versions.decision column"
status: archived
priority: medium
phase: "S"
created: 2026-10-27
updated: 2026-10-27
tags: []
parent: PLAN-248
plan: PLAN-248
links:
  - {id: TASK-1971, type: blocks}
  - {id: TASK-1970, type: blocks}
---
AC-DR-1, AC-DR-3. Plan T1. core decision-record.ts (DecisionRecord schema, source parser, confidence order, trivial check, gate ids), the weight_table schema and the milestone_review fields decision_findings / traced_decisions, all core exports (this task owns packages/core/src/index.ts changes for the plan); next store migration (041 now; renumber at integrate if main has 041) adding versions.decision in SQLite, Turso, InMemory; carried through DocWriteRequest and the four store-side version writers; lore log prints it.
