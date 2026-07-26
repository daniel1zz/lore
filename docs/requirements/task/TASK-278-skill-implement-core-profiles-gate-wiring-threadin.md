---
id: TASK-278
type: task
role: plan
title: "[Skill:implement] core profiles + gate wiring + threading + status line"
status: archived
priority: critical
phase: "Phase 1: Profiles slice"
created: 2026-07-19
updated: 2026-07-19
tags: []
parent: PLAN-070
plan: PLAN-070
links:
  - {id: TASK-277, type: blocks}
---
Estimate: M
Approach: core verification-profile.ts + config schema + oracleCoverage/requiresUat predicates + GateContext specKind threading at corpus-service.ts:1260 and review-service.ts:113 (the two named call sites) + per-predicate knobs + lore status one-liner
Source: spec-spec-058 Module Boundary + D1-D5
Dimensions: D-FUNC, D-CODE
Scope-Alt: status line can defer to a follow-up if noisy (config-gated)
Covers: AC-V-1, AC-V-2, AC-V-3
AC:
- Given V1 RED suites, When implemented, Then AC-V-1/2/3 commands exit 0
