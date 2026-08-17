---
id: TASK-653
type: task
role: plan
title: "Ship the anchor-coverage exemption ledger and arm the ratchet with its reverse stale-exemption check"
status: archived
priority: medium
phase: "anchor-ratchet"
created: 2026-08-11
updated: 2026-08-17
tags: []
parent: PLAN-121
plan: PLAN-121
---
Implements AC-BFI-5, AC-BFI-6 and AC-BFI-7 of spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor.

## Objective

Ship `scripts/anchor-coverage-ledger.json` plus `scripts/check-anchor-coverage.ts`, arming a ratchet
that stops anchor coverage from decaying further.

## Measured baseline (2026-08-11, direct SQL — lore list --json projects extra as {} and cannot be used)

142 live specs, 87 anchored, 55 unanchored. Split by the 2026-07-14 backfill date:

- 11 created on or before 2026-07-14 -> cohort `deliberate`. Rationale inherited verbatim from
  knowledge-convergence-backfill-code-anchor-adoption-armed-gate-f: implementations spread across
  files with no clean anchor; anchoring them imprecisely would manufacture false-drift noise.
- 44 created after -> cohort `debt`. Every spec authored since the backfill declared no anchor.

## Three ACs

- **AC-BFI-5** — ledger set EQUALS the freshly measured unanchored set (⛔ set equality, never the
  literal 55). Each row: slug, cohort, reason. Reason is machine-constrained: non-empty after trim,
  >= 20 chars, not in {tbd, todo, n/a, na, -, ?, xxx, fixme, pending} case-insensitively.
- **AC-BFI-6** — an unanchored spec with no ledger row exits EXACTLY 1 naming the slug; ledger it and
  the identical run exits EXACTLY 0. The paired transition is what proves the red came from the
  missing disposition rather than a crash.
- **AC-BFI-7** — the REVERSE direction: a ledger row whose spec now HAS anchors exits EXACTLY 1
  naming the slug. A checker validating only "unanchored implies ledgered" passes this silently and
  is the precise failure being excluded.

## Constraints

- Model the ledger on `scripts/ac-ref-exemption-ledger.json` and follow
  adr-a-newly-armed-structural-oracle-enforces-from-a-baseline. Do not invent a new enforcement shape.
- ⛔ Write a ledger row in preference to synthesizing an anchor: 44 imprecise anchors would satisfy
  the coverage predicate while being indistinguishable, afterwards, from measured ones.
- The landing criterion is NOT a tree-wide green.
