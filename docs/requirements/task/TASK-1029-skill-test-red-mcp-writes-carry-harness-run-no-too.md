---
id: TASK-1029
type: task
role: plan
title: "[Skill:test] RED — MCP writes carry harness_run; no tool requires by"
status: archived
priority: medium
phase: "P3 Write surfaces"
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PLAN-162
plan: PLAN-162
links:
  - {id: TASK-1027, type: blocks}
---
Estimate: S
Source: AC-RID-7; validation ledger X4
TDD-Role: red | Paired-Impl: `task-skill-implement-mcp-harness-run-argument-optional-by-per`
Covers: AC-RID-7

Scenarios:
- Given the tool schemas in tools.ts, Then none declares by or recorded_by as required.
- Given a registered run R, When lore_create is called with harness_run R and no by, Then it succeeds and the audit row carries R; without harness_run, Then it succeeds unattested.
- Given lore_claim with harness_run R1 while R2 holds, Then refused naming R2.

AC:
- Given the file, When `cd packages/lore && bun test tests/integration/mcp/mcp-harness-run.bun.test.ts` runs before `task-skill-implement-mcp-harness-run-argument-optional-by-per`, Then it fails (required `by` still present), recorded with `lore evidence --result expected-fail --output-tail-file`.
