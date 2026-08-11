---
id: TASK-487
type: task
role: plan
title: "T1 escalate present blocks even alongside a reject (D5, AC-ESC-9)"
status: archived
priority: medium
phase: "Fix"
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PLAN-091
plan: PLAN-091
---
# T1 — an escalate present blocks even alongside a reject (D5, AC-ESC-9)

## Task Objective
On an ungated type, block when ANY independent current-version decision is an `escalate` — not only when the worst-decision denial happens to be `JUDGMENT_ESCALATED`.

## Spec Reference
`lore get spec-an-escalate-blocks-approval-for-every-doc-type-and-the` — **D5 is the governing decision**; D1-D4 are already shipped and must not regress.

## Acceptance Criteria
AC-ESC-9 (this task's `ac_scope`). AC-ESC-1 … AC-ESC-8 are an unchanged regression floor.

## Context Digest — measured, do not re-derive
- Today's behaviour, pinned by a PASSING test that asserts the defect:
  `packages/lore/tests/unit/service/review-judgment-escalate-scope.test.ts:213` —
  `it("BOUNDARY: reject alongside escalate on an ungated type resolves to the suppressed reject and approves", ...)`.
  **Invert that test; do not delete it.** Deleting leaves the corrected semantics unpinned.
- `worstReviewDecision` ranks `reject`(2) > `escalate`(1) > `approve`(0), so the pair yields
  `JUDGMENT_REJECTED`, which the ungated branch suppresses → approve.
- `enforceJudgmentRequiredGate` (`packages/lore/src/service/review-service.ts`) already
  computes `independentDecisions: ReviewDecision[]` BEFORE building the `GateContext`. The
  ungated branch can ask `independentDecisions.includes("escalate")` directly — no predicate
  change needed.
- The escalate denial rendering (`renderBlockingQuestions`, `isJudgmentEscalatedDenial` in
  `checkpoint-registry.ts`) already exists from D4. When the pair now blocks, the denial must
  still carry the escalating judgment's `blocking_questions`.

## Hard constraints
- ⛔ Do NOT modify `checkReviewJudgment`, `worstReviewDecision`, or `REVIEW_DECISION_RANK`. D2 stands: the predicate is the single decision authority, and worst-decision-wins is CORRECT for the gated path.
- ⛔ Gated types unchanged: a spec/adr with reject+escalate still blocks ON THE REJECT. That is the anti-lottery rule and it must not become "blocks on escalate".
- ⛔ `judgment_required_types: []` still short-circuits FIRST — the pair approves under an empty list (D3).
- ⛔ Never write to this repo's own `.lore/` corpus. The existing suite uses `InMemoryStore`; keep it that way.
- ⛔ Do NOT commit `packages/lore/src/generated/assets-manifest.ts`.
- ⛔ `-t` filters exit 0 on ZERO match. Copy `describe`/`it` titles literally; assert `Tests N passed` with N > 0.

## File Anchors
- `packages/lore/src/service/review-service.ts`
- `packages/lore/tests/unit/service/review-judgment-escalate-scope.test.ts`

## Test discipline
RED first: with the test inverted and the code unchanged, AC-ESC-9 must fail. Capture that. Then implement and show green. Both controls (gated pair still blocks on reject; empty-list pair still approves) must be green before AND after — say so explicitly.
