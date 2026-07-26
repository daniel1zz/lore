---
id: TASK-166
type: task
role: plan
title: "[Skill:implement] T8 path shim + GET /api/projects + R-17 dispatch boundary"
status: archived
priority: critical
phase: "Phase 2: Server wave"
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PLAN-038
plan: PLAN-038
links:
  - {id: TASK-163, type: blocks}
---
Estimate: M
Approach: adapters/http/index.ts — multi-mode branch: parse /api/p/:name prefix → resolve MountEntry (unregistered → 404 JSON; errored → named 5xx with per-project diagnostic) → strip prefix → delegate to existing handleApiRoute/handleDashboardRoute with that entry's app; per-request try/catch flips entry to error state (R-17). New adapters/http/projects-route.ts: GET /api/projects (cookie OR bearer) rendering registry + per-mount state + instance identity (port + registry name). Watchdog wrapper around store dispatch IF T2's spike concluded hang-possible — consume T2's recorded conclusion. Registry-less mode: branch inert, zero path changes.
Source: spec-078 D4+D7+D8; T2 spike conclusion; T5 MountRegistry interface.
Dimensions: D-FUNC, D-CODE
Scope-Alt: instance identity display can be name+port only (no PID) v1.
Covers: AC-078-5, AC-078-10

AC:
- Given tests/unit/http/projects-route.bun.test.ts, Then GREEN: 3+ distinct states rendered + both identity fields present.
- Given tests/unit/mount/runtime-isolation.bun.test.ts (throwing-stub App injected), Then GREEN: stub project routes return named 5xx and /api/projects flips its state to error, while the other project serves 200 and a write lands.
- Given registry-less mode, When the server boots, Then no /api/p/ handling is reachable and all existing routes byte-match today's paths (R-15).
- Integration: multi-mode `lore dashboard` serves 2 mkdtemp corpora end-to-end locally (manual boot check recorded in evidence output_tail).
