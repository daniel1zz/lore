---
id: TASK-1332
type: task
role: plan
title: "[Skill:implement] mcp_tool_count variable and remove hand-typed counts (#209)"
status: archived
priority: critical
phase: "Phase 3: Settings-hook claude dir and tool count"
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PLAN-185
plan: PLAN-185
links:
  - {id: TASK-1327, type: blocks}
---
Estimate: M
Approach: new pure leaf module packages/lore/src/adapters/mcp/tool-names.ts exporting LORE_MCP_TOOL_NAMES, consumed by tools.ts registration and by the registry (code var mcp_tool_count with literalPatterns /\b\d+ `?lore_\*`? tools/); replace "23 `lore_*` tools" in assets/skills/lore/SKILL.md with {{lore:mcp_tool_count}}; delete the hand-typed count from CLAUDE.md:64 (keep the module-index line's other text) and any module CLAUDE.md; regenerate manifest.
Source: spec D9; issue #209
Covers: AC-CV-8

AC:
- AC-CV-8 command exit 0; existing MCP tool tests green; `lore status --check-claude-md` exit 0.
- Closes issue #209 (reference it in the commit message).
