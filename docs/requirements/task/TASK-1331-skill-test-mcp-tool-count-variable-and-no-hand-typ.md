---
id: TASK-1331
type: task
role: plan
title: "[Skill:test] MCP tool count variable and no hand-typed counts — RED scenarios"
status: archived
priority: high
phase: "Phase 3: Settings-hook claude dir and tool count"
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PLAN-185
plan: PLAN-185
---
Estimate: S
Source: spec AC-CV-8, D9
TDD-Role: red | Paired-Impl: T6
Covers: AC-CV-8

Scenarios:
- LORE_MCP_TOOL_NAMES equals the tool list of a real MCP server instance built the way existing mcp-tools tests build it (set equality, not a number).
- Installed lore skill (RealAssetSource.load of assets/skills/lore/SKILL.md) states String(LORE_MCP_TOOL_NAMES.length) where the source has {{lore:mcp_tool_count}}.
- No CLAUDE.md in the repo and no file under assets/ matches /\b\d+ `?lore_\*`? tools/.

AC:
- packages/lore/tests/unit/assets/mcp-tool-count.test.ts written; RED (missing LORE_MCP_TOOL_NAMES; CLAUDE.md:64 and assets/skills/lore/SKILL.md:122 still hand-typed); expected-fail evidence recorded at red time.
