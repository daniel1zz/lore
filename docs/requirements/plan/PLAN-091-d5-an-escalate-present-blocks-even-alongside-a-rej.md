---
id: PLAN-091
type: plan
role: plan
title: "D5: an escalate present blocks even alongside a reject"
status: archived
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: SPEC-121
phases:
  - {name: "Fix"}
---
# Plan — D5: an escalate present blocks even alongside a reject

## Goal
Close the boundary the first implementation pinned as a passing test: on an ungated type carrying BOTH a `reject` and an `escalate` on the same version, worst-decision-wins yields `reject`, the service suppresses it, and the doc APPROVES — losing the escalate. Implement D5 of `spec-an-escalate-blocks-approval-for-every-doc-type-and-the`.

## Oracle
`lore verify` over AC-ESC-9, plus AC-ESC-1 … AC-ESC-8 as an unchanged regression floor.

## Phases
Single phase (`Fix`) — one task, one condition in `enforceJudgmentRequiredGate` plus the inversion of one existing test.

## Risks
- **The existing BOUNDARY test asserts the DEFECT.** It must be inverted, not deleted — deleting it would leave the corrected semantics unpinned, and the suite would go green with no coverage of the pair at all.
- **Over-reaching into the gated path.** Worst-decision-wins is CORRECT for gated types (a reject must never be outrolled by a later approve). Only the ungated branch changes. AC-ESC-9's first control pins this.
- **Breaking D3.** The `[]` kill switch must still short-circuit ahead of everything, including the new check. AC-ESC-9's second control pins this.
- **Touching the predicate.** D2 stands: `checkReviewJudgment` remains the single decision authority; the ungated branch reads `independentDecisions` the service already computed.
