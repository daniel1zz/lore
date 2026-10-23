---
id: TASK-1897
type: task
role: plan
title: "[Skill:implement] INT-T9 run-chain --floor (check:floor): the integrate floor is check:static minus the corpus-dependent checks, one source"
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
Approach: INT-T4 needs workflow.integrate.floor_command for this repo. `bun run check:static` (scripts/run-chain.ts --static) includes the three CORPUS_DEPENDENT_CHECKS (check:spec-mirror, check:live-repo-state, check:corpus-fail-census) which judge corpus/mirror state, not the merged code; on main today corpus-fail-census is red (AC-TG-11, owned by TG-40) and spec-mirror drifts whenever any session writes the corpus, so a floor that includes them would block every integration for reasons the branch cannot affect. End state: run-chain gets a `--floor` mode = build + typecheck + every check:* EXCEPT the corpus-dependent set (one source: CORPUS_DEPENDENT_CHECKS), with the same per-step exit table; package.json gains `check:floor`; the corpus-dependent checks keep running where they belong (check:static, pre-push, mirror export). A fresh integration worktree needs dependencies: the floor command for this repo becomes `bun install --frozen-lockfile && bun run check:floor` — verify in a fresh `git worktree add` that this succeeds and how long it takes.
Red-first: test that --floor runs no corpus-dependent step and every other check: step (from package.json, not a hand list).
Source: INT-T4 preparation 2026-10-18
AC: test green; `bun install --frozen-lockfile && bun run check:floor` exits 0 in a fresh worktree of main (record time).
