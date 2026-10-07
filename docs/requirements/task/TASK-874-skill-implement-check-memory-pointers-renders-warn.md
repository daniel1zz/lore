---
id: TASK-874
type: task
role: plan
title: "[Skill:implement] check-memory-pointers renders WARN + downgraded slug findings"
status: archived
priority: high
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
Approach: `lore status --check-memory-pointers` (adapters/cli/commands/status.ts) currently reads only `.deterministic` from runMemoryFileChecks, so under warn the downgraded slug_pointer_missing finding is dropped silently. Render the adoption WARN line and the downgraded slug findings exactly as `--check-claude-md` does (reuse claude-md-render.ts helpers; no second composition).
Source: spec D7 ("warn is never silent"); measured regression after the Phase-1 core task
Dimensions: D-FUNC
Scope-Alt: none
Covers: AC-STR-9

AC:
- `bunx vitest run packages/lore/tests/integration/status-memory-pointers-adoption.test.ts` passes; `bun run typecheck` exit 0; status-claude-md*.test.ts still pass (by hand).
