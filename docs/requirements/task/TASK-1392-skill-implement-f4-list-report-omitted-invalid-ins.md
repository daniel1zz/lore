---
id: TASK-1392
type: task
role: plan
title: "[Skill:implement] F4 list: report omitted_invalid instead of hiding invalidated docs silently"
status: archived
priority: high
phase: "Phase 1: fixes"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-189
plan: PLAN-189
links:
  - {id: TASK-1381, type: blocks}
---
Estimate: S
Approach: per spec F4 — count what the validity filter removes and return omitted_invalid beside total in CorpusService.list and the CLI full-record path (fetchGatedFullDocs/selectLiveDocs); text footer appends '(+N invalidated hidden; --include-invalid)'; MCP lore_list passes the field through.
Source: spec F4; packages/lore/src/service/corpus-service.ts:3642-3648; packages/lore/src/adapters/cli/commands/list.ts:523,538; packages/lore/src/adapters/mcp/tools.ts
Resolves: task-lore-list-silently-omits-invalidated-docs-and-reports-a
Dimensions: D-FUNC
Scope-Alt: none
Covers: AC-CRIT-6
AC:
- Given two knowledge docs with one invalidated in a mkdtemp corpus, When lore list --type knowledge --json, Then exit 0, total=1, omitted_invalid=1, text contains '1 invalidated hidden'; with --include-invalid total=2 omitted_invalid=0; MCP lore_list carries omitted_invalid (AC-CRIT-6)
Integration: CLI lore list and MCP lore_list both read CorpusService.list; the test asserts both surfaces.
