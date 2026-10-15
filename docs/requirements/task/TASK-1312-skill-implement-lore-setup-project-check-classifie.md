---
id: TASK-1312
type: task
role: plan
title: "[Skill:implement] lore setup --project --check classifies every project-managed file with exit 0/3 and writes only its own cache"
status: archived
priority: high
phase: "Phase 1: Project check"
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PLAN-182
plan: PLAN-182
links:
  - {id: TASK-1311, type: blocks}
  - {id: TASK-1309, type: blocks}
---
Estimate: M
Approach: Extend the existing global check (adapters/cli/setup-check.ts, BR-846 states) to the project scaffold's ledger (service/project-setup-service.ts). Lift the BR-849 refusal of --project with --check in commands/setup.ts. Define ONE cache shape shared by the global and project check, carrying the writing binary version, the per-state file lists and a reason hint (binary-version vs settings change) — the session-start advisory (A2) consumes it.
Source: spec AC-UR-1; BR-1085, BR-849 (modified)
Covers: AC-UR-1
AC:
- AC-UR-1 green via its declared command (lore ac list <spec>), red recorded first

Red first (Invariant I3): write the AC test file(s) first, run the AC command, record `lore evidence <this task> --oracle test --result expected-fail --output-tail-file <log>` yourself, then implement to green and record the pass. Commit before attesting. Scoped oracles only in the worktree (I4).
