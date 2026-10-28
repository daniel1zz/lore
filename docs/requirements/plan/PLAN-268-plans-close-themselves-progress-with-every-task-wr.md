---
id: PLAN-268
type: plan
role: plan
title: "Plans close themselves: progress with every task write, batched acceptance after landing"
status: archived
priority: high
created: 2026-10-23
updated: 2026-10-25
tags: []
parent: SPEC-236
phases:
  - {name: "P", description: "Plan progress and batched acceptance"}
---
# Plans close themselves

## Goal

Land spec-plans-close-themselves-level-triggered-reconciliation-of: plan progress written with every task transition; complete plans reviewed in one detached batch after landing and archived.

## Preconditions

Spec approved (v25). D6 (retired-AC owner decision) lands first or alongside.

## Tasks

- P1 progress in the same transaction as every task/phase transition, migration backfill, archived-plan refusals (AC-PCR-1, AC-PCR-2).
- P2 landing trigger, detached batch, lease, outcomes, retry, owner path (AC-PCR-3..5), after P1.
- P3 bootstrap complete line and checks stats time-to-accept and anomalies (AC-PCR-6), after P1.
