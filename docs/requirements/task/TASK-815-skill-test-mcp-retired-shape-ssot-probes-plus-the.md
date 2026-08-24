---
id: TASK-815
type: task
role: plan
title: "[Skill:test] MCP retired-shape SSOT probes plus the missing stderr assertion on the AC-IS-2 green control — RED first"
status: archived
priority: medium
phase: "P1: Red"
created: 2026-08-24
updated: 2026-08-24
tags: []
parent: PLAN-143
plan: PLAN-143
---
Two files. NEW: mcp-issue-shape-message-ssot.test.ts with describes 'AC-MS-2 MCP retired-shape refusal comes from the shared definition' and 'AC-MS-3 MCP unconfigured and GitHub refusals unchanged' (titles verbatim — the AC statements name them as the traceability anchor). EXISTING: add the stderr substring assertion to the AC-IS-2 case in issues-upstream-shape-refusal.bun.test.ts; do not touch its other three cases. Record the red with lore evidence --result expected-fail at the moment it is red.
