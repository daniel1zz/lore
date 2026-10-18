---
id: TASK-1552
type: task
role: plan
title: "[Skill:implement] AU-T2 decision log: append-only, hash-chained, worst-of, human precedence"
status: archived
priority: critical
phase: "Phase 1a: core"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-204
plan: PLAN-204
links:
  - {id: TASK-1550, type: blocks}
  - {id: TASK-1549, type: blocks}
  - {id: TASK-1548, type: blocks}
  - {id: TASK-1546, type: blocks}
  - {id: TASK-1545, type: blocks}
  - {id: TASK-1544, type: blocks}
  - {id: TASK-1547, type: blocks}
  - {id: TASK-1543, type: blocks}
---
Estimate: M
Approach: Store table + StoreInterface methods (SQLite, Turso, InMemory) for decision rows with prev-hash chaining in one transaction; DecisionService.record/effectiveVerdict (latest human-tty else worst machine; reject -> refuse); chain verify command surfaced in lore status. Red-first halves (1)-(4) incl. concurrent writers. Follow store CLAUDE.md conventions (Result<T,LoreError>).
Source: spec-autonomy-phase-1-decision-function-human-channel-lore; decision: adr-autonomy-is-decided-by-measured-facts-one-decision-function
AC: AC-AU-2.
