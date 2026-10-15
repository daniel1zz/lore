---
id: TASK-1346
type: task
role: plan
title: "[Skill:verify] land spec-always-loaded-rules: rule apply, lore verify, full suite on main"
status: archived
priority: low
phase: "Phase 2: Land and verify"
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PLAN-186
plan: PLAN-186
---
Estimate: S
Approach: Main agent after C1 merge: bun run build; full suite + typecheck on main; lore verify <plan>; plan close applies BR-1094.
Covers: landing
AC:
- lore verify <plan> exit 0 with AC-RT-1/2 attested; full suite and typecheck exit 0 on main
