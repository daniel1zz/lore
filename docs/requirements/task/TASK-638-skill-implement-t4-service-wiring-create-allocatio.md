---
id: TASK-638
type: task
role: plan
title: "[Skill:implement] T4 service wiring: create allocation + set guard + kind-flip + resolveDoc"
status: archived
priority: high
phase: "Phase 2: Consumers (parallel)"
created: 2026-07-26
updated: 2026-07-27
tags: []
parent: PLAN-120
plan: PLAN-120
links:
  - {id: TASK-635, type: blocks}
---
Estimate: M
Approach: per SPEC-084 §Changed semantics. (1) `CorpusService._createImpl`: for `ORDINAL_REGISTRY[type]` present ∧ candidate kind ∉ exemptKinds → route the insert through `store.insertWithAllocatedOrdinal` (else the existing insert path unchanged). (2) `CorpusService.set`: title patch on a numbered-type doc re-validated against the same prefix rule (VALIDATION_ERROR — SPEC-040 D5 "re-check on set" shape); kind transition exempt→numbered → `store.allocateOrdinalForExisting` in the same CAS write cycle; numbered→exempt keeps the ordinal. (3) `resolve.ts::resolveDoc`: after exact id/slug miss and BEFORE the SPEC-065 id-prefix fallback, `parseOrdinalRef(input)` match → `store.findByTypeOrdinal` (miss falls through unchanged). Renderers that list/print docs switch to `composeDocDisplayTitle` (CLI list/get/tree headers — find call sites by grepping current title interpolation).
Source: SPEC-084 D5/D6 + kind-flip semantics paragraph; corpus-service.ts existing `_createImpl`/`set` seams; resolve.ts SPEC-065 step ordering
Dimensions: D-FUNC, D-CODE
Scope-Alt: renderer switch may trail into T8 if a surface is missed — the grep pin in ordinal-identity.test.ts is the catcher
Covers: AC-084-3, AC-084-6

AC:
- `bunx vitest run packages/lore/tests/unit/service/ordinal-identity.test.ts` GREEN (all scenarios incl. set-path rejection + kind-flip + resolveDoc fallthrough REGRESSION).
- `bunx vitest run --changed <merge-base>` green for touched files.
- `bun run typecheck` exit 0.
