---
id: TASK-1973
type: task
role: plan
title: "[Skill:implement] Comments name no lore MCP server (comment-only change)"
status: archived
priority: low
phase: "Phase 1: Remove consumers"
created: 2026-10-27
updated: 2026-10-27
tags: []
parent: PLAN-246
plan: PLAN-246
links:
  - {id: TASK-1959, type: blocks}
---
Estimate: S
Approach: comment-only. Remove or reword comments that name the lore MCP server / adapters/mcp / MCP tools in the anchored files (packages/lore/src/flows/*.ts listed in anchors, store/*.ts listed, adapters/cli/loader.ts — delete the stale "DISCLOSED RESIDUAL" block ~:197-209, report-issue-wiring.ts, evidence-capture.ts, real-fs-probe.ts, commands/feed.ts, commands/report-issue.ts, adapters/http/middleware.ts, service/ai-provider-service.ts, packages/core/src/{types,task-workflow,corpus-provenance,config,errors}.ts, packages/dashboard/src/components/NewDocModal.tsx). No code change: the diff touches only comment lines. This includes the mentions in loader.ts (~:207, :576) and store/audit-surface.ts (~:15). In packages/core/src/types.ts keep the CallerSurface "mcp" member and reword its doc comment to "read-only: rows written before the MCP server was removed".
Source: spec-remove-the-lore-mcp-server Scope (comments).
Dimensions: D-DOC
Scope-Alt: reword may be reduced to deleting the stale sentence
Covers: (supporting AC-RMCP-1)

AC:
- `git grep -nE "adapters/mcp|--mcp-server|mcp/tools|lore_[a-z_]+ (MCP )?tool" -- <anchored files>` prints nothing.
- `bun run typecheck` exits 0 and `git diff main -- <anchored files> | grep -E '^[+-][^+-]' | grep -vE '^[+-]\s*(//|\*|/\*)'` prints nothing (comment lines only; record the output with --capture).
