---
id: TASK-214
type: task
role: plan
title: "[Skill:implement] T5 wiring: CLI report-issue + MCP lore_report_issue + registration"
status: archived
priority: critical
phase: "Phase 3: Wiring & E2E"
created: 2026-07-24
updated: 2026-07-24
tags: []
parent: PLAN-045
plan: PLAN-045
links:
  - {id: TASK-217, type: blocks}
---
Estimate: M
Approach: per spec SPEC-072 §3/§4 — cli/commands/report-issue.ts (citty; flags: --title --description --expected --actual --repro-command --list --json; default action=report; resolveActor for reporter_actor; wire real deps: loadConfig of upstream root, probeUpstreamDb, buildUpstreamContext, ReceiptLog at <consumer>/.lore/issue-receipts.jsonl, loreVersion from package version, reporterProject from corpus root) + lazy subCommands registration in cli/index.ts (wrapCommandStrict inherits SPEC-051) + mcp/tools.ts registerToolWithArgs lore_report_issue (Zod schema, by REQUIRED per SPEC-025, same service path). VALIDATION_ERROR→exit 4 via utils.ts exitCode map.
Source: spec-072-upstream-issue-reporting-lore-report-issue-consumer §3 Structure; cli/index.ts lazy-import pattern; mcp/tools.ts:832 registration pattern
Dimensions: D-FUNC, D-UX
Scope-Alt: --json output shape minimal (doc id + duplicates) acceptable v1
Covers: AC-072-2, AC-072-11 (surface halves; full e2e assertions land in T6)

AC:
- Given no feedback.upstream in consumer config, When dist/lore report-issue --title t --description d --expected e --actual a runs in a temp consumer corpus, Then exit 4 and stderr names both config keys (smoke-run recorded as evidence; formal test in T6).
- Given the MCP server registered tools list, When lore_report_issue schema is inspected, Then by is required (registration compiles; formal invocation test in T6).
- bun run typecheck exit 0; bun run build exit 0 (CLI binary compiles with the new lazy import).

Integration: THIS task makes the feature user-reachable (CLI verb + MCP tool). Command appears in lore --help output.
