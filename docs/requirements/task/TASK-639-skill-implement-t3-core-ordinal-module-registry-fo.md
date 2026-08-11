---
id: TASK-639
type: task
role: plan
title: "[Skill:implement] T3 core ordinal module: registry + formatters + parseOrdinalRef + schema guard"
status: archived
priority: critical
phase: "Phase 1: Contract"
created: 2026-07-26
updated: 2026-07-27
tags: []
parent: PLAN-120
plan: PLAN-120
links:
  - {id: TASK-642, type: blocks}
---
Estimate: M
Approach: per SPEC-084 §Module Boundary. New core module `packages/core/src/ordinal.ts`: `ORDINAL_REGISTRY` (spec→{prefix:"SPEC", exemptKinds:["domain-overview"]}, adr→{prefix:"ADR"}), `formatDocDisplayId(doc)`, `composeDocDisplayTitle(doc)`, `parseOrdinalRef(input)` (`^(spec|adr)-0*(\d+)$` ci). `DocRecord.ordinal?: number` in types.ts + zod field in schemas.ts (docRecordSchema and every projection schema that must round-trip it — strip-hazard discipline, SPEC-080's incident class). `createDocInputSchema` superRefine: title matching `^(SPEC|ADR)-\d+\b` on a numbered type (respecting exemptKinds via the candidate's spec_kind) → VALIDATION_ERROR naming the rule + "the ordinal is allocated at create; write the bare title".
Source: SPEC-084 D3/D4/D5/D6 + barrel export via @lore/core index (browser-safe — zero Node imports)
Dimensions: D-FUNC, D-CODE
Scope-Alt: none
Covers: AC-084-3, AC-084-6

AC:
- T1's vitest suites progress past core-symbol import errors (store methods still RED — that is T2).
- Formatter unit cases in ordinal-identity.test.ts GREEN for pure-fn scenarios (format/compose/parse); create-path title rejection GREEN at schema level.
- `bunx tsc --noEmit -p packages/core/tsconfig.json` exit 0.
- @lore/core default barrel stays browser-safe (no fs/path/os imports — dashboard Vite regression rule).
