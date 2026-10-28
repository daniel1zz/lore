---
id: PLAN-265
type: plan
role: plan
title: "Plan: evidence check only on finished tasks (#408)"
status: deprecated
priority: high
created: 2026-10-26
updated: 2026-10-26
tags: [governance-mechanism-fixes, issue-408]
parent: SPEC-246
phases:
  - {name: "P1 Red", description: "Failing unit and integration tests for AC-EC-1..2"}
  - {name: "P2 Fix and close", description: "Status rule in checkEvidenceCompleteness; verify; rule apply"}
---
# Plan — evidence check only on finished tasks (#408)

Implements `spec-the-evidence-check-of-a-task-review-applies-only-to-a` (AC-EC-1..2). Rule: BR-261 (modified). Issue: #408 (carried by this plan). Batched S2 draft.

## Ordering

Third of seven, after #356 and #418 (its implementers' writes need #418's identity). It is independent of the other plans.

## Overview

`checkEvidenceCompleteness` applies only to archived tasks; on every other status it is skipped, naming the status. A draft task review then reaches the AI judge.

## Invariants

| # | Invariant | Checked by |
|---|---|---|
| I1 | Five checks, fixed order | AC-EC-1 |
| I2 | No vacuous pass: a status where evidence cannot exist reads skipped, never pass | AC-EC-1 |

## Phases

- **P1 Red** — failing unit and integration tests.
- **P2 Fix and close** — the status rule, then lore verify and lore rule apply.

## Decisions log

D1-D2 in the spec. Calibration rows already stored are not rewritten (#419 / S-B owns calibration).
