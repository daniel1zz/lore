---
id: TASK-1287
type: task
role: plan
title: "[B2] [Skill:implement] store: rule_registry migration + transactional allocate / move (SQLite, Turso, InMemory)"
status: archived
priority: critical
phase: "Phase B: store"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-172
plan: PLAN-172
links:
  - {id: TASK-1281, type: blocks}
  - {id: TASK-1283, type: blocks}
---
Estimate: L
Approach: per spec §C2; files: `store-interface.ts`, `sqlite-store.ts`, `turso-store.ts`, `in-memory-store.ts`, `schema-version.ts` (bump LATEST_SCHEMA_VERSION), new `migrations/migration-013.ts` chained in `sqlite-store.ts`; migration follows `packages/lore/src/store/migrations/migration-010.ts` (single transaction + ROLLBACK on SQLite; idempotent CREATE TABLE IF NOT EXISTS on Turso); new StoreInterface methods `allocateRuleAndUpdateLeaf`, `moveRule`, `getRuleRegistry`; Turso via `client.transaction("write")`.
Source: Spec: `spec-baseline-slice-1-rules-with-permanent-ids-ac-citations` (read it first: `lore get spec-baseline-slice-1-rules-with-permanent-ids-ac-citations`).
Covers: AC-BLS1-1
Scope-Alt: Turso concurrency test may be single-process if no multi-process harness exists — record the gap.

AC:
- `cd packages/lore && bun test tests/unit/store/rule-registry.bun.test.ts` exit 0 with every scenario written by task [B1] passing.
- Existing store suites stay green: `cd packages/lore && bun test tests/unit/store` exit 0.
- `bun run typecheck` exit 0.
