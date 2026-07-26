---
id: TASK-184
type: task
role: plan
title: "[Skill:implement] T3 planUpdate five-state pure classifier (@lore/core)"
status: archived
priority: critical
phase: "Phase 2: Core freshness logic"
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PLAN-040
plan: PLAN-040
links:
  - {id: TASK-183, type: blocks}
---
Estimate: M
Approach: New packages/core/src/plan-update.ts: pure planUpdate(embedded, installedManifest, probe) → Result<UpdatePlan, LoreError> per SPEC-076 Downstream Handoff. Digest-equal short-circuit BEFORE any per-file probe call. Five-state classification keyed by (disk sha vs manifest sha vs embedded sha) × ownership. Probe is an injected port (path → sha256|missing), sync in signature, no fs import in module (I2, import-graph pinned like AC-070-1 precedent).
Source: SPEC-076 §C3 + Downstream Handoff; RED tests from paired test task define the contract
Dimensions: D-FUNC, D-CODE
Scope-Alt: orphaned detection can scan only manifest-adjacent dirs (not full target walk) if walk cost bites — document if taken
Covers: AC-076-1

AC:
- Given the paired RED test file, When implementation lands, Then bunx vitest run packages/lore/tests/unit/core/plan-update.test.ts exits 0 with all ≥9 cases passing (GREEN, matched-count asserted)
- Given import-graph check, Then plan-update.ts imports no node:fs/node:child_process/bun modules (test asserts module source or import graph)
- tsc --noEmit clean
