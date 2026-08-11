---
id: PLAN-022
type: plan
role: plan
title: "Implementation — P2 workflow state machine (checkpoint registry + commit-time gates)"
status: archived
priority: high
created: 2026-07-09
updated: 2026-07-26
tags: [ioc, p2, state-machine, gate]
parent: SPEC-086
phases:
  - {name: "Core: registry + predicates", description: "Pure, no IO: checkpointRegistry + new predicates, fully unit-tested before wiring"}
  - {name: "Gate wiring + config", description: "lore gate plan-promote|task-claim dispatch + workflow.gates config + feeding-pack"}
  - {name: "Hooks + e2e", description: "G3/G4 shims + settings wiring + closed-loop e2e on throwaway corpus"}
---
## Goal

Implement SPEC P2 (C2 design): generalize slice-1's two hardcoded gate checkpoints into a declarative `checkpointRegistry`, and add the two commit-time cross-tier gates — `plan-promote` (parent spec approved + ≥1 AC) and `task-claim` (plan's parent spec approved, upgrading the SPEC-032 advisory to a block). Preserve draft-authoring freedom; gate only at commit boundaries. Stateless: verdict is a pure fn of current corpus state.

## Phases

1. **Core: registry + predicates** — pure, no IO. The moat and its new predicates, fully unit-tested before any wiring.
2. **Gate wiring + config** — `lore gate plan-promote|task-claim` dispatch through the registry; `workflow.gates.*` per-checkpoint config; upstream feeding-pack assembly.
3. **Hooks + e2e** — G3/G4 shims mirroring g2, `.claude/settings.json` wiring, closed-loop e2e on a throwaway corpus.

## Invariants (every task honors)

- Verdict = pure function of corpus state; **no persisted workflow position** (slice-1 §5).
- The upstream-approved predicate is **SSOT shared** with `evaluateReadiness` (advisory read / blocking write) — do not fork the logic.
- Hooks **fail-open** + mandatory doc-type pre-check; the gate command **fails-loud**.
- **No create-time upstream gate** — authoring a draft under a draft upstream must never block.
- ⛔ Tests use a throwaway corpus (`mkdtemp` + `lore init`), never the repo `.lore`.

## Acceptance mapping

AC-P2-1 (T1) · AC-P2-4 (T3) · AC-P2-5 (T3) · AC-P2-6 (T3) · AC-P2-7 (T4) · AC-P2-8 (T6). Predicate-level: AC-P2-2/3 fold into T3's plan-promote tests.
