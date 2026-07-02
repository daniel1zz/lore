---
id: TASK-023
type: task
role: plan
title: "Implement task workflow: core, service, CLI, MCP (AC-WF-1..12)"
status: archived
priority: high
phase: implement
created: 2026-07-02
updated: 2026-07-02
tags: []
parent: PLAN-003
plan: PLAN-003
links:
  - {id: TASK-022, type: blocks}
---
Implement SPEC-025 §8 file touch list end-to-end: packages/core/src/task-workflow.ts (pure), schemas.ts (+evidence/claim, -task_status), errors.ts (+CLAIM_CONFLICT), config schema (workflow.claim_ttl_minutes default 120), telemetry events, StoreInterface batch link query + 3 stores, TaskWorkflowService, CLI claim/release/evidence/ready + tree/list badges, MCP 4 tools (pre-declared z.object). Semantics per §8.3; decisions D1-D10 are ratified — do not relitigate.
