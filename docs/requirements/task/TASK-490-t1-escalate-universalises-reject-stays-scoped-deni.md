---
id: TASK-490
type: task
role: plan
title: "T1 escalate universalises, reject stays scoped, denial names the questions (AC-ESC-1..8)"
status: archived
priority: medium
phase: "Fix"
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PLAN-092
plan: PLAN-092
---
# T1 — escalate universalises; reject stays scoped; the denial names the questions

## Task Objective
Only the `escalate` VERDICT escapes `judgment_required_types`. `reject`, `NO_JUDGMENT` and `JUDGMENT_PROVENANCE_COLLISION` stay suppressed for ungated types. The escalate denial renders the judgment's `blocking_questions`.

## Spec Reference
`lore get spec-an-escalate-blocks-approval-for-every-doc-type-and-the` — D1-D4 are binding. Governing decision: `lore get adr-an-escalate-gates-every-doc-type-a-reject-stays-scoped-to`.

## Acceptance Criteria
AC-ESC-1 … AC-ESC-8 (this task's declared `ac_scope`). Read them with `lore ac list`; the plan carries an AC→decision map.

## Context Digest — measured, do not re-derive
- `packages/lore/src/service/review-service.ts` — `enforceJudgmentRequiredGate` returns `ok(undefined)` when `!requiredTypes.includes(doc.type)`. That early return is the whole change site.
- `packages/lore/src/service/checkpoint-registry.ts` — `checkReviewJudgment` ALREADY returns distinct `JUDGMENT_ESCALATED_REASON` / `JUDGMENT_REJECTED_REASON`. **Do not modify the predicate**: it is pure, holds no store, and type policy is the service's concern (D2). `feedReviewJudgment` is where the questions render (D4).
- `packages/core/src/config.ts:502` — `judgment_required_types` default `["spec","adr"]`; the `@invariant` block at ~:485 is the key's contract of record and currently claims it governs M2 for ANY type. That prose is IN scope (AC-ESC-8).
- `[]` must short-circuit BEFORE the escalate path (D3). Measured: AC-TIER-7's existing test (`tiered-review.test.ts:598`) only covers empty-list + NO judgment — it will NOT catch an escalate leaking past an empty list, so AC-ESC-3 is the sole guard.
- Retroactive scope is ZERO (measured): only 2 docs carry a current-version escalate/reject, both `adr`, both already `draft`. Judgments match a doc VERSION and approve bumps the version, so this change is forward-only by construction.

## File Anchors
- `packages/lore/src/service/review-service.ts`
- `packages/lore/src/service/checkpoint-registry.ts`
- `packages/core/src/config.ts`
- `packages/lore/tests/unit/service/review-judgment-escalate-scope.test.ts` (new)

⛔ Do NOT commit `packages/lore/src/generated/assets-manifest.ts`.

## Test discipline (binding)
- RED first: AC-ESC-1 and AC-ESC-4 must fail against unmodified code; AC-ESC-2/3/5/7 are regression floors expected green before — say which is which in your report.
- ⛔ Never write to this repo's own `.lore/` corpus. Use in-memory/test-double construction.
- `-t` title filters exit 0 on ZERO match. Copy `describe`/`it` titles literally into the AC commands and assert `Tests N passed` with N > 0.
