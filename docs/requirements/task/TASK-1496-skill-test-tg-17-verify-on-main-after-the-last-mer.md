---
id: TASK-1496
type: task
role: plan
title: "[Skill:test] TG-17 verify on main after the last merge"
status: draft
priority: high
phase: "Phase 5: cadence"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-201
plan: PLAN-201
---
Estimate: S
Approach: Orchestrator task. On main after the last merge: bun run build, then lore verify the plan (AC-TG-2..11); record the wall times; run the T14 cross-check against this full run.
Source: spec-test-governance-guards-that-refuse-bad-tests-declared
AC: AC-TG-9, AC-TG-10, AC-TG-11 pass via lore verify on main.
