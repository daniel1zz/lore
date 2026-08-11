---
id: KN-398
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-07-26
updated: 2026-07-27
tags: []
parent: PRD-001
---
# Handoff — agent:main-orchestrator

## Plan

(none)

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| Judgment | Confidence |
|---|---|
| Two SPEC-080 close-out adhoc defects FIXED+merged to main (attestation-floor pack plan-level repair 7ad57cf; profile-aware min_acs AC floor cd55cfc), full oracles green on merged main: typecheck 0, vitest 6182 pass, bun 1260 pass, manifest fresh | 90 |
| Pending queue 70→~8: 50 record-knowledge + 8 ADR + 8 task docs approved (completion verified per-task), spec-077 re-promoted v12, invalidated -2 dup rejected (stuck in queue = filed defect); spec-084 + declared-phase-rendering task left (foreign in-flight work) | 95 |
| Judge-rec triage: per-task attestation rec was ALREADY mechanized in attestationFloor (verified in evidence-panel.ts; SPEC-080 closed via legitimate plan-level exemption) — my premature dup task deleted; citation sweep blocked-on SPEC-084 | 90 |

## Failing Oracle

(none)

## Next Steps

- Open adhoc tasks (lore ready --adhoc): evidence oracle-file-existence precondition; SPEC-080-citation sweep (blocked on SPEC-084); Phase-3 arming tracker (needs 2 clean plan-closes, now 1 + I5 oracle); pending-invalidated-filter fix; gate spec-promote CLI pre-flight specKind parity
- task-dashboard-declared-phase-rendering-mirror-server: high priority, last evidence tsc FAIL — unfinished foreign work, left unapproved in pending
