---
id: PLAN-018
type: plan
role: plan
title: "SPEC-038 Implementation — AC-as-code"
status: archived
priority: medium
created: 2026-07-08
updated: 2026-07-08
tags: [spec-038, acceptance]
parent: SPEC-038
phases:
  - {name: "core-schema", description: "core schema layer: acceptance.ts, ORACLE_KINDS SSOT, ac_ref, specExtraSchema"}
  - {name: "service-cli", description: "AcService + ac verbs, resolveDeclaredAcIds port, adapters enum consolidation"}
  - {name: "assess-projection", description: "assess structured-AC prompt + containment; text projection AC rendering"}
  - {name: "verify-dogfood", description: "full oracle run, dogfood conversion of SPEC-038 ACs, docs sync"}
---
Implementation plan for SPEC-038 (AC-as-code). Phases: core-schema → service-cli → assess-projection → verify-dogfood. Task graph enforced via blocks links; readiness via lore ready; evidence via lore evidence (SPEC-025); closure via lore assess (SPEC-026). Self-hosted: this plan IS the dogfood — its spec's 11 prose ACs become the first structured acceptance_criteria after implementation lands.
