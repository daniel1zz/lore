---
id: PLAN-068
type: plan
role: plan
title: "Implementation — SPEC-056 phase execution model (Strategy A)"
status: archived
priority: medium
created: 2026-07-19
updated: 2026-07-19
tags: []
parent: SPEC-056
phases:
  - {name: "Phase 1: Core contracts", description: "Pure core: phase.ts (schemas+scope-freeze), phase-completion.ts, schemas.ts wiring; migration shape spike seeds fixtures from the REAL corpus (read-only). Serial foundation."}
  - {name: "Phase 2: Services", description: "4-way parallel behind P1 contracts, disjoint anchors: PWS rename + checkpoint/config alias | PhaseChecklistService | phase-feed-flow + SSOT registration. Consumer list from spike task folded in."}
  - {name: "Phase 3: Adapters and migration", description: "CLI/MCP surfaces + checklist_ref evidence field | PhaseMigrationService (D6/D6a) | assets resync + app.ts wiring."}
  - {name: "Phase 4: Cutover verification", description: "Migration dry-run on corpus COPY, both-runner regression, lore verify attested ACs, docs sync, spec code anchors declared."}
---
# Implementation — SPEC-056 Phase execution model

NOTE: this plan (and its siblings for SPEC-057/058) still uses the CURRENT task model — deliberately the last task-model plans before the phase migration this very plan implements. Recorded for the future `lore assess`.

## Overview
Land SPEC-056 via Strategy A (Interface-First big-bang cutover + migration shape spike, owner-selected): P1 core contracts (serial foundation) → P2 services (4-way parallel, disjoint anchors) → P3 adapters + migration → P4 cutover verification. Hard constraint: migration + task→phase rename + assets resync land in the SAME release.

## Invariants
- I1: `bun run typecheck` exits 0 after every merged task (never merge red).
- I2: existing task-era suites stay green until P4's cutover task explicitly migrates them (legacy READ tolerance — no write path).
- I3: no service imports another service; all new deps via injected ports/thunks (composition in app.ts only).
- I4: `ac_ref` evidence semantics byte-unchanged; `checklist_ref` strictly additive.
- I5: every task claims with a distinct `LORE_ACTOR=agent:<slug>` from inside its own worktree.

## Risk Register
- R1 [H][Technical] getPlanBundle/assessPlan/resolveTargetTask consumer rename wider than enumerated → Trigger: tsc errors outside declared anchors → Mitigation: P1 spike task also greps the full consumer list into the task docs → Contingency: extend anchors + serialize conflicting tasks.
- R2 [H][Technical] live-corpus task rows contain shapes the migration fixture misses → Trigger: dry-run reconciliation diff != 0 on corpus copy → Mitigation: T3 shape spike seeds fixtures from the REAL corpus → Contingency: extend D6 edge rules, re-run (idempotent).
- R3 [M][Scope] assets resync misses a vendored task-claim reference → Trigger: assets-ssot conformance test red → Mitigation: T12 greps assets/ for task-claim|task_claim before editing → Contingency: follow-up task, same release.
- R4 [M][Quality] phase-claim gate fixture import breaks SPEC-042 suite isolation → Mitigation: import the fixture FILE, never copy → Contingency: shared fixture extraction module.

## Critical Path
(filled post-linking)

## Exit Criteria
All 7 SPEC-056 ACs attested via `lore verify`; both runners green; migration dry-run on a corpus COPY reconciles diff=0; `lore assess` run; CLAUDE.md + module CLAUDE.md updated with SPEC-056 entry; spec code anchors declared post-landing.

## Governance Mode
attended

## Decisions Log
- Strategy A over B (violates same-release constraint) and C (spike-first churns against unset contracts); C's essence folded in as P1 read-only shape spike. Owner-selected 2026-07-19.
