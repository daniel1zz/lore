---
id: TASK-222
type: task
role: plan
title: "[Skill:implement] T2 MCP lore_feed task-start + phase-start parity"
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
Approach: adapters/mcp/tools.ts — LoreFeedSchema gains optional `task` and `phase` string fields; lore_feed handler adds two branches BEFORE the generic buildFeed call, mirroring the CLI dispatch order: checkpoint === TASK_START_CHECKPOINT → buildTaskFeedFlowDeps(app) + buildTaskStartPack (same builders as CLI — parity by construction); checkpoint === PHASE_START_CHECKPOINT → buildPhaseFeedFlowDeps(app) + buildPhaseStartPack (closes the SPEC-056 deferred MCP gap). Missing task/phase arg for these checkpoints → VALIDATION_ERROR errorContent. Return the pack as JSON textContent (matching CLI --json data shape).
Source: spec-070-deterministic-task-dispatch-bundle-lore-feed-task-start §Design D8; T1's landed wiring modules; adapters/mcp/CLAUDE.md registration conventions.
Dimensions: D-FUNC
Scope-Alt: none — single AC, minimal surface.
Covers: AC-070-8

AC:
- Given the same corpus state, when lore_feed {checkpoint:"task-start", task} and the CLI --json path both run, then the pack objects deep-equal (AC-070-8)
- Given lore_feed {checkpoint:"phase-start", phase}, when it runs, then the real buildPhaseStartPack pack returns instead of the generic buildFeed note (AC-070-8)

Integration: MCP tool call against a real InMemoryStore-backed App returns the eight-section pack — the tool is registered and reachable, not only unit-covered.

Oracle scope (MUST stay scoped):
- bunx vitest run packages/lore/tests/unit/adapters/mcp-feed-task-start.test.ts (assert matched test-file count = 1)
- bunx vitest run --changed <merge-base>
- bun run typecheck
