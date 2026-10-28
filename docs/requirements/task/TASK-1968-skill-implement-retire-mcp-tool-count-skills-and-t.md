---
id: TASK-1968
type: task
role: plan
title: "[Skill:implement] Retire mcp_tool_count; skills and the generated asset manifest name no lore MCP tool"
status: archived
priority: high
phase: "Phase 1: Remove consumers"
created: 2026-10-27
updated: 2026-10-27
tags: []
parent: PLAN-246
plan: PLAN-246
links:
  - {id: TASK-1964, type: blocks}
  - {id: TASK-1959, type: blocks}
---
Estimate: M
Approach: retire the `mcp_tool_count` context variable: remove the import of adapters/mcp/tool-names.ts (~:31) and the variable (~:46-52) in packages/lore/src/service/context-variables-registry.ts. In assets/skills/lore/SKILL.md remove `{{lore:mcp_tool_count}}` and every lore-MCP sentence (~:25, :49 → name `lore set <plan> --requires-uat` for requires_uat, :76, :124); in assets/skills/lore-init-context/SKILL.md (~:85, :116) drop `src/adapters/mcp`. Regenerate packages/lore/src/generated/assets-manifest.ts with the repo's generator. Update packages/lore/tests/unit/assets/registered-literal-lint.test.ts (~:56 adapters/mcp/tools.ts entry, ~:145-148). Mentions of OTHER MCP servers in skills stay (Invariant I6).
Source: spec-remove-the-lore-mcp-server Scope; BR-1098 (modified).
Dimensions: D-CODE, D-DOC
Scope-Alt: none
Covers: (supporting AC-RMCP-1)

AC:
- `git grep -n "mcp_tool_count"` prints nothing.
- `git grep -nE -- '--mcp-server|adapters/mcp|mcp__lore|lore_[a-z_]+\` (MCP )?tool' -- assets/skills` prints nothing.
- `bun run test:file packages/lore/tests/unit/assets/registered-literal-lint.test.ts` exits 0; `bun run typecheck` exits 0.
