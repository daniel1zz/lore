---
id: TASK-557
type: task
role: plan
title: "T1 store: migration-011 trace_events + StoreInterface trace methods (3 stores) + bun tests"
status: archived
priority: medium
phase: "P1-store"
created: 2026-07-28
updated: 2026-07-29
tags: []
parent: PLAN-108
plan: PLAN-108
links:
  - {id: TASK-556, type: blocks}
---
Implement SPEC-102 schema section verbatim: migration-011 (inlined SQL constant, IF NOT EXISTS, user_version=11, LATEST_SCHEMA_VERSION=11), trace insert/query/count/prune methods on StoreInterface with parity across SQLiteStore (sync wrap), TursoStore (async), InMemoryStore (test double). Covers AC-TRACE-1 and AC-TRACE-7 (sync-push replicated set must NOT include trace_events). Fire-and-forget contract: insert returns Result but callers ignore failures.
