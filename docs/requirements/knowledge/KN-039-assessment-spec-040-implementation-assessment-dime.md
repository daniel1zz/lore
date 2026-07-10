---
id: KN-039
type: knowledge
role: knowledge
title: "Assessment: SPEC-040 Implementation — assessment dimension framework v2 (2026-07-10)"
status: draft
priority: medium
created: 2026-07-10
updated: 2026-07-10
tags: []
parent: PLAN-020
links:
  - {id: PLAN-020, type: informs}
---
# Assessment: partially_met (82/100)

Scope: plan `01KX63PQTHNY7VRFYFVM6AYY5G`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-ADF-1 | 84 | Creation-time facts invariant. Core schema shows facts service-computed/optional and never judge-writable; service persistence code is in an omitted file but the test is attested pass. | 01KX63PR7DBKGPY95X2SF2P49H (ai-provider-service-assess-facts.test.ts attested) |
| AC-ADF-2 | 90 | Fully visible in diff: additive optional typed fields + deriveLegacyFindings pure projection + presence-guarded rendering. 18 attested tests; strongest directly-verifiable AC. | 01KX63PR7DBKGPY95X2SF2P49H (assessment-schema-compat.test.ts (18)) |
| AC-ADF-3 | 82 | Single corrective retry then AI_PROVIDER_ERROR, no doc. Service sequence logic in omitted ai-provider-service.ts; verified only via attested 2-test oracle. | 01KX63PR7DBKGPY95X2SF2P49H (ai-provider-service-assess-typed.test.ts) |
| AC-ADF-4 | 84 | Grounding cross-check records rubric_warning for based_on=absence subjects not in unverifiable/truncated; never fatal. computeGroundingWarnings unseen; 7 attested tests cover the branches. | 01KX63PR7DBKGPY95X2SF2P49H (assess-grounding.test.ts (7)) |
| AC-ADF-5 | 85 | planAcScopeSchema (non-empty array/non-empty ids) visible in schemas.ts; cross-entity membership/parent-is-spec check lives in omitted corpus-service. 8 attested tests. | 01KX63PR7DBKGPY95X2SF2P49H (plan-ac-scope.test.ts (8)) |
| AC-ADF-6 | 84 | ASSESS_TEMPLATES registry with v5 provenance and loud-unknown-version. Registry code in omitted assess-template.ts; getAssessTemplate referenced in CLAUDE.md. 7 attested tests. | 01KX63PR7DBKGPY95X2SF2P49H (assess-template-registry.test.ts (7)) |
| AC-ADF-7 | 85 | Dry-run listing with human-outcome labels in deterministic order, zero provider calls. Harness script omitted from diff; owner-recorded evidence [2] shows the expected fixture/label lines. | 01KX63PR7DBKGPY95X2SF2P49H (assess-golden.ts --dry-run, recorder=apple) |
| AC-ADF-8 | 88 | Truncation Notice section + BuildReviewPromptResult.docTruncated (structural, not string-match) fully visible in review-template.ts; review-judgment.truncated optional field visible. 4 attested tests. | 01KX63PR7DBKGPY95X2SF2P49H (review-template-truncation.test.ts (4)) |
| AC-ADF-9 | 45 | Human owner spot-check: 0 pass / 0 fail, no evidence recorded. Deferred to closeout per plan (mitigation noted), so not scored 0, but genuinely unverified at this snapshot. | — |
| AC-ADF-10 | 90 | computeAssessmentFacts spec-less path (scope omitted iff no spec) and pre-truncation full-bundle derivation both visible in diff; 22 attested tests. Directly verifiable. | 01KX63PR7DBKGPY95X2SF2P49H (assessment-facts.test.ts (22)) |
| AC-ADF-11 | 84 | facts.scope.dangling computation visible in core computeAssessmentFacts; prompt annotation + rubric_warning wiring in omitted assess-template/service. 6 attested tests. | 01KX63PR7DBKGPY95X2SF2P49H (plan-ac-scope-staleness.test.ts (6)) |
| AC-ADF-12 | 85 | 3-run majority + non-inferiority pure fn incl. tie-passes and losing-candidate case. assess-golden-aggregation.ts omitted from diff; 19 attested tests. | 01KX63PR7DBKGPY95X2SF2P49H (assess-golden-aggregation.test.ts (19)) |
| AC-ADF-13 | 90 | All three render sites visible in diff (core renderAssessmentContent, CLI assess-render, MCP assess-render), each presence-guarded and legacy-byte-identical. 24 attested snapshot tests. | 01KX63PR7DBKGPY95X2SF2P49H (assess-render-sites.test.ts (24)) |

## Gaps

- Human owner spot-check comparing v5 vs v6 on a real plan is unperformed (0 pass / 0 fail). SPEC-040 delivery is incomplete until it is recorded, though the plan explicitly defers it to closeout.
- T1 and T2 tasks carry 0 attested / 2 self-reported evidence entries each; the full-oracle (typecheck/vitest/bun) claims rest on agent self-report rather than attested verification, unlike the T3 task.
- Six T2/T3 service and script files are omitted from the reviewed diff, so their ACs (1,3,4,5,6,11,12) are confirmable only via attested test outcomes, not source review.

## Recommendations

- Run the AC-ADF-9 owner side-by-side v5/v6 comparison on one real plan and record a pass/fail evidence entry before final closeout.
- Re-record T1/T2 full-oracle results as attested (lore verify) evidence rather than agent self-report.
- Verify the assess DiffMeta classifies added test files so tests_touched reflects reality.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 107393ms
- Retried: false
- Truncated sections: diff:packages/lore/src/ai/CLAUDE.md, diff:packages/lore/src/ai/assess-golden-aggregation.ts, diff:packages/lore/src/ai/assess-template.ts, diff:packages/lore/src/service/CLAUDE.md, diff:packages/lore/src/service/ai-provider-service.ts, diff:packages/lore/src/service/corpus-service.ts, diff:scripts/assess-golden.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 84 | 0.7 | evidence | 12/13 script ACs delivered and attested-pass; one human AC (ADF-9) pending. Directly-visible ACs (2,8,10,13) are especially strong. |
| evidence_integrity | 74 | 0.6 | evidence | attested_evidence_ratio 0.71; script ACs attested, but T1/T2 full-oracle results self-reported by orchestrator, and one interim 19-failure run explained only as a flake. |
| scope_fidelity | 86 | 0.7 | evidence | No ac_scope drift (none declared, zero dangling), additive-only schema/render changes preserve legacy shapes, three-task serial breakdown matches spec D1-D9. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-ADF-9 | Human owner spot-check comparing v5 vs v6 on a real plan is unperformed (0 pass / 0 fail). SPEC-040 delivery is incomplete until it is recorded, though the plan explicitly defers it to closeout. |
| evidence_integrity | minor | — | T1 and T2 tasks carry 0 attested / 2 self-reported evidence entries each; the full-oracle (typecheck/vitest/bun) claims rest on agent self-report rather than attested verification, unlike the T3 task. |
| evidence_integrity | minor | — | Six T2/T3 service and script files are omitted from the reviewed diff, so their ACs (1,3,4,5,6,11,12) are confirmable only via attested test outcomes, not source review. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Run the AC-ADF-9 owner side-by-side v5/v6 comparison on one real plan and record a pass/fail evidence entry before final closeout. | It is the only AC with no evidence and the sole reason the verdict is partially_met rather than met. |
| process | Re-record T1/T2 full-oracle results as attested (lore verify) evidence rather than agent self-report. | Concentrating attestation in one task lowers evidence_integrity and leaves the two upstream tasks' oracle claims unverifiable. |
| plan | Verify the assess DiffMeta classifies added test files so tests_touched reflects reality. | tests_touched=false contradicts the plan's test-file anchors and mutes a regression signal the framework is meant to surface. |

## Unverifiable Materials

- AC-ADF-9 owner spot-check (v5-vs-v6 real-plan comparison): Human AC with 0 recorded evidence; cannot be judged from the provided materials.
- T2 service/script sources: ai-provider-service.ts, corpus-service.ts, assess-template.ts, assess-golden.ts, assess-golden-aggregation.ts: Omitted from the diff for budget; confirmable only through attested test records, not source inspection.

## Facts Summary

- AC coverage: 13 declared criteria
- Task evidence: 3 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.71
