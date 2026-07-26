---
id: TASK-230
type: task
role: plan
title: "[Skill:verify] Merge + whole-repo oracles + code anchors + docs sync"
status: archived
priority: critical
phase: "Phase 2: Verification"
created: 2026-07-23
updated: 2026-07-23
tags: []
parent: PLAN-051
plan: PLAN-051
---
Estimate: S
Approach: Main-orchestrator task on the main checkout (LORE_ACTOR=agent:main-orchestrator): merge the three feature branches --no-ff in sequence (verify git log on each branch BEFORE merge — "Already up to date" on a branch that should carry work = STOP and recover), bun install if needed, bun run build (dist/lore freshness for any .bun.test spawning the binary), then whole-repo oracles: bun run typecheck + bun run test. Attested AC runs: lore verify plan-spec-069-execution-liveness-signals --allow-new-commands (records AC-069-1..8 evidence with attestation). Declare spec code anchors post-landing: lore anchor add spec-069-... for session-actor.ts#sessionActorFromId, task-workflow.ts#renewClaimForEvidence, session.ts#deriveLastActivityAt, cli/utils.ts#resolveActorWithSource; lore status --check-drift exit 0. Update root CLAUDE.md SPEC index + service/cli/core module CLAUDE.md files for the changed invariants. Worktree cleanup per discipline.
Source: plan Invariant 6 + CLAUDE.md worktree merge discipline
Dimensions: D-FUNC
Scope-Alt: none
Covers: AC-069-7, AC-069-8

AC:
- All three branches merged --no-ff, worktrees removed, branches deleted after git branch --merged confirmation
- bun run typecheck exit 0 on main (measured as: cmd; echo $? — never through a pipe)
- bun run test exit 0 on main (both runners)
- lore verify records attested pass evidence for AC-069-1..6 (script:test) and AC-069-7/8; under-match guard: verify output shows no inconclusive
- lore status --check-drift exit 0 after anchor declaration
- Root CLAUDE.md SPEC-069 entry added; core/service/cli module CLAUDE.md invariant updates committed
