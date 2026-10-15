---
id: TASK-1027
type: task
role: plan
title: "[Skill:implement] MCP — harness_run argument, optional by, per-call write context"
status: archived
priority: medium
phase: "P3 Write surfaces"
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PLAN-162
plan: PLAN-162
links:
  - {id: TASK-1024, type: blocks}
---
Estimate: M
Approach: per spec D3 — each tool call builds an invocation identity from its harness_run/by args and runs against withWriteContext(store, identity); the 18 `by: z.string().min(1)` become optional; measure per-call overhead (risk R6)
Source: code map §6 (tools.ts schema lines)
Dimensions: D-FUNC
Scope-Alt: none
Covers: AC-RID-7

AC:
- Given `cd packages/lore && bun test tests/integration/mcp/mcp-harness-run.bun.test.ts`, Then it passes.
- Given the existing MCP suites, Then no previously green test turns red.
- Given `bun scripts/bench/mcp-call-overhead.ts --calls 100` (written in this task; prints p95 ms with and without the per-call write context), Then the difference is < 20 ms, recorded with `lore evidence --oracle manual --output-tail-file`.
- Integration: From a Claude Code session with the lore MCP server, calling mcp__lore__lore_create without a by argument, Then the document is created and `lore log <slug>` shows the session's run once the pre-tool hook is installed (P4).
