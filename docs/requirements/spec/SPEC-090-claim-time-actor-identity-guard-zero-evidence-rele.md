---
id: SPEC-090
type: spec
role: spec
title: "Claim-time actor-identity guard + zero-evidence release advisory"
status: approved
priority: medium
created: 2026-07-14
updated: 2026-07-16
tags: []
parent: PRD-001
---
## Overview/Goal

Mechanize the last two PROMPT-ONLY concurrency/evidence disciplines identified in the 2026-07-14 workflow-convergence review (see knowledge-convergence-backfill-code-anchor-adoption-armed-gate-f):

1. **Actor-identity guard (claim-time)** — SPEC-042's anchor-overlap gate and session registry both key on `by`. When every concurrent agent falls through to the same OS-username default, the gate never fires and all sessions collapse into one row (documented failure mode, SPEC-042 D10). Today the distinct-`LORE_ACTOR`-per-agent rule lives only in agent prompts. Add a deterministic task-claim gate predicate that detects identity-collision signatures at claim time.
2. **Zero-evidence release advisory** — SPEC-025 evidence discipline (oracle pass before release) is enforced only by implementer prompts. Add a read-side advisory (never a hard block — exploration tasks are legitimate) when `lore release` clears a lease on a task with an empty `extra.verification_evidence` log.

## Scope

- IN: a new `task-claim` checkpoint predicate (`actorIdentityGuard`) evaluated alongside `noAnchorOverlap`; identity-source plumbing (`flag | env | os_default`) from CLI/MCP actor resolution into claim gate context; `lore release` warning line + `warnings[]` field on CLI `--json` and MCP `lore_release`; per-predicate config escape `workflow.gates."task-claim".actor_identity.enabled` (default true), mirroring `anchor_overlap.enabled`.
- IN (guard trigger, conservative): REJECT only on a collision signature — claiming actor resolved from `os_default` AND another FRESH claim in the same plan holds the SAME `by` from `os_default` with a DIFFERENT `worktree`/`machine` (two sessions provably collapsed onto one identity). A solo human holding multiple tasks in one worktree never trips it.
- OUT: any daemon/heartbeat; storing identity source on the doc (gate-context-only); changes to `deriveSessions` grouping; hard-blocking release (advisory only, CQS-preserving).

## Design Notes

- Feeding pack on rejection names the `LORE_ACTOR=agent:<branch-or-slug>` convention and the conflicting claim's task/holder/worktree, plus the `--by` recovery flag — same shape as `gate:task-claim:anchor-overlap`.
- Identity source is computed where actor resolution already happens (CLI `--by` > $LORE_ACTOR > OS username; MCP `by` is always explicit → source `flag`), passed into `buildTaskClaim`/gate ctx — no store schema change.
- Release advisory is computed read-side in `TaskWorkflowService.release` from the doc already in hand — zero extra store calls.

## Acceptance Criteria

Structured ACs are declared via `lore ac add` (script mode); prose summary:

- AC-IDENTITY-REJECT: a claim with `identity_source=os_default` colliding with a fresh same-`by`/os_default/different-worktree claim in the same plan is rejected with `field: gate:task-claim:actor-identity`; distinct explicit identities (flag/env) never trip it.
- AC-IDENTITY-ESCAPE: `workflow.gates."task-claim".actor_identity.enabled: false` disables ONLY this predicate; anchor-overlap and upstream-approval behavior byte-identical (REGRESSION).
- AC-RELEASE-ADVISORY: `lore release` on a task with zero evidence entries exits 0 AND emits a warning (text line + `warnings[]` in `--json`/MCP); with ≥1 evidence entry the output is byte-identical to today (REGRESSION).


## Acceptance Criteria (structured)

- [·] [script] AC-IDENTITY-REJECT: A claim whose actor resolved from os_default, colliding with a fresh same-by/os_default/different-worktree claim in the same plan, is rejected with field gate:task-claim:actor-identity; distinct explicit identities (flag/env) never trip the predicate
  script: test — cd packages/lore && bun test tests/unit/service/actor-identity-guard.bun.test.ts
- [·] [script] AC-IDENTITY-ESCAPE: Config workflow.gates."task-claim".actor_identity.enabled=false disables ONLY the actor-identity predicate; anchor-overlap and upstream-approval outcomes stay byte-identical (REGRESSION)
  script: test — cd packages/lore && bun test tests/unit/service/actor-identity-guard.bun.test.ts
- [·] [script] AC-RELEASE-ADVISORY: lore release on a task with zero evidence entries exits 0 AND emits a warning (text line + warnings[] in --json/MCP lore_release); with >=1 evidence entry output is byte-identical to current behavior (REGRESSION)
  script: test — cd packages/lore && bun test tests/unit/service/release-advisory.bun.test.ts
