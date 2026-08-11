---
id: TASK-642
type: task
role: plan
title: "[Skill:implement] T2 schema migration + store allocation methods x3 impls"
status: archived
priority: critical
phase: "Phase 1: Contract"
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PLAN-120
plan: PLAN-120
links:
  - {id: TASK-638, type: blocks}
  - {id: TASK-637, type: blocks}
  - {id: TASK-636, type: blocks}
---
Estimate: M
Approach: per SPEC-084 §Module Boundary StoreInterface additions. (1) Schema migration (NEXT free number in packages/lore/src/store/migrations — check the chain at worktree start, R1): `ALTER TABLE docs ADD COLUMN ordinal INTEGER` + `CREATE UNIQUE INDEX idx_docs_type_ordinal ON docs(type, ordinal) WHERE ordinal IS NOT NULL` (NOT filtered on deleted_at — never-reuse is the index's job). (2) `insertWithAllocatedOrdinal(doc)`: transaction-scoped SELECT MAX(ordinal)+1 WHERE type=? → insert; on UNIQUE violation retry ≤3; exhaustion → err(STORE_ERROR, message containing ORDINAL_ALLOCATION_EXHAUSTED). (3) `allocateOrdinalForExisting(id, expectedVersion)`: CAS-guarded UPDATE (STALE_VERSION on mismatch), refuses a row already carrying an ordinal, same MAX+1+retry+exhaustion shape. (4) `findByTypeOrdinal(type, ordinal)`. All three methods on StoreInterface + SQLiteStore + TursoStore + InMemoryStore (InMemory mimics partial-index semantics incl. soft-deleted rows — the shared case table is the parity oracle). Row↔DocRecord mapping carries `ordinal`.
Source: SPEC-084 D1/D2/D9; sqlite-store.ts's existing CAS/insertWithProvenance patterns (NOTE the SPEC-078 byproduct: BEGIN IMMEDIATE must sit INSIDE try/catch — do not repeat the Result-contract gap)
Dimensions: D-FUNC, D-CODE
Scope-Alt: none
Covers: AC-084-1, AC-084-2, AC-084-6

AC:
- `cd packages/lore && bun test tests/unit/store/ordinal-allocation.contract.bun.test.ts` GREEN (>0 executed).
- `bunx vitest run packages/lore/tests/unit/store/ordinal-allocation.contract.test.ts` GREEN + count-equality.
- Migration applies on a fresh corpus AND on a copy of an existing one (both directions in the store migration test conventions).
- `bun run typecheck` exit 0.
