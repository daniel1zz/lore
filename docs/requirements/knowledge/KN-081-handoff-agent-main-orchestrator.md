---
id: KN-081
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: draft
priority: medium
created: 2026-07-24
updated: 2026-07-24
tags: []
parent: PRD-001
---
# Handoff — agent:main-orchestrator

## Plan

(none)

## Task Refs

(none)

## Modified Files

- packages/core/src/evidence-panel.ts

## Key Decisions

| Judgment | Confidence |
|---|---|
| SPEC-075 plan archived: 12/12 AC attested (final full-suite 38/38 e2e, adjudication e2e determinism confirmed 2x); PRD v0.13 §21 committed (console positioning D1, F1+F2 landed, F3 execution-read next batch, F4 admission-gated)@0.95 | — |

## Failing Oracle

(none)

## Next Steps

- Next batch per PRD §21: F3 execution read surface (design round first — /api/ready exists, deliverable is UI layer). BEFORE any adhoc-channel use: fix task-fix-spec-069-gap-adhoc-task-claim-structurally-impossible (adhoc tasks are structurally unclaimable — claim gate vacuous-passes only on parent_id===null). Watch F2 telemetry for the kill-criterion baseline (<3 sessions/week x 4wk freezes F3+, per-route_id attribution).
