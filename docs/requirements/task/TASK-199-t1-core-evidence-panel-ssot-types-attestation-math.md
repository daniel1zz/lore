---
id: TASK-199
type: task
role: plan
title: "[T1] core evidence-panel SSOT: types + attestation math hoist + gate parity"
status: archived
priority: critical
phase: "Phase 1: Implementation"
created: 2026-07-24
updated: 2026-07-24
tags: []
parent: PLAN-042
plan: PLAN-042
links:
  - {id: TASK-198, type: blocks}
---
Create @lore/core evidence-panel.ts: EvidencePanelProjection union, AttestationSummary (ratio null when vacuous, zero_attested_tasks list), MOVE TaskAttestationInfo from gate-predicates.ts, buildTaskAttestationInfos(tasks), deriveAttestationSummary(infos,minRatio) reproducing BOTH attestationFloor conditions, summarizeForAdjudicationBar(panel). Thin gate-predicates.ts::attestationFloor to a delegate (import type from @lore/core) with byte-identical behavior. Tests: core pure-fn suite (AC-075-11 parity test over both condition classes, titles contain AC-075-11) + existing gate tests stay green. Oracles scoped: bun run typecheck + vitest on touched test files. Spec: SPEC-075 (lore ac list for AC-075-11). Design decisions D2/D6/D10 binding.
