---
id: TASK-269
type: task
role: plan
title: "[Skill:implement] phase-feed-flow + SSOT registration"
status: archived
priority: high
phase: "Phase 2: Services"
created: 2026-07-19
updated: 2026-07-19
tags: []
parent: PLAN-068
plan: PLAN-068
links:
  - {id: TASK-261, type: blocks}
---
Estimate: M
Approach: buildPhaseStartPack over the 3-method PhaseFeedFlowDeps (StalenessFlowDeps cap); register phase-start in feed-flow.ts CHECKPOINT_PRODUCED_TYPE SSOT map (never a parallel dispatch path); per-section budgets from workflow.phase_feed.* with truncated[]
Source: spec-spec-056 D5
Dimensions: D-FUNC, D-CODE
Scope-Alt: T2 chain-layer summarization can start naive (title+one-liner) — budget machinery is the contract
Covers: AC-P-4
AC:
- Given T6 RED feed suites, When implemented, Then AC-P-4 command exits 0 (CLI/MCP deep-equal included)
