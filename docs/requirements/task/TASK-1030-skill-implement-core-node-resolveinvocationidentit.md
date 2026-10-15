---
id: TASK-1030
type: task
role: plan
title: "[Skill:implement] core/node resolveInvocationIdentity with injected warn sink"
status: archived
priority: high
phase: "P1 Contracts"
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PLAN-162
plan: PLAN-162
links:
  - {id: TASK-1043, type: blocks}
  - {id: TASK-1026, type: blocks}
  - {id: TASK-1027, type: blocks}
  - {id: TASK-1035, type: blocks}
---
Estimate: S
Approach: per spec D1, D8 — node-only module exported from `@lore/core/node`; warn sink injected (default writes one stderr line); claimed precedence --by > $LORE_ACTOR
Source: spec §Public interface; existing pattern packages/core/src/actor-resolution-node.ts
Dimensions: D-FUNC
Scope-Alt: none
Covers: AC-RID-6

AC:
- Given `task-skill-test-red-resolveinvocationidentity-flag-strip`'s tests, When `bunx vitest run packages/core/tests/run-identity-node.test.ts`, Then all pass with `Tests N passed`.
- Given `bun run typecheck`, Then exit 0.
