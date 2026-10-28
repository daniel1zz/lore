---
id: TASK-2052
type: task
role: plan
title: "[implement] Secondary write paths classify their writes; write-path matrix asserts each class"
status: approved
priority: high
phase: "Phase 2: Write paths"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-258
plan: PLAN-258
links:
  - {id: TASK-2067, type: blocks}
  - {id: TASK-2068, type: blocks}
  - {id: TASK-2054, type: blocks}
---
Estimate: L
Approach: per spec Scope 3, secondary paths: updateWithProvenance also_update companions, store/plan-progress.ts buildPlanProgressWrite / reconcilePlanProgress*, cascadeArchiveOnPlanClose, archiveSweepCandidate, rule-leaf writes (rule-leaf-companion-writes.ts, applyRuleLeafPatch* in the three stores), phase checklist/track verbs, red-first, landing anchor rewrite.
Source: spec Scope 2-3; investigation list of version insert sites (sqlite-store insertVersionSync callers; turso inline inserts; in-memory insertVersion).
Covers: AC-HC-6, AC-HC-8

## Work
- Route every listed path through isContentChange + buildStateChange via the store flag T2a introduced. Inserts, soft-delete, undelete and ordinal-only paths are NOT classified.
- Extend packages/lore/tests/integration/write-path-everywhere.bun.test.ts so each matrix row asserts its class, with the three declared falsifiers (plan-progress, also_update companion, softDelete).

## AC
- AC-HC-6 and AC-HC-8 commands pass on SQLite and Turso, red first; `lore audit --verify` passes after the matrix.

## Also
- Landing's anchor rewrite goes through drift-check-service.ts:374 (called by integrate-service's deps.anchors.follow); classify there.
- Update the comments that state "exactly one insertVersion per write": phase-checklist-service.ts:9,39, drift-check-service.ts:44, requirement-service.ts:38, ac-service.ts:83, task-workflow-service.ts:5896. Write each new comment so it names isContentChange.
- Run the full `bun run test:vitest` in the worktree before release (the integrate floor runs no tests).
