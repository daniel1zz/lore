---
id: TASK-1969
type: task
role: plan
title: "[Skill:implement] Delete the test files whose only subject is the lore MCP server"
status: archived
priority: critical
phase: "Phase 2: Delete the server"
created: 2026-10-27
updated: 2026-10-27
tags: []
parent: PLAN-246
plan: PLAN-246
links:
  - {id: TASK-1959, type: blocks}
---
Estimate: S
Approach: delete the test files whose only subject is the lore MCP server: packages/lore/tests/unit/adapters/mcp-*.test.ts (25 files, listed in anchors), packages/lore/tests/integration/mcp/ (whole dir), packages/lore/tests/unit/assets/mcp-tool-count.test.ts. Remove their entries from vitest.node-files.ts (~:35 lists mcp-github-filing.test.ts; this task owns vitest.node-files.ts). No source change.
Source: spec-remove-the-lore-mcp-server Scope; Invariant I4 (T7a blocks this task).
Dimensions: D-CODE
Scope-Alt: none
Covers: (supporting AC-RMCP-1)

AC:
- `ls packages/lore/tests/unit/adapters/mcp-*.test.ts packages/lore/tests/integration/mcp packages/lore/tests/unit/assets/mcp-tool-count.test.ts 2>&1 | grep -c "No such file"` prints 3.
- `bun run typecheck` exits 0; `bun run test:changed main` exits 0.
