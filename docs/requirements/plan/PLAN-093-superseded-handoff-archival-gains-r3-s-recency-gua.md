---
id: PLAN-093
type: plan
role: plan
title: "Superseded-handoff archival gains R3's recency guard"
status: archived
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: SPEC-122
phases:
  - {name: "Fix"}
---
# Plan — superseded-handoff archival gains R3's recency guard

## Goal
Implement `spec-superseded-handoff-archival-has-no-recency-guard` (approved): R2 flags a superseded handoff only once it is older than `handoffTtlMinutes`, so a concurrently-live session's ticket is unreachable by the sweep, while R2 stays distinct from R3.

## Oracle
`lore verify` over AC-R2-1 … AC-R2-4. `computeArchiveCandidates` is pure — `nowIso` and TTLs are injected, so no clock or store is involved.

## Phases
Single phase (`Fix`) — one task, one pure function plus its tests.

## Risks
- **Inverting the comparison** (reading the superseding doc's age instead of the superseded one's) would invert the protection and pass any young-case-only test. AC-R2-2 is the guard.
- **Collapsing R2 into R3.** R2 must keep reclaiming superseded handoffs under an ACTIVE plan. AC-R2-3 is the guard.
