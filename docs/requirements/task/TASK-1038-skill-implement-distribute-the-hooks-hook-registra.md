---
id: TASK-1038
type: task
role: plan
title: "[Skill:implement] distribute the hooks — HOOK_REGISTRATIONS, assets manifest, assets-ssot list"
status: archived
priority: high
phase: "P4 Adapter and distribution"
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PLAN-162
plan: PLAN-162
links:
  - {id: TASK-1032, type: blocks}
---
Estimate: S
Approach: add both hooks to HOOK_REGISTRATIONS (SessionStart, SubagentStart, PreToolUse Bash and mcp__.*lore_.*); regenerate the assets manifest; extend the assets-ssot hook list
Source: code map §5
Dimensions: D-FUNC
Scope-Alt: none
Covers: AC-RID-16

AC:
- Given the probe, When `bun run build > /dev/null 2>&1 && bun scripts/fresh-install-probe.ts --bin dist/lore`, Then every step passes including first-write-attested.
- Given `bunx vitest run packages/lore/tests/unit/assets-ssot.test.ts`, Then it passes.
