---
id: TASK-172
type: task
role: plan
title: "[Skill:implement] T1 D9 busy_timeout pragma + concurrent-writer regression test"
status: archived
priority: high
phase: "Phase 1: Contracts & spikes"
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PLAN-038
plan: PLAN-038
---
Estimate: S
Approach: Add `db.exec("PRAGMA busy_timeout = 2000")` alongside existing journal_mode/foreign_keys pragmas in SQLiteStore init; per spec SPEC-078 D9.
Source: spec-078 D9 (Performance+Ops convergent finding); packages/lore/src/store/sqlite-store.ts:93-95 existing pragma block.
Dimensions: D-FUNC
Scope-Alt: timeout value tunable later via config; 2000ms hardcoded is acceptable v1.
Covers: AC-078-2

AC:
- Given SQLiteStore init, When PRAGMA busy_timeout is queried on the live connection, Then it returns 2000.
- Given two connections to one corpus with a held write transaction on the first, When the second writes, Then it succeeds after waiting (no immediate SQLITE_BUSY throw) — tests/unit/store/busy-timeout.bun.test.ts GREEN.
- Integration: TursoStore path unaffected (no busy_timeout call on libsql client); existing bun store suite stays green.
