---
id: KN-318
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-07-30
updated: 2026-10-10
tags: []
parent: PLAN-102
---
# Handoff — agent:main-orchestrator

SCOPE: 3 decisions + 5 next steps = 8 items to account for

## Plan

plan-implementation-plan-close-predicates-measure-invariants

## Task Refs

(none)

## Modified Files

- packages/lore/src/service/gate-predicates.ts
- packages/lore/src/service/checkpoint-registry.ts
- packages/lore/src/service/predicate-contracts.ts
- packages/core/src/evidence-panel.ts
- packages/core/src/config.ts

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | ADR plan-close-predicates DELIVERED and self-attested: 16/16 ACs attested at 8227dd1; both this plan and the motivating context-provenance plan closed with exempt=[] on each.@high | — |
| KD2 | The motivating plan's denial went from ATTESTATION_FLOOR_NOT_MET + PRD_OUTLINE_NOT_SYNCED to one legitimate ASSESSMENT_STALE — the two ADR-targeted predicates now pass it.@high | — |
| KD3 | Work sits on fix/governance-never-discard-lore-output at 8227dd1, reachable via the worktree scratchpad/integ. The lore on PATH is a dev symlink into the shared checkout (on main) and lacks this work.@high | — |

## Failing Oracle

(none)

## Next Steps

- NS1: Stamp commit provenance on runner-written evidence (finding 3): AC-PCI-2/3 held pass evidence while measurably RED on the merged tree, and nothing could detect it. Then a close conjunct can require each claimed AC's newest attested entry to be measured at an ancestor of the closing commit.
- NS2: Fix lore verify --ac, silently inert (finding 1): it ran all 16 ACs on every restricted run, so every task now carries attested entries for ACs it never claimed. Assert the executed-AC set equals the requested set, plus a control run.
- NS3: Give extra.decision_status a narrow CLI writer (finding 2), mirroring the --slug precedent; today proposed->accepted is MCP-only.
- NS4: Decide report-issue's concurrent-write contract (finding 6): AC-072-9 flakes ~10% on BOTH baseline 17c1a44 and merged 8227dd1. Specify and enforce the contract; never add a retry.
- NS5: Evaluate whether attestationFloor condition 1 still earns its cost (finding 8): it forces N verify runs for an N-task plan, the same burn-CPU shape the ADR criticised in the ratio.
