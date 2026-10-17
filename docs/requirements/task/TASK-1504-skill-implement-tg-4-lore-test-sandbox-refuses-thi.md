---
id: TASK-1504
type: task
role: plan
title: "[Skill:implement] TG-4 LORE_TEST_SANDBOX refuses this repository's corpus"
status: archived
priority: high
phase: "Phase 3: guards"
created: 2026-10-16
updated: 2026-10-17
tags: []
parent: PLAN-201
plan: PLAN-201
links:
  - {id: TASK-1503, type: blocks}
  - {id: TASK-1498, type: blocks}
  - {id: TASK-1496, type: blocks}
---
Estimate: M
Approach: New scripts/test-isolation-setup.ts sets LORE_TEST_SANDBOX=1 (inherited by child processes); register it in vitest.config.ts setupFiles and in a new packages/lore/bunfig.toml [test] preload (test:bun runs from packages/lore, whose root bunfig.toml has only [install]). In packages/lore/src/adapters/cli/corpus-resolution.ts (findLoreDbPath and every other resolution entry), when LORE_TEST_SANDBOX=1 and the resolved db lies inside the git toplevel of this repository's checkout, fail with exit 4 naming LORE_TEST_SANDBOX and the path (fail loud, no fallback). Red-first: the AC-TG-2 test, then the guard. Run the full suite once in the worktree to prove no remaining offender (T2/T3 cleared the known ones).
Source: spec-test-governance-guards-that-refuse-bad-tests-declared
AC: AC-TG-2.
