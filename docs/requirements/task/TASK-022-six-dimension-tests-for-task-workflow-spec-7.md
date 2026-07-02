---
id: TASK-022
type: task
role: plan
title: "Six-dimension tests for task workflow (spec §7)"
status: archived
priority: high
phase: tests
created: 2026-07-02
updated: 2026-07-02
tags: []
parent: PLAN-003
plan: PLAN-003
links:
  - {id: TASK-021, type: blocks}
---
Write tests per SPEC-025 §7: sequential-CAS recipe for STALE_VERSION/CLAIM_CONFLICT, TTL boundary at exactly 120min via now injection, 51st-evidence boundary, legacy task_status regression, ready-flip STATE tests, CLI/MCP translation-only layer tests. Runner split per repo convention.
