---
id: TASK-1045
type: task
role: plan
title: "[Skill:implement] store — migration 016, run store methods, write-context decorator (SQLite, Turso, InMemory)"
status: archived
priority: critical
phase: "P1 Contracts"
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PLAN-162
plan: PLAN-162
links:
  - {id: TASK-1043, type: blocks}
  - {id: TASK-1035, type: blocks}
  - {id: TASK-1026, type: blocks}
  - {id: TASK-1037, type: blocks}
  - {id: TASK-1027, type: blocks}
---
Estimate: L — one migration in two SQL stores plus the InMemory mirror plus the decorator; split would put the decorator in a task whose oracle needs the same migration fixture
Approach: per spec D3, D4 — migration-016 following migration-014's pattern in both SQLite (`runMigrations`) and Turso; StoreInterface gains insertRun (idempotent), getRun, countAttributedWrites(window, kinds); InMemory mirrors; `withWriteContext(store, ctx)` decorator stamps harness_run on appendAuditEntry and on every version insert
Source: spec §Structure; code map: sqlite-store.ts runMigrations, turso-store.ts migration blocks, in-memory-store.ts trace_events mirror
Dimensions: D-FUNC, D-CODE
Scope-Alt: countAttributedWrites may land with P3's status task if `task-skill-implement-store-migration-016-run-store-methods` runs long — the interface method is declared here either way
Covers: AC-RID-4 (decorator is exercised by AC-RID-5 in P3)

AC:
- Given `task-skill-test-red-store-migration-016-runs-table-harness-run`'s tests, When `cd packages/lore && bun test tests/unit/store/migration-016.bun.test.ts`, Then all pass.
- Given the existing store suites, When `cd packages/lore && bun test tests/unit/store`, Then no previously green test turns red.
- Given `LATEST_SCHEMA_VERSION`, Then it reads 16 and store/CLAUDE.md's migration list names migration-016.
