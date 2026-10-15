---
id: TASK-1281
type: task
role: plan
title: "[C2] [Skill:implement] RuleService + replace guard + CLI (rule, baseline) + MCP tools"
status: archived
priority: critical
phase: "Phase C: services and surfaces"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-172
plan: PLAN-172
links:
  - {id: TASK-1279, type: blocks}
  - {id: TASK-1276, type: blocks}
---
Estimate: L
Approach: per spec §C3; structure `rule-service.ts` like `ac-service.ts` (CAS write → insertVersion → appendAuditEntry), ≤ 3 immediate re-applies on CAS conflict then CONFLICT; replace guard in `CorpusService.set` reads DEDICATED_EXTRA_KEYS (deep-equal per registered key); CLI verbs `rule add|set`, `baseline add|set-label|depends|glossary|tree` (tree is a stub here — C7 fills states); MCP tools mirroring the write verbs; wire in `app.ts`.
Source: Spec: `spec-baseline-slice-1-rules-with-permanent-ids-ac-citations` (read it first: `lore get spec-baseline-slice-1-rules-with-permanent-ids-ac-citations`).
Covers: AC-BLS1-2
Integration: `lore rule add <leaf> …` and `lore baseline add …` callable from the built binary; MCP tool names listed in `lore --mcp-server` tools/list.

AC:
- `bunx vitest run packages/lore/tests/unit/service/rule-service.test.ts` exit 0.
- `bun run typecheck` exit 0; `bun run test:changed` green.
