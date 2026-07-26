---
id: PLAN-070
type: plan
role: plan
title: "Implementation — SPEC-058 verification profiles (single slice)"
status: archived
priority: medium
created: 2026-07-19
updated: 2026-07-19
tags: []
parent: SPEC-058
phases:
  - {name: "Phase 1: Profiles slice", description: "RED -> core+wiring+threading -> template"}
  - {name: "Phase 2: Verification", description: "Attested ACs + regression + docs"}
---
# Implementation — SPEC-058 verification profiles (single slice)
NOTE: last task-model plans before phase migration. Cross-plan coordination (audit-completed enumeration 2026-07-19): this plan's gate-wiring task anchors packages/lore/src/service/checkpoint-registry.ts AND packages/lore/src/service/corpus-service.ts — BOTH also anchored by plan-056's PhaseWorkflowService-rename task (cross-plan overlap, invisible to the plan-scoped anchor gate, PRD honest limit). assets/ overlap with plan-056 was resolved by narrowing plan-056's anchors (this plan's assets/project/lore-config-template.yaml is now disjoint). Mitigation unchanged and sufficient: EXECUTE THIS PLAN FIRST, to completion, before plan-056 Phase 2 begins — whole-plan serialization covers both named file overlaps.
## Overview
Single slice: RED suites -> core verification-profile.ts + config + gate wiring (two named call-site threading edits) + status line -> template file + init/setup wiring -> attested verification.
## Invariants
- I1: typecheck green after each merged task; I2: unconfigured corpora byte-identical (frozen baseline fixture); I3: per-predicate knobs follow the SPEC-052 config pattern exactly.
## Exit Criteria
All 5 SPEC-058 ACs attested via lore verify; both runners green; spec code anchors declared post-landing.
## Governance Mode
attended
