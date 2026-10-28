---
id: TASK-1306
type: task
role: plan
title: "[Skill:implement] pre-tool-harness-run rewrites lore tool calls under any MCP server name"
status: archived
priority: medium
phase: "Phase 1: Foundations"
created: 2026-10-15
updated: 2026-10-25
tags: []
parent: PLAN-181
plan: PLAN-181
links:
  - {id: TASK-1303, type: blocks}
  - {id: TASK-1310, type: blocks}
---
Estimate: S
Approach: Replace the hard-coded MCP_TOOL_PREFIX 'mcp__lore__' check with the matcher's own shape (mcp__<server>__lore_*); other servers untouched.
Source: spec AC-TE-6; BR-1093
Covers: AC-TE-6
AC:
- AC-TE-6 green via its declared command (lore ac list <spec>), red recorded first

Red first (Invariant I3): write the AC test file(s) first, run the AC command, record `lore evidence <this task> --oracle test --result expected-fail --output-tail-file <log>` yourself, then implement to green and record the pass. Commit before attesting. Scoped oracles only in the worktree (I4).
