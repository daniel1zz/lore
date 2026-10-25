---
id: KN-323
type: knowledge
role: knowledge
title: "Assessment: Implementation — plan-close predicates measure invariants (applicability type, per-claimed-AC coverage, attributable sync) (2026-07-30)"
status: archived
priority: medium
created: 2026-07-30
updated: 2026-10-23
tags: []
parent: PLAN-102
links:
  - {id: PLAN-102, type: informs}
---
# Assessment: met (86/100)

Scope: plan `01KYS1FSHTF9X1G396894Y4QNX`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-PCI-1 | 90 | Pinned filtered vitest run passes twice (T1 self-reported after a recorded RED, plus an attested orchestrator rerun on the final tree at 8227dd1). Filter matched 7 tests. | task-t1-applicability-verdict-in-the-predicate-s-own-type-both (expected-fail then pass), task-t5-compiled-binary-e2e-from-a-throwaway-corpus-clean-close (attested rerun [2]) |
| AC-PCI-2 | 86 | Passes on final tree (6 matched tests, attested). Caveat: this AC was measurably RED after the T3/T4 merge (T8 records 6 failures incl. its own tests); repaired and re-evidenced, so the pass is current but was once stale. | task-t8-repair-the-t3-t4-integration-regression-6-under (regression + repair), task-t5-compiled-binary-e2e-from-a-throwaway-corpus-clean-close (attested rerun [3]) |
| AC-PCI-3 | 86 | Final-tree filtered run passes (6 matched, attested); tail shows the throwing-audit-writer path emitting its non-blocking warning, matching the statement. Same stale-pass caveat as AC-PCI-2 (RED at 5fcb07f, repaired in T8). | task-t8-repair-the-t3-t4-integration-regression-6-under, task-t5-compiled-binary-e2e-from-a-throwaway-corpus-clean-close (attested rerun [4]) |
| AC-PCI-4 | 90 | Dedicated promote-advisory file passes 6/6 unfiltered on the final tree (attested), preceded by a recorded RED in T1. Distinct-key requirement is asserted only inside the test file, which is not visible here. | task-t1-applicability-verdict-in-the-predicate-s-own-type-both, task-t5-compiled-binary-e2e-from-a-throwaway-corpus-clean-close (attested rerun [5]) |
| AC-PCI-5 | 88 | Pinned 'claimed set' filter passes with 5 matched tests on the final tree (attested), plus T2's own pass. Multi-clause statement (ai/human exclusion, dangling ac_ref) plausibly covered by 5 tests but unverifiable without the diff. | task-t2-per-claimed-ac-attested-coverage-as-the-default, task-t5-compiled-binary-e2e-from-a-throwaway-corpus-clean-close (attested rerun [6]) |
| AC-PCI-6 | 82 | Passes attested, but the 'coverage conjunct' filter matched exactly 1 test (1 passed \| 28 skipped) for a statement with several conjuncts (meets_floor false, ratio met, unattested_acs exact). Single-test coverage is thin and unreviewable without source. | task-t5-compiled-binary-e2e-from-a-throwaway-corpus-clean-close (attested rerun [7]) |
| AC-PCI-7 | 82 | 'ratio disabled' filter passes attested but matched 1 test only, while the statement demands both resolveAttestationMinRatio null and a real gate archive transition with no exemption field. Cannot confirm both halves from the tail. | task-t5-compiled-binary-e2e-from-a-throwaway-corpus-clean-close (attested rerun [8]) |
| AC-PCI-8 | 82 | 'explicit ratio' filter passes attested with 1 matched test covering min_ratio 0.5 deny and explicit 0 permit through CorpusService.set. Plausible in one test body, but not independently verifiable here. | task-t5-compiled-binary-e2e-from-a-throwaway-corpus-clean-close (attested rerun [9]) |
| AC-PCI-10 | 90 | 'attribution' filter matches 8 tests, passing on the final tree (attested) after a recorded RED in T3 — covers the four required scenarios by count and the negative structural-relation case is task-mandated. | task-t3-domain-doc-sync-requires-attribution-to-the-closing-plan (expected-fail then pass), task-t5-compiled-binary-e2e-from-a-throwaway-corpus-clean-close (attested rerun [10]) |
| AC-PCI-11 | 90 | 'contract table' filter passes with 6 matched tests (attested), preceded by a recorded RED and a supplementary 'caller-contract violation' pass. Compile-time exhaustiveness claim rests on typecheck pass, not directly shown. | task-t4-plan-close-predicate-contract-table-lore-gate-explain, task-t5-compiled-binary-e2e-from-a-throwaway-corpus-clean-close (attested rerun [11]) |
| AC-PCI-12 | 88 | Compiled-binary e2e passes twice (task-recorded and attested rerun); tail names scenario A archiving at exit 0 with the advisory 'genuinely printed'. Scenario B/control assertions truncated in the tail; freshness of dist/lore not shown. | task-t5-compiled-binary-e2e-from-a-throwaway-corpus-clean-close ([1] and attested [12]) |
| AC-PCI-9 | 88 | Both files run together and pass attested; the byte-pinned reachability file is skipped by the -t filter rather than exercised in this run, but T2's own evidence and the full vitest suite (401 files pass) cover it. | task-t2-per-claimed-ac-attested-coverage-as-the-default, task-t5-compiled-binary-e2e-from-a-throwaway-corpus-clean-close (attested rerun [13]) |
| AC-PCI-13 | 84 | 'ratio disabled render' filter passes attested with 1 matched test; the equality-with-deriveClaimedAcCoverage claim is the substantive half and cannot be inspected without the diff. | task-t5-compiled-binary-e2e-from-a-throwaway-corpus-clean-close (attested rerun [14]) |
| AC-PCI-14 | 88 | Dashboard component test passes attested with 2 matched tests, consistent with the null and numeric-floor cases plus the no-'0%'/'50%' negative. | task-t5-compiled-binary-e2e-from-a-throwaway-corpus-clean-close (attested rerun [15]) |
| AC-PCI-15 | 82 | Pinned grep -q recorded pass but its output_tail contains only EPIPE errors, so the tail alone does not show the match; a supplementary grep -c run reports matches=1, exit 0. T6 also records the same grep. Mitigated, not clean. | task-t6-upstream-adr-revision-clause-decision-status-accepted, task-t5-compiled-binary-e2e-from-a-throwaway-corpus-clean-close (attested [16] + supplementary [21]) |
| AC-PCI-16 | 90 | RED-then-GREEN in T7 plus an attested rerun; tail names the stderr-not-stdout exit-0 case and the distinct-loop regression test explicitly. | task-t7-lore-approve-renders-the-prd-sync-advisory-to-stderr, task-t5-compiled-binary-e2e-from-a-throwaway-corpus-clean-close (attested rerun [17]) |

## Gaps

- AC-PCI-2 and AC-PCI-3 held pass evidence while their own tests were failing (6 failed / 13 passed at 5fcb07f, per T8). Fresh evidence was later recorded, but the trail shows attested passes can go stale across a merge with no mechanism forcing re-measurement — the same silent-signal defect class this spec exists to close.
- bun run test:bun is recorded as result=fail (1600 pass / 1 fail, issue-report-cross-corpus AC-072-9). Attribution to a pre-existing ~10%/run flake is measured on both baseline 17c1a44 and merged 8227dd1, which is sound, but the plan's exit criterion 'both test runners green on the full suite' is not literally satisfied.
- The 'ratio disabled' filter matched a single test (1 passed | 14 skipped) for a statement requiring both resolveAttestationMinRatio returning null and a 0.36-ratio plan transitioning to archived through the real gate with no exemption field. Same pattern for AC-PCI-6, AC-PCI-8, AC-PCI-13.
- The plan's stated real-world test of the fix — plan-implementation-context-provenance-scope-declaring closing under the new predicates without an exemption — has no recorded evidence entry, so the fix is unproven against the case that motivated it.
- The pinned oracle's output_tail is entirely EPIPE errors because grep -q closes the pipe early; the positive match is carried by a supplementary grep -c entry. The AC's own oracle record therefore does not self-evidence its pass.

## Recommendations

- After every inter-phase merge, re-run the pinned AC command for each already-evidenced AC before declaring the phase merged, and record the reruns. T8 shows a merge silently reddened two attested ACs.
- Require pinned -t filters to match at least one test per conjunct in the AC statement, so the matched-test count in the output tail is itself evidence of coverage breadth.
- Add explicit oracles for the two prose-only exit criteria: no *_exempt field on this plan, and the provenance plan closing unexempted under the new predicates.
- Ban grep -q as a recorded oracle shape; use grep -c or grep piped to a full reader so the captured output_tail contains the match rather than EPIPE.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 87111ms
- Retried: false
- Truncated sections: task:task-t8-repair-the-t3-t4-integration-regression-6-under, task:task-t4-plan-close-predicate-contract-table-lore-gate-explain, task:task-t3-domain-doc-sync-requires-attribution-to-the-closing-plan, task:task-t2-per-claimed-ac-attested-coverage-as-the-default, task:task-t1-applicability-verdict-in-the-predicate-s-own-type-both
- Overall confidence: low (degraded by truncation)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 88 | 0.72 | evidence | All 16 script-mode ACs pass on the final tree at 8227dd1, each with one attested rerun; several ACs preceded by recorded RED runs. Depth thin on 4 single-test ACs. |
| evidence_integrity | 78 | 0.7 | evidence | Strong: RED-first, measured flake attribution, EPIPE mitigation, whole-suite runs. Weak: 0.27 attested ratio, a stale-pass episode on AC-PCI-2/3, test:bun not green. |
| scope_fidelity | 84 | low | absence | Task docs track the planned anchors and T8 is a documented in-scope repair, but with no diff I cannot confirm edits stayed inside declared file anchors. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | — | AC-PCI-2 and AC-PCI-3 held pass evidence while their own tests were failing (6 failed / 13 passed at 5fcb07f, per T8). Fresh evidence was later recorded, but the trail shows attested passes can go stale across a merge with no mechanism forcing re-measurement — the same silent-signal defect class this spec exists to close. |
| evidence_integrity | minor | — | bun run test:bun is recorded as result=fail (1600 pass / 1 fail, issue-report-cross-corpus AC-072-9). Attribution to a pre-existing ~10%/run flake is measured on both baseline 17c1a44 and merged 8227dd1, which is sound, but the plan's exit criterion 'both test runners green on the full suite' is not literally satisfied. |
| outcome | minor | AC-PCI-7 | The 'ratio disabled' filter matched a single test (1 passed \| 14 skipped) for a statement requiring both resolveAttestationMinRatio returning null and a 0.36-ratio plan transitioning to archived through the real gate with no exemption field. Same pattern for AC-PCI-6, AC-PCI-8, AC-PCI-13. |
| outcome | minor | — | The plan's stated real-world test of the fix — plan-implementation-context-provenance-scope-declaring closing under the new predicates without an exemption — has no recorded evidence entry, so the fix is unproven against the case that motivated it. |
| evidence_integrity | minor | AC-PCI-15 | The pinned oracle's output_tail is entirely EPIPE errors because grep -q closes the pipe early; the positive match is carried by a supplementary grep -c entry. The AC's own oracle record therefore does not self-evidence its pass. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | After every inter-phase merge, re-run the pinned AC command for each already-evidenced AC before declaring the phase merged, and record the reruns. T8 shows a merge silently reddened two attested ACs. | Attested passes went stale across the T3+T4 merge and were only caught by a follow-up repair task. |
| spec | Require pinned -t filters to match at least one test per conjunct in the AC statement, so the matched-test count in the output tail is itself evidence of coverage breadth. | Four ACs pass on a single matched test for statements with three or more clauses. |
| plan | Add explicit oracles for the two prose-only exit criteria: no *_exempt field on this plan, and the provenance plan closing unexempted under the new predicates. | Both are stated as closing conditions but carry no evidence record. |
| process | Ban grep -q as a recorded oracle shape; use grep -c or grep piped to a full reader so the captured output_tail contains the match rather than EPIPE. | AC-PCI-15's tail shows only broken-pipe errors, requiring a second command to interpret the pass. |

## Unverifiable Materials

- Implementation diff (no diff provided): Cannot confirm PredicateNotApplicable omits `ok`, that no `?? []` fallback was restored, that contract entries were seeded from JSDoc rather than invented, or that edits stayed within declared file a…
- Test file bodies for the pinned -t filters: Only pass/skip counts and truncated tails are visible, so assertion strength per AC clause cannot be checked.
- Freshness of dist/lore for the AC-PCI-12 compiled e2e: No recorded `bun run build` oracle accompanies the compiled-binary run, so stale-bytes risk named in the task cannot be ruled out.
- Absence of exemption fields on the plan: No oracle inspects the plan document for attestation_exempt / prd_sync_exempt / assessment_freshness_exempt.

## Rubric Warnings

- Dimension "scope_fidelity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 16 declared criteria
- Task evidence: 8 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.27
