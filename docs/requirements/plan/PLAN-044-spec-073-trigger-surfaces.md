---
id: PLAN-044
type: plan
role: plan
title: "Plan — SPEC-073 trigger surfaces"
status: archived
priority: medium
created: 2026-07-24
updated: 2026-07-24
tags: []
parent: SPEC-073
phases:
  - {name: "Phase 1: Implementation", description: "Two parallel tracks: hints seam; assets stanza"}
links:
  - {id: SPEC-073, type: implements}
---
## Overview
Execute SPEC-073 (trigger surfaces, 4 ACs). 2 parallel tasks, 1 phase. Governance: unattended (autopilot). Small-plan routing: risk register folded into invariants; verification at orchestrator closure (verify + full suite).

## Governance Mode
unattended

## Invariants
1. Adapter-layer only — service error contracts byte-identical (no service/ or core/ edits except none expected).
2. Hint wording has ONE source (pure buildReportIssueHint); gate.ts and the error exit path both call it.
3. Unconfigured / exit-2 / plain-VALIDATION outputs byte-identical to pre-SPEC-073 baseline (snapshot-pinned).
4. Tests use throwaway corpora only (twin mkdtemp; never the repo's .lore/).

## Exit Criteria
All 4 ACs attested via lore verify; typecheck + dual-runner suites green on main.
