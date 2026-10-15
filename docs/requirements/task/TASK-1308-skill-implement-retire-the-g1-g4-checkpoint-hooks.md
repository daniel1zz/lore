---
id: TASK-1308
type: task
role: plan
title: "[Skill:implement] retire the g1-g4 checkpoint hooks after proving the writes refuse the same cases on CLI and MCP"
status: archived
priority: critical
phase: "Phase 1: Foundations"
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PLAN-181
plan: PLAN-181
links:
  - {id: TASK-1310, type: blocks}
  - {id: TASK-1304, type: blocks}
  - {id: TASK-1303, type: blocks}
---
Estimate: M
Approach: FIRST write the parity test (AC-TE-1) against the service-layer refusals and get it green with the hooks still present; only then delete lore-gate-g1..g4 from assets/hooks, assets/project/g1..g4 (project scaffold) and their entries in distribution-hooks.ts / project-setup-service.ts, this repo's hooks/g1..g4 and .claude/settings.json entries; regenerate the assets manifest. If a case is NOT refused by the write, stop and report (Risk R1).
Source: spec AC-TE-1; BR-1092, AS-8
Covers: AC-TE-1
AC:
- AC-TE-1 green via its declared command (lore ac list <spec>), red recorded first

Red first (Invariant I3): write the AC test file(s) first, run the AC command, record `lore evidence <this task> --oracle test --result expected-fail --output-tail-file <log>` yourself, then implement to green and record the pass. Commit before attesting. Scoped oracles only in the worktree (I4).
