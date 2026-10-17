---
id: TASK-1503
type: task
role: plan
title: "[Skill:implement] TG-5 repo-tree snapshot guard and isolation ledger"
status: archived
priority: high
phase: "Phase 3: guards"
created: 2026-10-16
updated: 2026-10-17
tags: []
parent: PLAN-201
plan: PLAN-201
links:
  - {id: TASK-1498, type: blocks}
  - {id: TASK-1496, type: blocks}
---
Estimate: M
Approach: Extend scripts/test-isolation-setup.ts: vitest globalSetup and the bun preload take a snapshot of git status --porcelain --untracked-files=all (gitignored build output excluded) before the run and compare after it; a new or modified path fails the run with exit 1 and lists the paths, unless scripts/test-isolation-ledger.json lists it as {path, rule, reason, bound_ac}; a ledger entry that no longer matches also fails. With maxWorkers 4 the check is per runner invocation, not per file. Red-first via AC-TG-3's fixture.
Source: spec-test-governance-guards-that-refuse-bad-tests-declared
AC: AC-TG-3.

Runner decision (ADR adr-tg-1-test-runner-decision-measured-comparison-of-bun-only, accepted 2026-10-17): option (b), one runner = vitest on the Bun runtime, migrated by T23 (blocks this task). Implement the snapshot in the one runner (vitest globalSetup) only; no bun preload part.
