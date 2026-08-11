---
id: PLAN-110
type: plan
role: plan
title: "Implementation — assessment freshness gate (SPEC-106)"
status: archived
priority: medium
created: 2026-07-28
updated: 2026-07-29
tags: []
parent: SPEC-106
phases:
  - {name: "P1-impl"}
---
## Goal
Implement SPEC-106: an `assessmentFreshness` predicate on the armed `plan-close` gate plus a non-blocking staleness advisory on `lore assess`. ACs AC-FRESH-1..5, script:test.

## Phases
- P1-impl: checkpoint-registry predicate + GateContext fields + CorpusService resolver (newest assessment vs newest evidence/done audit row) + feeding pack + `lore assess` advisory + config-shaped exemption; vitest unit + bun integration tests.

## Execution notes
Single task, single worktree. The plan-close gate already exists (SPEC-054/069) and already carries the attestation floor + UAT judgment — this is an additive predicate on armed machinery, NOT a new checkpoint. Anchors are disjoint from any concurrent session's dashboard/http work.
