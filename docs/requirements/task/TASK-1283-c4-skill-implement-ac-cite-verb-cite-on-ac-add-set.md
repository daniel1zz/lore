---
id: TASK-1283
type: task
role: plan
title: "[C4] [Skill:implement] ac cite verb, --cite on ac add/set, warnings, no-cite hint"
status: archived
priority: high
phase: "Phase C: services and surfaces"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-172
plan: PLAN-172
links:
  - {id: TASK-1279, type: blocks}
  - {id: TASK-1275, type: blocks}
---
Estimate: M
Approach: per spec §C4; add `citeCriterion` to AcService reusing `writeCriteria` with operation `cite` and the no-demote branch `ac add` already uses; rule existence/lifecycle via store registry + leaf read; counting helper exported for C7.
Source: Spec: `spec-baseline-slice-1-rules-with-permanent-ids-ac-citations` (read it first: `lore get spec-baseline-slice-1-rules-with-permanent-ids-ac-citations`).
Covers: AC-BLS1-6
Surface decision (recorded): CLI only. MCP exposes no `ac` tools at all today (pre-existing gap, documented in `packages/lore/src/adapters/mcp/tools.ts` header ~L165-175); adding the first MCP ac tool is out of slice 1. The service method is surface-agnostic, so MCP can wrap it later with no service change.
Integration: `lore ac cite` registered under `lore ac`; `ac add` prints a one-line hint when the new AC has no cites.

AC:
- `bunx vitest run packages/lore/tests/unit/service/ac-cite.test.ts` exit 0.
- Existing `bunx vitest run packages/lore/tests/unit/service/ac-service.test.ts` exit 0.
- `bun run typecheck` exit 0.
