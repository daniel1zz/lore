---
id: TASK-1533
type: task
role: plan
title: "[Skill:fix] TG-34 read recorder ignores git-ignored paths; drop 11 spawn-budget rows T25 retired"
status: archived
priority: high
phase: "Phase 3b: one runner"
created: 2026-10-17
updated: 2026-10-17
tags: []
parent: PLAN-201
plan: PLAN-201
links:
  - {id: TASK-1496, type: blocks}
  - {id: TASK-1498, type: blocks}
---
Estimate: S
Approach: Full run on main c8148d54 (after T25) failed 10 tests in 8 files. (1) 9 tests: UndeclaredTestInputError naming .lore-safety-backups/ (a git-ignored, untracked dir from 2026-07-20 at repo root). An ignored path can never appear in a git diff, so the selector can never use a declaration of it; the recorder (scripts/test-read-recorder.ts, from T13) must not count git-ignored paths as repository inputs. Root cause is in the recorder, not in the 7 tree-walking tests. (2) check-test-budgets exit 5: 11 ledger rows (issue-closed-state, issue-closure, migrate-ordinals-compiled, plan-exempt-attestation-compiled) no longer match a violation because T25 moved those tests in-process; remove the rows.
Source: spec-test-governance-guards-that-refuse-bad-tests-declared AC-TG-7, AC-TG-11
AC: red-first fixture: a test reading a git-ignored file in a temp repo passes the recorder, a tracked undeclared read still fails with UndeclaredTestInputError; bun scripts/check-test-budgets.ts exits 0; the 8 failing files pass.
