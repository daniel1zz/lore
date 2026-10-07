---
id: TASK-870
type: task
role: plan
title: "[Skill:implement] lore context write gate honours adoption"
status: archived
priority: medium
phase: "Phase 2: Surfaces"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-149
plan: PLAN-149
links:
  - {id: TASK-880, type: blocks}
---
Estimate: S
Approach: (anchors include adapters/cli/commands/context.ts, the renderer + budget-resolution site; unit/flows/context-flow.test.ts is owned by the Phase-1 task and already re-pinned) context-flow already consumes runMemoryFileChecks; key the refusal off the result's deterministic array AFTER adoption is applied (warn → empty), and surface downgraded advisories in its result. No second composition.
Source: spec-claude-md-root-section-structure-check-and-adoption-mode D2; flows/context-flow.ts write gate
Dimensions: D-FUNC
Scope-Alt: none
Covers: AC-STR-6

AC:
- `bunx vitest run packages/lore/tests/unit/flows/context-flow-adoption.test.ts` passes.
- `bun run typecheck` exit 0; `bun run test:changed main` green PLUS `bunx vitest run packages/lore/tests/unit/flows/context-flow.test.ts` by hand.
