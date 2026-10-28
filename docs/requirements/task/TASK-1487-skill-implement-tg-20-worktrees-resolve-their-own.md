---
id: TASK-1487
type: task
role: plan
title: "[Skill:implement] TG-20 worktrees resolve their own @lore packages, never main's"
status: archived
priority: critical
phase: "Phase 3: guards"
created: 2026-10-16
updated: 2026-10-25
tags: []
parent: PLAN-201
plan: PLAN-201
links:
  - {id: TASK-1496, type: blocks}
---
Estimate: M
Approach: Measured 2026-10-16: agent worktrees under .claude/worktrees/agent-*/ have no node_modules/@lore (only .vite caches), so module resolution walks up to the main checkout's node_modules/@lore/{core,lore,dashboard} -> ../../packages/*. A worktree that changes packages/core is then tested against main's core when code runs through `bun run src/index.ts` or bun test (T10's implementer saw its core change silently ignored). Find every resolution path (bun runtime, bun test, vitest aliases, tsc paths, the dist build) and make a worktree resolve @lore/* to its OWN packages, or fail loud naming the mismatch — no silent fallback. Root fix where worktrees are created (the WorktreeCreate hook / lore setup assets, if lore ships one) or in config (tsconfig paths / bunfig / vitest alias); a shipped fix goes through assets + manifest. Add a test: in a temp git worktree, a marker export changed in packages/core is the one seen by bun test and by vitest.
Source: spec-test-governance-guards-that-refuse-bad-tests-declared (scoped oracles in worktrees must test the worktree's code; AS-17 no silent blind spot)
AC: the new test proves a worktree's own @lore/core is resolved by both runners and by `bun run src/index.ts`; fails red against today's setup.
