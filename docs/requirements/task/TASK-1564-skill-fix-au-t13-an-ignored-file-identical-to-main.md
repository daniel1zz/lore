---
id: TASK-1564
type: task
role: plan
title: "[Skill:fix] AU-T13 an ignored file identical to main's copy is loss-free; regenerable set is governed data, not a hard-coded list"
status: archived
priority: critical
phase: "Phase 1d: apply on main"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-204
plan: PLAN-204
---
Estimate: S
Approach: After AU-T10 merged, lore done kept BOTH agent worktrees of the next merges (AU-T10's and AU-T5's) with 'ignored data outside the regenerable set: packages/dashboard/dist/, packages/dashboard/src/routeTree.gen.ts, packages/lore/src/generated/dashboard-assets.ts' — build outputs every worktree has, so every agent worktree now escalates and cleanup needs the human again. Root cause: the regenerable set is a hard-coded list (node_modules, dist, .turbo, coverage, *.tsbuildinfo) with no proof rule. Fix: an ignored path is loss-free when (a) it is byte-identical to the same path in the main checkout (or for a directory, every file under it is), or (b) it matches the project's governed regenerable patterns (stored with the class table through lore, loosening = governance-loosen, initial patterns from the current list plus generated outputs declared by the build: packages/*/dist/, **/*.gen.ts, packages/lore/src/generated/**) — state which. A differing file outside both (e.g. .env with unique content) still escalates. Red-first: worktree with only those three generated paths -> removed; control with a .env -> kept, escalated.
Source: spec-autonomy-phase-1-decision-function-human-channel-lore AC-AU-11; live result 2026-10-18 (lore done kept two worktrees)
AC: red-first case + control; existing AC-AU-11 oracle still passes.
