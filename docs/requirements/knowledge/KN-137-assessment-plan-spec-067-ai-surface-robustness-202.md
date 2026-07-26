---
id: KN-137
type: knowledge
role: knowledge
title: "Assessment: Plan — SPEC-067 AI-surface robustness (2026-07-23)"
status: approved
priority: medium
created: 2026-07-23
updated: 2026-07-24
tags: []
parent: PLAN-053
links:
  - {id: PLAN-053, type: informs}
  - {id: KN-124, type: supersedes}
---
# Assessment: partially_met (72/100)

Scope: plan `01KY6S0CZZDA8ZTM9FWQR2SYTB`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-067-1 | 92 | Timeout default raised to 180_000 in both AiProviderConfigSchema and BUILT_IN_PROVIDER_CONFIGS (visible in diff, with sync-invariant documented). 3 pass / 0 fail, 2 attested runs with output tails from provider-registry-validation.test.ts. | 01KY6S1QEJP8S8DF847276987S (attested -t AC-067-1 run, 4 passed; diff shows 180_000 in ai.ts + registry.ts) |
| AC-067-2 | 90 | validateMergedProviderEntry returns VALIDATION_ERROR naming `ai.providers.<name>` and echoing a complete pasteable example entry; runs before any provider construction. 3 pass / 0 fail, 2 attested. Test file itself unseen (manifest) — behavior judged from diff + evidence. | 01KY6S1QEJP8S8DF847276987S (attested -t AC-067-2 run, 6 passed; registry.ts validation loop precedes construction) |
| AC-067-3 | 90 | Replace-not-merge semantics preserved via mergeProviderConfigs; a complete override passes validateMergedProviderEntry and its timeout_ms flows into the constructed provider. 3 pass / 0 fail, 2 attested runs. | 01KY6S1QEJP8S8DF847276987S (attested -t AC-067-3 run, 4 passed) |
| AC-067-4 | 90 | applyGroundingConfidenceDowngrade reuses findUngroundedAbsenceDimensions (shared with computeGroundingWarnings — no drifting second heuristic), stamps confidence:"low" sentinel + confidence_reason; schema widened backward-compatibly. 3 pass / 0 fail, 2 attested. | 01KY6S1V0D3HGA47XP48KYXD8H (attested -t AC-067-4 run, 4 passed; core schema widening tested in assessment.test.ts) |
| AC-067-5 | 90 | computeTaskTruncationRatio (task:-prefix counting, 0-task guard) + strict >0.25 cap and >=1 inconclusive path in _finalizeAssessment; overall_score genuinely omitted (destructure, not undefined-spread) under exactOptionalPropertyTypes. 3 pass / 0 fail, 2 attested. | 01KY6S1V0D3HGA47XP48KYXD8H (attested -t AC-067-5 run; thresholds centralized in TRUNCATION_DOWNGRADE_THRESHOLDS) |
| AC-067-6 | 88 | Healthy path returns the same dimension_scores reference when nothing is ungrounded, and below-threshold runs add no judgment fields. 3 pass / 0 fail, 2 attested. Byte-unchanged claim rests on the unseen downgrade test file; the diff's reference-identity invariant supports it. | 01KY6S1V0D3HGA47XP48KYXD8H (attested -t AC-067-6 run, 4 passed) |

## Gaps

- The diff bundles a complete, undeclared revert of SPEC-065: deletes create-task-validation.ts and pending-render.ts, removes findByIdPrefix from store-interface.ts / sqlite-store.ts / turso-store.ts / in-memory-store.ts, strips prefix resolution from resolve.ts, drops PendingDoc.slug from review-service.ts, and removes the matching CLAUDE.md entries. The plan's declared phases (provider, judge) cover none of this; no ADR or plan note explains it.
- If the SPEC-065 revert ships as-is, previously-fixed dogfood bugs P0-2 (lore pending prints a 10-char ID that resolveDoc cannot accept) and P1-5 (task-create missing-flag discovery takes two round trips, no --parent inference) regress — features the deleted modules' own headers document as bug fixes.
- assessment.test.ts's NEGATIVE case ('llmAssessmentOutputSchema itself still requires overall_score and rejects inconclusive') actually safeParses assessmentResultSchema with an invalid verdict string — it never touches llmAssessmentOutputSchema, so the judge-facing schema's narrowness is asserted only by comment, not by test.
- Both tasks are status=draft despite complete attested evidence — lifecycle state lags the evidence trail.

## Recommendations

- Split the SPEC-065 revert out of this change: either restore the deleted prefix-resolution / pending-slug / task-create-validation code before merging, or land the revert as its own documented change with an explicit rationale linked from the plan.
- Add a diff-scope check to the verify flow that flags deleted files or removed exported symbols not anchored to any task in the active plan.
- Rename/rewrite the mislabeled negative test to parse llmAssessmentOutputSchema directly, proving the judge-facing shape still requires overall_score and rejects 'inconclusive'.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 69139ms
- Retried: false
- Truncated sections: diff:CLAUDE.md, diff:assets/hooks/pre-bash-git-safety-gate.mjs, diff:packages/lore/tests/unit/ai/provider-registry-validation.test.ts, diff:packages/lore/tests/unit/cli/create-task-validation.test.ts, diff:packages/lore/tests/unit/cli/pending-output.test.ts, diff:packages/lore/tests/unit/core/config.test.ts, diff:packages/lore/tests/unit/hooks/git-safety-gate.test.ts, diff:packages/lore/tests/unit/service/assessment-finalize-downgrade.test.ts, diff:packages/lore/tests/unit/service/outline-service.test.ts, diff:packages/lore/tests/unit/service/resolve-prefix.test.ts, diff:packages/lore/tests/unit/store/in-memory-store.test.ts, diff:packages/lore/tests/unit/store/sqlite-store.bun.test.ts, diff:packages/lore/tests/unit/store/turso-store.bun.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 88 | 0.8 | evidence | All six ACs green (2 attested runs each, output tails shown); D1-D4 implementations visible in diff and match AC statements. Deducted for the mislabeled judge-schema negative test. |
| evidence_integrity | 82 | 0.75 | evidence | Per-AC attested runs with output tails, plus full-file runs, tsc, and adjacent-suite regression runs (ai.test.ts, assessment.test.ts). Attested ratio 0.57; test file bodies unseen per manifest. |
| scope_fidelity | 35 | 0.85 | evidence | Diff directly shows a full SPEC-065 revert (resolve.ts, 3 stores, pending/create CLI, PendingDoc.slug, CLAUDE.md docs) nowhere declared in the SPEC-067 plan — large unexplained drift. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| scope_fidelity | major | — | The diff bundles a complete, undeclared revert of SPEC-065: deletes create-task-validation.ts and pending-render.ts, removes findByIdPrefix from store-interface.ts / sqlite-store.ts / turso-store.ts / in-memory-store.ts, strips prefix resolution from resolve.ts, drops PendingDoc.slug from review-service.ts, and removes the matching CLAUDE.md entries. The plan's declared phases (provider, judge) cover none of this; no ADR or plan note explains it. |
| outcome | major | — | If the SPEC-065 revert ships as-is, previously-fixed dogfood bugs P0-2 (lore pending prints a 10-char ID that resolveDoc cannot accept) and P1-5 (task-create missing-flag discovery takes two round trips, no --parent inference) regress — features the deleted modules' own headers document as bug fixes. |
| evidence_integrity | minor | AC-067-5 | assessment.test.ts's NEGATIVE case ('llmAssessmentOutputSchema itself still requires overall_score and rejects inconclusive') actually safeParses assessmentResultSchema with an invalid verdict string — it never touches llmAssessmentOutputSchema, so the judge-facing schema's narrowness is asserted only by comment, not by test. |
| evidence_integrity | minor | — | Both tasks are status=draft despite complete attested evidence — lifecycle state lags the evidence trail. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Split the SPEC-065 revert out of this change: either restore the deleted prefix-resolution / pending-slug / task-create-validation code before merging, or land the revert as its own documented change with an explicit rationale linked from the plan. | An audit of SPEC-067 cannot sanction silently removing another spec's shipped, bug-fixing functionality; bundling it hides a functional regression behind green SPEC-067 ACs. |
| process | Add a diff-scope check to the verify flow that flags deleted files or removed exported symbols not anchored to any task in the active plan. | This drift was mechanically detectable (deleted modules cite SPEC-065, not SPEC-067) yet passed every AC gate because ACs only test additions. |
| plan | Rename/rewrite the mislabeled negative test to parse llmAssessmentOutputSchema directly, proving the judge-facing shape still requires overall_score and rejects 'inconclusive'. | The D4 widening's safety argument rests on the judge never being validated against the widened shape; that invariant currently has no direct test. |

## Unverifiable Materials

- packages/lore/tests/unit/ai/provider-registry-validation.test.ts and packages/lore/tests/unit/service/assessment-finalize-downgrade.test.ts contents: Omitted per truncation manifest — assertion quality judged only from evidence records and the diff, not the test bodies.
- Intent behind the SPEC-065 removals (sanctioned revert vs. stale-branch/rebase artifact): No plan note, ADR, or commit context in the materials explains the removals; scored as unexplained drift per conservative-scoring instruction.
- resolve-prefix.test.ts, create-task-validation.test.ts, pending-output.test.ts, store test changes: Listed as changed but omitted — cannot confirm whether SPEC-065 tests were deleted or adapted.

## Facts Summary

- AC coverage: 6 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.57
