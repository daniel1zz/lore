---
id: TASK-1971
type: task
role: plan
title: "DR-T2 decision gate and its wiring into set, bulk set and the baseline verbs"
status: archived
priority: medium
phase: "W"
created: 2026-10-27
updated: 2026-10-27
tags: []
parent: PLAN-248
plan: PLAN-248
links:
  - {id: TASK-1960, type: blocks}
  - {id: TASK-1962, type: blocks}
---
AC-DR-2, AC-DR-6. Plan T2. service/decision-gate.ts: the shared refusal (agent run only, non-draft target, missing parts, tier S..C, file premise quoting and HEAD pinning, dirty-file and missing-lines refusal); wired into CorpusService.set and the baseline set-label/depends/glossary/map services; CLI flags on lore set and lore baseline. No file under packages/lore/src/adapters/mcp/ is changed (the MCP server may be removed; peer session lore-22): MCP lore_set and lore_bulk set are refused because they call the same service, and the AC-DR-2 MCP case is asserted from a test file outside src/adapters/mcp; MCP callers cannot supply a decision.
