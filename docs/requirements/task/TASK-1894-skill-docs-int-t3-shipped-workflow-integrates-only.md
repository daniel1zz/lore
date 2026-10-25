---
id: TASK-1894
type: task
role: plan
title: "[Skill:docs] INT-T3 shipped workflow integrates only through lore integrate; per-session test isolation proven"
status: archived
priority: medium
phase: "Phase 1: integrate"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-238
plan: PLAN-238
links:
  - {id: TASK-1893, type: blocks}
---
Estimate: S
Approach: per plan row INT-T3: rewrite the merge steps in assets/context/worktree-dispatch.md, assets/skills/lore-autopilot/SKILL.md and the rendered project rule (.claude/rules/lore-worktree-dispatch.md via the build) to lore integrate; corpus commands stay in the shared checkout (corpus home). Two-process isolation test. Fresh-install verification.
Source: spec-main-advances-only-through-lore-integrate-per-session
AC: AC-INT-3.
