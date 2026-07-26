---
id: TASK-270
type: task
role: plan
title: "[Skill:implement] core seat.ts + SeatService + RealGitPort"
status: archived
priority: critical
phase: "Phase 1: Seat slice"
created: 2026-07-19
updated: 2026-07-19
tags: []
parent: PLAN-069
plan: PLAN-069
links:
  - {id: TASK-265, type: blocks}
---
Estimate: M
Approach: per SPEC-057 Public Interface + D1/D5/D7; GitPort 6 methods; predicates in core; RealGitPort node:child_process
Source: spec-spec-057 Module Boundary
Dimensions: D-FUNC, D-CODE
Scope-Alt: seat list formatting minimal (--json only first)
Covers: AC-S-1, AC-S-2, AC-S-6
AC:
- Given U1 RED suites, When implemented, Then AC-S-1/AC-S-2 commands exit 0
- Given mkdtemp real repo, When AC-S-6 integration runs, Then round-trip green
