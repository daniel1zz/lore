---
id: PLAN-069
type: plan
role: plan
title: "Implementation — SPEC-057 seat model (single slice)"
status: archived
priority: medium
created: 2026-07-19
updated: 2026-07-19
tags: []
parent: SPEC-057
phases:
  - {name: "Phase 1: Seat slice", description: "RED -> core+service+port -> surfaces+hook+assets"}
  - {name: "Phase 2: Verification", description: "Integration anchor + attested ACs + docs"}
---
# Implementation — SPEC-057 seat model (single slice)
NOTE: last task-model plans before phase migration (see plan-056 note). Cross-plan coordination (audit-corrected 2026-07-19): plan-056's assets-resync task originally declared a directory-wide assets/ anchor overlapping this plan's assets/hooks/session-start-resume.mjs + assets/governance/seat-briefing.md — RESOLVED by narrowing plan-056's anchors to assets/skills/ + the g4 gate hook files + corpus-workflow.md; after narrowing, this plan has NO anchor overlap with plan-056 or plan-058 (re-verified against all three anchor sets). Safe to run in parallel with either, in its own seat.
## Overview
Single vertical slice: RED suites -> core/seat.ts + SeatService + RealGitPort -> CLI/session-service/hook/briefing -> attested verification. All decisions in pure predicates (D5), GitPort 6 methods.
## Invariants
- I1: typecheck green after each merged task; I2: session-service stays git-free (D6 boolean threading); I3: SPEC-042 session-service resume fixtures byte-unchanged until AC-S-3's frozen-baseline test owns them.
## Exit Criteria
All 8 SPEC-057 ACs attested via lore verify; both runners green; seat-briefing + hook synced to assets SSOT; spec code anchors declared post-landing.
## Governance Mode
attended
