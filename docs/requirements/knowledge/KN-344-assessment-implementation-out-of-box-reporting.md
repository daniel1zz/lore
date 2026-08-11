---
id: KN-344
type: knowledge
role: knowledge
title: "Assessment: Implementation — out-of-box reporting channel (self-provision + SPEC-073 hint unlock) (2026-07-29)"
status: approved
priority: medium
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: PLAN-105
links:
  - {id: PLAN-105, type: informs}
---
# Assessment: met (81/100)

Scope: plan `01KYP8SVY4E1S9CGAM43Q3EQ1H`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-OOB-1 | 88 | 10 pass / 0 fail, 8 attested. Final T6 close run attested pass with output tail showing exit 4, literal --auto-config token, zero 'corpus_path: /path/to' template. Multiple independent recorders (t4, t1, main-orchestrator). | task-t6-close-full-suite-typecheck-code-anchors, task-t4-cli-auto-config-flag-actionable-unconfigured-error |
| AC-OOB-2 | 87 | 8 pass / 0 fail, all attested. Includes a 3-hop symlink boundary case. Earlier expected-fails were correctly diagnosed (T3: flag not yet wired; T4: macOS realpath fixture) and resolved by T8; final close run attested pass. | task-t6-close-full-suite-typecheck-code-anchors, task-t8-fix-macos-realpath-assumption-in-three-provision-suite |
| AC-OOB-3 | 85 | 8 pass / 0 fail, 7 attested. Close-run tail shows exit 4 naming the resolution failure and byte-identical consumer config.yaml, 3 expect() calls. Only 3 assertions is thin for a 'names what could not be resolved' claim. | task-t6-close-full-suite-typecheck-code-anchors, task-t3-core-upstream-resolver-config-writer |
| AC-OOB-4 | 87 | 8 pass / 0 fail, all attested; split into 4a (idempotent byte-identical no-op) and 4b (top-level key preservation), both attested pass at close. T3's in-process suite adds nested-key and malformed-YAML coverage. | task-t6-close-full-suite-typecheck-code-anchors, task-t3-core-upstream-resolver-config-writer |
| AC-OOB-5 | 85 | 8 pass / 0 fail, 7 attested. Close tail: exit 4, no config written when candidate root PRD mismatches; T3's direct suite asserts the wrong slug appears in the error. 4 expect() calls — adequate but not deep. | task-t6-close-full-suite-typecheck-code-anchors, task-t3-core-upstream-resolver-config-writer |
| AC-OOB-6 | 74 | 11 pass / 3 attested fail. Fails are the intended RED runs (T1/T2/T3 pre-T5), and T9 later fixed a real hermeticity defect (LORE_ACTOR advisory) proving the assertion was environment-fragile. Final attested pass; T9's stripped-env oracle is self-reported only. | task-t9-make-the-hint-suite-hermetic-actor-advisory-pollutes, task-t5-unlock-the-spec-073-hint-s-unconfigured-branch |
| AC-OOB-7 | 86 | 7 pass / 0 fail, all attested. Tails show tsc --noEmit across core, lore, lore-tests, scripts, dashboard projects, exit 0. | task-t6-close-full-suite-typecheck-code-anchors |
| AC-OOB-8 | 78 | 1 attested pass: vitest 387 files / 6624 pass + 4 skipped, bun 1524 pass / 0 fail at clean tree 99d5dea, with a count reconciliation (1494+30). Single run; clean-tree claim is self-asserted (no diff to corroborate). | task-t6-close-full-suite-typecheck-code-anchors |

## Gaps

- No diff provided. Plan invariants — (1) resolveFeedbackUpstreamCfg remains the sole feedback.upstream read site, (2) FeedbackConfigSchema untouched, (3) SPEC-073 configured-branch wording byte-frozen — are each specified as 'verified by diff', and that verification is impossible from these materials. AC-OOB-6's configured-direction assertion partially covers (3) only.
- T4 evidence entries [1], [2], [3] record commands literally 'x', 'x3', 'x4' with result=pass, recorded by agent:session-495922ce and agent:t4-cli-autoconfig. These are non-reproducible placeholders occupying pass slots in the trail; they cannot be re-run or audited.
- AC-OOB-6 accumulated 3 attested failures and required two corrective tasks (T7 retargeting two superseded SPEC-073 sub-cases; T9 pinning LORE_ACTOR to stop the SPEC-035 advisory polluting nonEmptyLineCount). The final state is green, but the oracle demonstrated environment-dependence, and T9 reports a same latent gap left unfixed in the sibling provision suite.
- AC-OOB-8 rests on a single 'bun run test' record whose clean-tree-at-99d5dea claim is narrated in the output_tail rather than mechanically attested; regression signals report diff_available=false and tests_touched=false.

## Recommendations

- Require the diff in the audit bundle whenever a plan states invariants 'verified by diff'; otherwise downgrade those invariants to unverified in the closing report rather than treating them as satisfied.
- Validate the command field on evidence records: reject or flag entries whose command is not a plausible shell invocation (e.g. matches ^\w{1,3}$) before they count toward AC coverage.
- For any AC asserting exact stderr line counts or byte-identical stderr, require the oracle command to run under the DEFAULT_VERIFY_ENV_ALLOWLIST-stripped environment and attest that variant, not the ambient-env one.
- Close out the sibling fragility T9 was asked to sweep for: pin LORE_ACTOR in report-issue-provision.bun.test.ts's runLore helper too, and record it under its own task anchor.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 63733ms
- Retried: false
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 86 | 0.72 | evidence | All 8 ACs carry attested passes at the close run; full two-runner suite green at a named commit. Deductions for AC-OOB-6's late repairs and thin assertion counts on AC-OOB-3/5. |
| evidence_integrity | 68 | 0.75 | evidence | Real red-then-green sequencing and multi-recorder attestation, but three placeholder-command 'x' passes in T4, 0.63 attested ratio, and the key T9 hermeticity oracle is self-reported. |
| scope_fidelity | 72 | low | absence | Task anchors were respected per narrative (T3 declined to edit T4's file), and T7's supersession was pre-declared. But no diff means invariants 1–3 cannot be confirmed. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| scope_fidelity | major | — | No diff provided. Plan invariants — (1) resolveFeedbackUpstreamCfg remains the sole feedback.upstream read site, (2) FeedbackConfigSchema untouched, (3) SPEC-073 configured-branch wording byte-frozen — are each specified as 'verified by diff', and that verification is impossible from these materials. AC-OOB-6's configured-direction assertion partially covers (3) only. |
| evidence_integrity | major | — | T4 evidence entries [1], [2], [3] record commands literally 'x', 'x3', 'x4' with result=pass, recorded by agent:session-495922ce and agent:t4-cli-autoconfig. These are non-reproducible placeholders occupying pass slots in the trail; they cannot be re-run or audited. |
| outcome | minor | AC-OOB-6 | AC-OOB-6 accumulated 3 attested failures and required two corrective tasks (T7 retargeting two superseded SPEC-073 sub-cases; T9 pinning LORE_ACTOR to stop the SPEC-035 advisory polluting nonEmptyLineCount). The final state is green, but the oracle demonstrated environment-dependence, and T9 reports a same latent gap left unfixed in the sibling provision suite. |
| evidence_integrity | minor | AC-OOB-8 | AC-OOB-8 rests on a single 'bun run test' record whose clean-tree-at-99d5dea claim is narrated in the output_tail rather than mechanically attested; regression signals report diff_available=false and tests_touched=false. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require the diff in the audit bundle whenever a plan states invariants 'verified by diff'; otherwise downgrade those invariants to unverified in the closing report rather than treating them as satisfied. | Three of four plan invariants here were diff-verified by design and none could be checked. |
| process | Validate the command field on evidence records: reject or flag entries whose command is not a plausible shell invocation (e.g. matches ^\w{1,3}$) before they count toward AC coverage. | T4 logged three 'x'-style passes that inflate the trail without being reproducible. |
| plan | For any AC asserting exact stderr line counts or byte-identical stderr, require the oracle command to run under the DEFAULT_VERIFY_ENV_ALLOWLIST-stripped environment and attest that variant, not the ambient-env one. | T9 showed the ambient-env run passed while the verify-equivalent run failed. |
| plan | Close out the sibling fragility T9 was asked to sweep for: pin LORE_ACTOR in report-issue-provision.bun.test.ts's runLore helper too, and record it under its own task anchor. | T9 reported the same latent gap at ~line 149 but was scoped out of fixing it. |

## Unverifiable Materials

- Implementation diff (packages/lore, packages/core): Bundle states 'no diff provided'; invariants 1–3 and the claim that no second config.feedback read path exists cannot be checked.
- packages/core/src/config.ts FeedbackConfigSchema: Invariant 2 requires diff confirmation that the schema is unchanged; no file contents or diff available.
- Code-anchor declarations (lore anchor add) claimed in T6: No evidence record covers the anchor-declaration step described in the task body.
- T9's stripped-env AC-OOB-6 run: Recorded by the implementing agent only; no independent attestation of the env -i variant that lore verify actually executes.

## Rubric Warnings

- Dimension "scope_fidelity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 8 declared criteria
- Task evidence: 9 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.63
