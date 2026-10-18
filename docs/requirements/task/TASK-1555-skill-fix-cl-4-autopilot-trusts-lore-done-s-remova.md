---
id: TASK-1555
type: task
role: plan
title: "[Skill:fix] CL-4 autopilot trusts lore done's removal and sweeps at round end"
status: draft
priority: medium
phase: "Phase 1: cleanup without a human"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-205
plan: PLAN-205
---
Estimate: S
Approach: assets/skills/lore-autopilot/SKILL.md:119 tells the orchestrator to git worktree remove by hand; after CL-1, lore done removes it. Replace with: read lore done's worktree line; on keep, follow its named reason; run `lore worktree sweep --apply` (worktree-removal-service.ts:121-139, never called from assets today) at each round end. Same change in .claude/rules/lore-worktree-dispatch.md wording if shipped from assets. Verify from a fresh consumer install.
Source: spec-one-worktree-removal-test-for-the-guard-lore-done-and-a D3/D4; RCA 2026-10-18
AC: no manual git worktree remove instruction remains in shipped assets for the post-merge path (grep); sweep is named at round end.
