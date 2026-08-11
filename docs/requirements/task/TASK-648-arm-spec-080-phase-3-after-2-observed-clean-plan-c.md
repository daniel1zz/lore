---
id: TASK-648
type: task
role: plan
title: "Arm SPEC-080 Phase 3 after 2 observed clean plan-closes — flip --check-prd-budget advisory to exit-3 in pre-push AND enable plan-close prd_sync knob; include I5 oracle (plain lore status byte-identity pre/post while disarmed) as arming precondition"
status: archived
priority: medium
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PRD-001
---
## Context
SPEC-080 close-out deliberately deferred arming (handoff-25 decision, conf 90): observe 2 clean plan-closes with the mechanisms advisory-only before enforcement. As of 2026-07-26 count = 1 (SPEC-080 itself).
## Expected
When 2 clean closes observed: (1) pre-push gains --check-prd-budget with exit-3 enforcement (hooks/pre-push + assets/project/pre-push byte-identical pair + pre-push-parity test + assets-manifest regen); (2) plan-close prd_sync knob ON; (3) before arming, capture plain 'lore status' output baseline and assert byte-identity while disarmed (judge rec #5, I5 oracle).
## Anchor
hooks/pre-push, packages/lore/src/service/checkpoint-registry.ts
## Provenance
knowledge-handoff-agent-main-orchestrator-25 next-steps + judge rec #5 (knowledge-assessment-implementation-spec-080-prd-as-outline).
