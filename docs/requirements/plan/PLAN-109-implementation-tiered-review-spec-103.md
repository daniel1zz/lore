---
id: PLAN-109
type: plan
role: plan
title: "Implementation — tiered review (SPEC-103)"
status: archived
priority: medium
created: 2026-07-28
updated: 2026-07-29
tags: []
parent: SPEC-103
phases:
  - {name: "P1-service"}
  - {name: "P2-gate-cli"}
  - {name: "P3-hardening"}
---
## Goal
Implement SPEC-103 tiered review: M1 ledger fast-track + provenance recording, M2 judgment-required promote with worst-decision-wins + override, M3 pending filter + backfill verb. ACs AC-TIER-1..8 bound to script:test oracles.

## Phases
- P1-service: CorpusService ledger fast-track (create + atomic edit re-fast-track), workflow.review.* config keys, ai_provenance recording at AIProviderService seam, vitest (AC-TIER-1/2/6/7).
- P2-gate-cli: ReviewService.approve judgment-required predicate + worst-decision-wins + --override-judgment, pending default filter + --all, `lore review backfill-ledger`, integration tests (AC-TIER-3/4/5/8).

## Execution notes
MUST NOT start until plan-implementation-trace-layer-spec-102 merges to main (anchor overlap: corpus-service.ts / gate-enforcer.ts / adapters/cli). Sequential chain T1→T2, one implementer, one worktree, LORE_ACTOR=agent:tiered-review. Worktree oracle: bun run test:changed + typecheck only.
