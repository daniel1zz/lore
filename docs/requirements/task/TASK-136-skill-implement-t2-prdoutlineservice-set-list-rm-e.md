---
id: TASK-136
type: task
role: plan
title: "[Skill:implement] T2 PrdOutlineService (set/list/rm/exempt, CAS+version+audit) + CorpusService.set guards + renderOutlineContent"
status: archived
priority: critical
phase: "Phase 1: Core schemas & outline writer"
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PLAN-031
plan: PLAN-031
links:
  - {id: TASK-134, type: blocks}
  - {id: TASK-130, type: blocks}
---
Estimate: L
Approach: new service PrdOutlineService (store + optional telemetry DI) mirroring RequirementService/AcService shape — CAS RMW single-entry patch, version insert + audit row per write; CorpusService.set gains outline/prd_sync_exempt rejection following the SPEC-043 validity-guard + SPEC-076 drop-guard shapes; renderOutlineContent pure fn follows renderHandoffContent convention (extra = SSOT, content generated).
Source: SPEC-080 C1, C4 (exempt writer); service/CLAUDE.md dedicated-writer precedents
Dimensions: D-FUNC, D-CODE
Scope-Alt: `lore outline rm` may defer if migration never needs entry removal — but verb family completeness preferred.
Covers: AC-080-2, AC-080-4 (dedicated-writer halves)

AC:
- Given T2r RED suite, When run post-implementation, Then all GREEN.
- Given outlineSet patch, When applied twice with identical payload, Then second call is a no-op (no version bump) — idempotency.
- Given app.ts composition, When built, Then PrdOutlineService wired with GateEnforcer-parallel optional-DI shape; bare `new PrdOutlineService(store)` stays unwired (test-construction compatibility).
- `bun run typecheck` exit 0; both runners green scoped.

Integration: service exposed on App; consumed by CLI T3. CorpusService.set guard is REGRESSION-pinned: existing set flows (title/content/status) byte-unchanged.
