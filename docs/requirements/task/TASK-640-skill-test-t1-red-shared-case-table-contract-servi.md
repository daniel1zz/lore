---
id: TASK-640
type: task
role: plan
title: "[Skill:test] T1 RED shared case table + contract/service suites"
status: archived
priority: high
phase: "Phase 1: Contract"
created: 2026-07-26
updated: 2026-07-27
tags: []
parent: PLAN-120
plan: PLAN-120
links:
  - {id: TASK-639, type: blocks}
---
Estimate: M
Source: SPEC-084 §Test Plan + AC-084-1/2/3; SPEC-080 plan's T1 RED precedent
TDD-Role: red | Paired-Impl: T3 (core) + T2 (store) jointly
Dimensions: D-FUNC
Scope-Alt: none — these suites ARE AC-084-1/2/3's oracles
Covers: AC-084-1, AC-084-2, AC-084-3

Deliverables (all RED — failures must be missing-implementation, never test bugs):
1. `packages/lore/tests/unit/store/ordinal-allocation-cases.ts` — the SHARED exported case table (plain data module, no runner imports): forced-collision→MAX+1; exhaustion-at-3 → err(STORE_ERROR) message contains ORDINAL_ALLOCATION_EXHAUSTED; soft-deleted never reused; SPEC-5/ADR-5 cross-type coexistence; exempt kind → NULL ordinal; exempt→numbered flip via allocateOrdinalForExisting (CAS + refuses existing ordinal).
2. `packages/lore/tests/unit/store/ordinal-allocation.contract.bun.test.ts` — SQLiteStore runner iterating the table.
3. `packages/lore/tests/unit/store/ordinal-allocation.contract.test.ts` — InMemoryStore vitest twin iterating the SAME table + count-equality assertion (imported case count === table length).
4. `packages/lore/tests/unit/service/ordinal-identity.test.ts` — service+resolution scenarios: numbered create auto-allocates; title `SPEC-99 — x` rejected at create AND at `set` title patch; `resolveDoc("SPEC-84")`/`"spec-084"`/0-padded → findByTypeOrdinal; non-ordinal input falls through to SPEC-065 id-prefix (REGRESSION); formatter import-graph/grep pin (no `SPEC-`/`ADR-` template interpolation outside core's formatter module).

AC:
- All four files exist; both contract runners consume the shared table (static import, no copied case lists).
- `bunx vitest run` on files 3+4 and `bun test` on file 2 all exit NON-ZERO with failures exclusively of the missing-export/missing-method class.
