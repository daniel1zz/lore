---
id: SPEC-246
type: spec
role: spec
title: "The evidence check of a task review applies only to a finished task (resolves #408)"
status: deprecated
priority: high
created: 2026-10-26
updated: 2026-10-26
tags: [governance-mechanism-fixes, issue-408]
links:
  - {id: SPEC-247, type: relates-to}
---
# The evidence check of a task review applies only to a finished task (resolves #408)

## Overview/Goal

The `evidence_completeness` pre-check of `lore review` stops rejecting tasks that cannot hold evidence yet.

Today `checkEvidenceCompleteness` (packages/core/src/review-checks.ts:243-256) fails every task without a `verification_evidence` entry, whatever its status. Tasks are reviewed while draft, before they are claimed, so no evidence can exist by design.

Measured 2026-10-25, recorded on #408: all 62 overridden task "reject" judgments carry `judge_provider = 'deterministic-checks'` and this one failure. Each `lore approve` that followed was then counted as an override, although nobody overrode a judgment.

**Mechanism.** A completion check (execution evidence) is applied at a pre-execution state. It therefore always fails, and its verdict is always "overridden".

**End state.** The check applies only where evidence must exist: a task in `archived` (the state `lore done` reaches only with runner-attested evidence, BR-199). On every other status it is `skipped`, with a detail naming the status. The deterministic reject on draft tasks disappears at its source.

Issue: GitHub #408 (bound through this spec's plan). Not covered here: counting deterministic verdicts as AI-judge outcomes in calibration (#419). That is handled by the approved evaluation spec S-B (BR-1422) and is not duplicated.

## Scope

**In:** `checkEvidenceCompleteness` and its status rule; BR-261 wording; a review of a draft task going to the AI judge when the other four checks pass.

**Out:** the other four checks; calibration pairing (S-B); existing stored judgments and calibration rows (records stay as written).

## Design

| Task status | Outcome | Detail |
|---|---|---|
| draft, in_review, approved, active | `skipped` | `task is <status>; evidence is required when it is done (BR-199), not before` |
| deprecated | `skipped` | `task is deprecated; it was never done` |
| archived, with ≥1 evidence entry | `pass` | |
| archived, with none (legacy tasks archived before attestation) | `fail` | `archived task has no verification_evidence entries` (unchanged text) |

The check list keeps its five entries in the fixed order (schema, parent_contract, tree_position, link_integrity, evidence_completeness).

Public interface (the falsifier mutates this literal; it appears verbatim, once): `checkEvidenceCompleteness` contains `if (doc.status !== "archived") return { check: "evidence_completeness", outcome: "skipped"`.

## Design Decisions

Decided with Sequential Thinking (2026-10-26).

| # | Choice | Chosen | Rejected (why) |
|---|---|---|---|
| D1 | Statuses where the check applies | `archived` only | Skip only `draft`: an approved or active task reviewed mid-work still has no evidence, so the same false reject moves one state later. Delete the check: archived legacy tasks with no evidence would no longer be found, and the five-check contract changes |
| D2 | Outcome elsewhere | `skipped` with the status named | `pass`: would claim evidence was checked and found, a vacuous truth the corpus must not print |

## Acceptance Criteria

Stored with `lore ac add`; repeated here for readers of the body.

- **AC-EC-1** (BR-261): `runDeterministicChecks` returns exactly five checks in the fixed order. For a task in draft, in_review, approved, active and deprecated with no evidence, `evidence_completeness` is `skipped` and its detail names the status. Archived with no evidence gives `fail`; archived with one entry gives `pass`. Simplest false green: skipping only draft; the approved and active cases are asserted. Test: `packages/lore/tests/unit/core/review-checks-evidence-lifecycle.test.ts`.
- **AC-EC-2** (BR-262): wiring through `ReviewService` with the in-memory AI provider. Reviewing a well-formed draft task records a judgment whose `judge_provider` is the AI provider, not `deterministic-checks`, and the provider received exactly one call. Simplest false green: the unit passes while the service builds the check input from a different status field; the service path is exercised. Test: `packages/lore/tests/integration/review-draft-task-reaches-the-judge.test.ts`.


## Acceptance Criteria (structured)

- [·] [script] AC-EC-1: runDeterministicChecks returns exactly five checks in the fixed order; for a task in draft, in_review, approved, active and deprecated with no evidence, evidence_completeness is skipped and its detail names the status; archived with no evidence is fail; archived with one entry is pass. False green guarded: skipping only draft passes a draft-only test; approved and active are asserted.
  script: test — bun run test:file packages/lore/tests/unit/core/review-checks-evidence-lifecycle.test.ts && echo 'AC-EC-1 PASS: the evidence check applies to archived tasks only'
- [·] [script] AC-EC-2: Through ReviewService with the in-memory AI provider, reviewing a well-formed draft task records a judgment whose judge_provider is the AI provider, not deterministic-checks, and the provider received exactly one call. False green guarded: the unit test passes while the service feeds the check a different status; the service path is exercised end to end.
  script: test — bun run test:file packages/lore/tests/integration/review-draft-task-reaches-the-judge.test.ts && echo 'AC-EC-2 PASS: a draft task review reaches the AI judge'
