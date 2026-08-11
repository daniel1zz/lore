---
id: TASK-593
type: task
role: plan
title: "T1 verifyReachability helper + plan-promote advisory + feedAttestationFloor branch + attestation_exempt_kind"
status: archived
priority: medium
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PLAN-114
plan: PLAN-114
---
Implement all three mechanisms of spec-verify-reachability-plan-promote-early-warning (read the spec first — it is the SSOT, incl. 4 script-mode ACs whose test-file paths are contractual):
M1 verifyReachability pure helper (gate-predicates.ts) + plan-promote ADVISORY (never affects verdict, mirrors gate_skipped D1 observability rule).
M2 feedAttestationFloor (checkpoint-registry.ts:935) branches on the SAME helper: reachable -> byte-identical current text; unreachable -> replace the 'Recovery: run lore verify' sentence with precondition explanation + two real options.
M3 attestationExemptKindSchema (@lore/core schemas.ts): enum red-tdd|no-oracle|pipeline-unreachable|other; checkPlanClose requires valid kind whenever attestation_exempt===true (feeding pack names the enum with one-line meanings).
Test files MUST match the AC-declared paths exactly: verify-reachability.test.ts / feed-attestation-reachability.test.ts / attestation-exempt-kind.test.ts under packages/lore/tests/unit/service/. Context: checkPlanClose exemption read ~checkpoint-registry.ts:328/869-915; SPEC-069 owns ratio math (do not touch).
