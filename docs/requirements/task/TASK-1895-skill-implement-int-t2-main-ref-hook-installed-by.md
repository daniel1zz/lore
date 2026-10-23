---
id: TASK-1895
type: task
role: plan
title: "[Skill:implement] INT-T2 main-ref hook installed by lore setup; conflicts exit 4 unchanged; integrate origin/main; first-run detach of the shared checkout"
status: archived
priority: medium
phase: "Phase 1: integrate"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-238
plan: PLAN-238
links:
  - {id: TASK-1894, type: blocks}
  - {id: TASK-1893, type: blocks}
---
Estimate: M
Approach: per plan row INT-T2 and the ADR (Conflicts, Upstream, Installation and migration, E7). Hook asset shipped through assets/ + manifest, installed by lore setup into the repo hooks path; integrate sets the marker on its own update-ref. Red-first: AC-INT-2 halves.
Source: spec-main-advances-only-through-lore-integrate-per-session
AC: AC-INT-2.
