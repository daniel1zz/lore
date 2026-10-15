---
id: TASK-1047
type: task
role: plan
title: "[Skill:test] RED — store migration 016 (runs table, harness_run columns, idempotent re-open)"
status: archived
priority: critical
phase: "P1 Contracts"
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PLAN-162
plan: PLAN-162
links:
  - {id: TASK-1045, type: blocks}
---
Estimate: S
Source: spec D4; existing pattern packages/lore/src/store/migrations/migration-014.ts and its tests
TDD-Role: red | Paired-Impl: `task-skill-implement-store-migration-016-run-store-methods`
Covers: AC-RID-4

Scenarios:
- Given a SQLite corpus created at user_version 15 with docs, versions and audit rows, When it is opened, Then user_version is 16, the runs table exists, audit and versions have a harness_run column, and every pre-existing row is byte-equal except harness_run NULL.
- Given the corpus is opened again, Then nothing changes.
- Given insertRun twice with the same id (second call with different parent and branch), Then one row remains with every column from the first call — on SQLiteStore AND InMemoryStore.
- Given getRun on a registered and on an unknown id, Then the record and a not-found result respectively — on both stores.
- Given withWriteContext(store, {identity: {harnessRun: R, claimed: N, claimedSource: 'flag'}}), When an audit entry is appended and a version is inserted through it, Then both rows carry harness_run R; through the unwrapped store, Then harness_run NULL — on both stores.

AC:
- Given the test file, When `cd packages/lore && bun test tests/unit/store/migration-016.bun.test.ts` runs before migration 016 exists, Then it fails on the missing schema, recorded with `lore evidence --result expected-fail --output-tail-file`.
