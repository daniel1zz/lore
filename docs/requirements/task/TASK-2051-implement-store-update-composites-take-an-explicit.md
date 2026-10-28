---
id: TASK-2051
type: task
role: plan
title: "[implement] Store update composites take an explicit snapshot flag (three stores)"
status: archived
priority: critical
phase: "Phase 2: Write paths"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-258
plan: PLAN-258
links:
  - {id: TASK-2050, type: blocks}
---
Estimate: M
Approach: add an explicit "write snapshot" decision to the store update composites; the service decides, the store obeys. Follow the existing writeDocKeepingVersion precedent (corpus-service.ts) for an audit row with no versions row.
Source: spec Scope 3; ADR D1, D3; store/CLAUDE.md; provenance-writes.shared.ts contract tests.
Covers: (supporting task; the behaviour is proven by AC-HC-1/AC-HC-8 in later tasks)

## Work
- `updateWithProvenance` (main doc and `also_update` companions) in store-interface.ts, sqlite-store.ts, turso-store.ts, in-memory-store.ts takes a per-doc `snapshot: boolean` (required, no default: a missing value fails typecheck). true = today's behaviour; false = bump version with the same CAS, write the audit row, insert no versions row, all in the same transaction.
- write-context-store.ts STAMPED: update the positional arg map if signatures move.
- Every existing caller passes `snapshot: true` (behaviour unchanged in this task).
- Contract tests in the shared provenance-writes suite for snapshot:false on all three stores: version +1, 0 versions rows, 1 audit row, STALE_VERSION on an old expected version.

## AC
- Shared store contract cases pass on SQLite, Turso (local file) and InMemory, red first.
- `bun run typecheck` exits 0.
