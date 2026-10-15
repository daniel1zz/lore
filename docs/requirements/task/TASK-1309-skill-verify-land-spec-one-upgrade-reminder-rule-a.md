---
id: TASK-1309
type: task
role: plan
title: "[Skill:verify] land spec-one-upgrade-reminder: rule apply, code anchors, lore verify, full suite on main"
status: archived
priority: medium
phase: "Phase 3: Land and verify"
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PLAN-182
plan: PLAN-182
---
Estimate: S
Approach: Main agent after A1-A3 merge: bun run build; full suite + typecheck on main; lore verify <plan>; lore anchor add <spec> for the landed files; plan close applies the rule change set (lore rule apply).
Source: all AC-UR-*
Covers: landing (no AC of its own)
AC:
- lore verify <plan> exit 0 with every script AC of the spec attested; bun run test:vitest, bun run test:bun, bun run typecheck exit 0 on main
