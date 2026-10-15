---
id: TASK-1301
type: task
role: plan
title: "[Skill:verify] land spec-an-active-spec: rule apply, anchors, lore verify, full suite on main"
status: archived
priority: medium
phase: "Phase 2: Land and verify"
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PLAN-180
plan: PLAN-180
---
Estimate: S
Approach: Main agent after D1 merge: bun run build; full suite + typecheck on main; lore verify <plan>; plan close applies BR-104; lore anchor add.
Source: all AC-ACT-*
Covers: landing (no AC of its own)
AC:
- lore verify <plan> exit 0 with every script AC of the spec attested; bun run test:vitest, bun run test:bun, bun run typecheck exit 0 on main
