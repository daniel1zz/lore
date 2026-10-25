---
id: TASK-1899
type: task
role: plan
title: "[Skill:fix] INT-T10 lore baseline adopt still writes .lore/config.yaml into the corpus checkout (dirname(dirname(dbPath))), missed by INT-T5"
status: archived
priority: medium
phase: "Phase 1: integrate"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-238
plan: PLAN-238
---
Estimate: S
Approach: lore assess of plan-main-advances-only-through-lore-integrate (2026-10-19) found packages/lore/src/adapters/cli/commands/baseline-adopt.ts still derives repoDir = dirname(dirname(dbPath)) for a write of .lore/config.yaml (a tracked file) — the INT-T5 inventory missed it, so `lore baseline adopt` run from a session worktree edits the shared checkout's config. Route it through resolveTrackedWriteRoot / the working-tree root like the INT-T5 commands, and re-run the inventory grep (dirname(dirname( and every tracked-file writer under adapters/cli and flows) to confirm it was the last one; list any other in the report.
Red-first: throwaway repo + linked worktree, `lore baseline adopt ...` from the worktree changes the worktree's config and leaves the main checkout byte-identical (red today).
Source: lore assess 2026-10-19
AC: test green; the inventory grep shows no remaining corpus-root write target.
