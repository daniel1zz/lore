---
id: TASK-273
type: task
role: plan
title: "[Skill:implement] core phase.ts + phase-completion.ts + schemas wiring"
status: archived
priority: critical
phase: "Phase 1: Core contracts"
created: 2026-07-19
updated: 2026-07-19
tags: []
parent: PLAN-068
plan: PLAN-068
links:
  - {id: TASK-272, type: blocks}
  - {id: TASK-271, type: blocks}
  - {id: TASK-268, type: blocks}
---
Estimate: M
Approach: per SPEC-056 Module Boundary + Public Interface (two-file split: schemas+invariants / derivation); wire phaseExtraSchema into schemas.ts superRefine per KNOWLEDGE_SUB_TYPES precedent
Source: spec-spec-056 sections Module Boundary, Public Interface, D3/D4
Dimensions: D-FUNC, D-CODE
Scope-Alt: PHASE_KINDS enum can ship with 3 members (backend/frontend/fullstack) if infra/docs contested
Covers: AC-P-1, AC-P-2
AC:
- Given the T1 RED suites, When implemented, Then AC-P-1 and AC-P-2 commands exit 0
- Given a non-phase doc, When phaseExtraSchema paths run, Then existing doc types validate byte-identically (regression)
