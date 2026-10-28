---
id: TASK-1932
type: task
role: plan
title: "Tool server verifies harness_run by process ancestry"
status: approved
priority: critical
phase: "P3 Callers"
created: 2026-10-26
updated: 2026-10-28
tags: []
parent: PLAN-253
plan: PLAN-253
links:
  - {id: TASK-1998, type: blocks}
---
> ⚠ INVALIDATED 2026-10-27T06:26:31.429Z — superseded by adr-retire-the-lore-mcp-server-the-cli-and-http-are-the-only; lore MCP server removed (adr-retire-the-lore-mcp-server-the-cli-and-http-are-the-only): call-scope.ts and its ancestry check are deleted with it

Covers: AC-RV-6
Approach: call-scope.ts calls verifyRunAncestry for the call's harness_run before building the write context; the refusal literal 'if (!verified.ok) return refuseCall(verified.error)' appears verbatim once (AC-RV-6's falsifier). refuseCall is a NEW helper added by this task: refuseCall(error: LoreError): CallToolResult wraps the existing errorResult (call-scope.ts:48, unchanged) so the refusal carries the BR-1351 cause text; it does not exist on main 9bb6b4f9. The structured harness_run injection by the hook is unchanged (BR-1093).
Branching: branches from the verification task's branch on integration/run-identity-418 (plan I5).
