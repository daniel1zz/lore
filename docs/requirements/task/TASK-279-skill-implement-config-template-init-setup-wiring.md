---
id: TASK-279
type: task
role: plan
title: "[Skill:implement] Config template + init/setup wiring"
status: archived
priority: high
phase: "Phase 1: Profiles slice"
created: 2026-07-19
updated: 2026-07-19
tags: []
parent: PLAN-070
plan: PLAN-070
links:
  - {id: TASK-277, type: blocks}
---
Estimate: S
Approach: NEW assets/project/lore-config-template.yaml + lore init / setup --project wiring to seed it (D6 — no existing templating to extend, honest new surface)
Source: spec-spec-058 D6
Dimensions: D-FUNC
Scope-Alt: none
Covers: AC-V-4
AC:
- Given verification-profile-template.test.ts, When run, Then template exists, parses, and a scaffolded corpus contains the block
