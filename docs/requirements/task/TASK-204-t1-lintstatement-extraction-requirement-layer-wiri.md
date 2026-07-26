---
id: TASK-204
type: task
role: plan
title: "T1 — lintStatement extraction + requirement-layer wiring + six-dimension tests"
status: approved
priority: medium
created: 2026-07-20
updated: 2026-07-24
tags: []
parent: PLAN-067
plan: PLAN-067
---
Implement SPEC-059 T1 per the plan. Extract lintStatement primitive, re-express lintAcQuantifiability over it (byte-identical regression), add resolveRequirementQuantifiableEnabled (default true), wire lint into RequirementService.addRequirement (VALIDATION_ERROR on findings, message names R-id + word + fix), config-toggle. Six-dimension tests + CLI e2e. Attest all 6 SPEC-059 ACs via lore verify.
