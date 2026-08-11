---
id: PLAN-107
type: plan
role: plan
title: "Implementation — worktree-derived actor identity (SPEC-104)"
status: archived
priority: medium
created: 2026-07-28
updated: 2026-07-29
tags: []
parent: SPEC-104
phases:
  - {name: "P1-impl"}
  - {name: "P2-fallout"}
---
## Goal
Implement SPEC-104 worktree-derived actor identity. Single task; ACs AC-ACTOR-1..5 script:test.

## Phases
- P1-impl: resolveActorWithSource worktree-derivation tier + identitySource threading + bun tests.

## Execution notes
Anchors (utils.ts, commands/claim.ts) are DISJOINT from plan-implementation-tiered-review-spec-103 anchors — may run in a parallel worktree with LORE_ACTOR=agent:actor-derive once trace-layer merges (utils.ts untouched by trace plan; verify with git log before dispatch).
