---
id: TASK-221
type: task
role: plan
title: "[Skill:implement] T3 MCP budget-parity — thread config into lore_feed task-start"
status: archived
priority: medium
phase: "mcp-parity"
created: 2026-07-23
updated: 2026-07-24
tags: []
parent: PLAN-050
plan: PLAN-050
---
Estimate: S
Approach: Assessment finding closure (knowledge-assessment-plan-spec-070-deterministic-task-dispatch): the MCP lore_feed task-start branch currently always uses DEFAULT_TASK_START_BUDGETS because registerTools receives no LoreConfig — a config-set budget silently diverges CLI vs MCP packs. Thread the parsed workflow config into the MCP task-start branch: locate how the MCP server entry constructs the App (startMcpServer / index.ts --mcp-server path) and how the CLI resolves budgets (adapters/cli/task-feed-wiring.ts::resolveTaskStartBudgets over loaded config); give registerTools (or the lore_feed handler specifically) access to the same resolved LoreConfig source the CLI loader uses, then call resolveTaskStartBudgets identically. If registerTools' signature must change, keep it additive (optional config param) so existing call sites/tests stay whole. Extend mcp-feed-task-start.test.ts with an AC-070-9 budget-override parity case (tiny budget forces truncated[] keys; assert deep-equal CLI-path pack vs MCP pack under the same override).
Source: spec-070-deterministic-task-dispatch-bundle-lore-feed-task-start AC-070-9; assessment typed_recommendation (plan target); packages/lore/src/adapters/mcp/CLAUDE.md for server construction conventions.
Dimensions: D-FUNC
Scope-Alt: none — single finding closure.
Covers: AC-070-9

AC:
- Given workflow.task_feed with a non-default budget, when the MCP lore_feed task-start pack and the CLI-path pack build for the same corpus state, then truncated[] and clipped sections deep-equal (AC-070-9)

Integration: with a real config carrying a tiny budget, the MCP tool call's pack shows the same truncated[] keys the CLI --json path shows — config is honored end-to-end on both surfaces.

Oracle scope (SCOPED only):
- bunx vitest run packages/lore/tests/unit/adapters/mcp-feed-task-start.test.ts (assert matched test-file count = 1)
- bunx vitest run --changed <merge-base>
- bun run typecheck
