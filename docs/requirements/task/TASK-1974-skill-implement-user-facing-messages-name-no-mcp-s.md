---
id: TASK-1974
type: task
role: plan
title: "[Skill:implement] User-facing messages name no MCP surface; lore status reports no mcp AI default"
status: archived
priority: high
phase: "Phase 1: Remove consumers"
created: 2026-10-27
updated: 2026-10-27
tags: []
parent: PLAN-246
plan: PLAN-246
links:
  - {id: TASK-1959, type: blocks}
---
Estimate: M
Approach: (1) Reword user-facing messages that name the MCP surface or MCP tools: packages/lore/src/service/corpus-service.ts (~:2219/2240/2273), ac-write-chokepoint.ts (~:347), task-workflow-service.ts (~:1874), verify-runner-service.ts (~:1179), gate-enforcer.ts (~:497), adapters/cli/evidence-precheck.ts (~:632), adapters/cli/commands/agent.ts (~:80 "Configure in .mcp.json" → name the HTTP bearer-token use of the key). (2) Remove "mcp" from ALL_SURFACES in adapters/cli/commands/status.ts (~:270; ~:307 sets app.callerSurface per surface). Keep the strict per-surface AI config key `mcp` in packages/core/src/ai.ts (read compat). Also reword the doc comment in task-workflow-service.ts (~:508, `e.g. "cli", "mcp"`) so it no longer names the removed surface. Do NOT touch checkpoint-registry.ts (T1).
Source: spec-remove-the-lore-mcp-server D4; BR-1016 (modified).
Dimensions: D-FUNC, D-CODE
Scope-Alt: none
Covers: AC-RMCP-7

Scenarios:
- Given a throwaway corpus (mkdtemp + lore init), When `lore status --json` runs, Then exit exactly 0 and the AI-default report has entries for cli, agent, http_cookie and http_token and none for mcp.
- Given a config whose ai defaults still set the `mcp` key, When `lore status --json` runs, Then it still exits 0 (the key is read, not reported).

Red-first: capture the failing test before implementing, then capture the pass.

AC:
- `bun run test:file packages/lore/tests/integration/cli/status-ai-defaults-surfaces.bun.test.ts` exits 0 (AC-RMCP-7), red captured first.
- `git grep -n '"mcp"' -- packages/lore/src/adapters/cli/commands/status.ts` prints nothing.
- `git grep -niE "mcp (tool|server|surface)|lore_[a-z_]+ tool|\.mcp\.json" -- <the 7 message files above>` prints nothing; `bun run typecheck` exits 0.
