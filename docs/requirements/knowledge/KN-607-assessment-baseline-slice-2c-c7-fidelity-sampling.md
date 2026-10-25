---
id: KN-607
type: knowledge
role: knowledge
title: "Assessment: Baseline slice 2c: C7 fidelity sampling command and BL-15 resume rule diff (2026-10-10)"
status: archived
priority: medium
created: 2026-10-10
updated: 2026-10-23
tags: []
parent: PLAN-168
links:
  - {id: PLAN-168, type: informs}
---
# Assessment: partially_met (56/100)

Scope: plan `01M4HW022CV6X0BR3ZA0P9Q9JF`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-BLS2-1 | 20 | Prior-slice criterion. This plan has no evidence for it and the diff does not touch the AC write chokepoint. Mitigation: it is outside the 2c tasks. | — |
| AC-BLS2-2 | 20 | Prior-slice citation-gate criterion. This plan has no evidence for it and the diff does not touch it. Mitigation: it is outside the 2c tasks. | — |
| AC-BLS2-3 | 20 | Prior-slice race criterion. This plan has no evidence for it and does not touch it. | — |
| AC-BLS2-4 | 20 | Prior-slice migration-14 criterion. This plan has no evidence for it and does not touch it. | — |
| AC-BLS2-5 | 20 | Prior-slice census criterion. This plan has no evidence for it. Task 5 relies on the census, but no AC-BLS2-5 run is recorded. | — |
| AC-BLS2-6 | 20 | Prior-slice rule show/find/impact criterion. This plan has no evidence for it. | — |
| AC-BLS2-7 | 20 | Prior-slice feed-cap criterion. This plan has no evidence for it. | — |
| AC-BLS2-8 | 20 | Prior-slice corpus-scope lease criterion. This plan has no evidence for it. | — |
| AC-BLS2-9 | 20 | Prior-slice snapshot-scope criterion. This plan has no evidence for it. | — |
| AC-BLS2-10 | 20 | Prior-slice exemption criterion. This plan has no evidence for it. | — |
| AC-BLS2-11 | 35 | The resume diff adds a feed block whenever a claimed task's spec cites rules, even with gate mode off. A later commit suppresses the block only when no rules govern the task. The rollback test was modified (contents unseen) but no run of it is recorded. | 01M4HW05V4T2K4PESHRAFMTA7M (governing-filter follow-up commit) |
| AC-BLS2-12 | 65 | There is one attested pass, but it covers only 2 of 12 branches. The output tail lists bootstrap sites and does not show 0 gaps or the exit code. The plan invariant (all 12 branches at 0 gaps) has no evidence. | 01M4HW06RH0S962TBMYX4KQXMJ |
| AC-BLS2-13 | 15 | AI-rubric fast-mode assessment. This plan records no probe, coverage or fidelity numbers for it. The new command can feed item (4), but no measurement is recorded. | — |
| AC-BLS2-14 | 20 | The command now exists: seeded sample, nonce-fenced data, catch-all list at 5%. No run with size >= 100 and a recorded seed and share exists yet. The plan defers the re-measurement. | 01M4HW04WFZV4M35VTM99BVYXB |
| AC-BLS2-15 | 20 | Prior-slice census fidelity criterion. This plan has no evidence for it. | — |
| AC-BLS2-16 | 15 | Review-branch exit assessment. This plan has no evidence for it. | — |
| AC-BLS2-17 | 15 | Review confirmation via the cross-branch probe. This plan has no evidence for it. | — |
| AC-BLS2-18 | 15 | Fast-mode branch existence. The statement is truncated in the materials and this plan has no evidence for it. | — |
| AC-BLS2-19 | 20 | The statement is not shown and this plan has no evidence for it. | — |
| AC-BLS2-20 | 20 | The statement is not shown and this plan has no evidence for it. | — |
| AC-BLS2-21 | 85 | RED then green: 35 unit tests and a CLI integration test (exit 2/6, nothing stored on refusal, nonce fence, judge not spawned without --ai). Gaps: the second judge and the adjudicator are the same provider, so independence is weak; the nonce-collision error advises a --nonce flag that does not exis… | 01M4HW02Z6K680B4M963RY347Z, 01M4HW04WFZV4M35VTM99BVYXB |
| AC-BLS2-22 | 82 | RED then green: 13 capability tests and 5 wiring tests. Claim time comes from task.extra.claim.at; changes before the claim are excluded; retired rules are listed. Risk: any corrupt historical rule in any baseline doc fails the whole resume, and history is scanned in full for every claimed task. | 01M4HW03ZH39NNSFQDA9VWRW1Y, 01M4HW05V4T2K4PESHRAFMTA7M |
| AC-BLS2-23 | 75 | Unit tests pass for exclusion sampling (RED then green, 35 tests). The statement is not shown. The CLI integration test never exercises --exclusions, and wrong_share reporting is verified only by the unit tests, whose contents are unseen. | 01M4HW02Z6K680B4M963RY347Z, 01M4HW04WFZV4M35VTM99BVYXB |

## Gaps

- The plan invariant requires all 12 branches at 0 coverage gaps and the fidelity command declared on its leaf. Task 5 evidence runs coverage on only 2 branches, and its output tail lists sites without showing exit 0.
- packages/lore/src/flows/feed-flow.ts now injects a rule-diff block into the resume feed whenever claimed tasks have governing rules, with gate mode off. packages/lore/tests/e2e/baseline-slice2-rollback.bun.test.ts was changed but no attested run is recorded.
- packages/lore/src/service/resume-rule-diff.ts parses every rule in every baseline version before the governing filter. A corrupt non-governing rule therefore fails the resume, and the full history is rescanned for each claimed task.
- In packages/lore/src/service/fidelity-sample.ts, judge A, judge B and the adjudicator use the same provider with identical prompts, which weakens two-judge independence. The nonce-collision error refers to a --nonce flag that packages/lore/src/adapters/cli/commands/baseline.ts does not define.

## Recommendations

- Before closing an orchestrator task, require one coverage evidence row per branch (12) with its exit code.
- Whenever a diff changes feed or resume output, re-run the AC-BLS2-11 rollback test and attach the result.
- Specify whether the second fidelity judge must be a distinct provider or model.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 58443ms
- Retried: false
- Truncated sections: spec, diff:packages/lore/tests/unit/service/fidelity-sample.test.ts, diff:packages/lore/tests/e2e/baseline-slice2-rollback.bun.test.ts
- Reasoning clipped for: AC-BLS2-21

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 72 | 0.6 | evidence | Both commands were delivered with tests. Task 5's all-12 coverage and the leaf declaration are not evidenced, and AC-BLS2-14 is not yet measured. |
| evidence_integrity | 68 | 0.6 | evidence | RED to green is shown for 21/22/23. The CLI integration run has no output tail. Task 5's evidence is for AC-BLS2-12 (2 branches) only, and its output tail is ambiguous. |
| scope_fidelity | 85 | 0.65 | evidence | The changes stay within the C7 fidelity and BL-15 work, plus the plan-sanctioned exclusions mode. The governing-filter follow-up commit is justified by AC-BLS2-11. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-BLS2-12 | The plan invariant requires all 12 branches at 0 coverage gaps and the fidelity command declared on its leaf. Task 5 evidence runs coverage on only 2 branches, and its output tail lists sites without showing exit 0. |
| outcome | major | AC-BLS2-11 | packages/lore/src/flows/feed-flow.ts now injects a rule-diff block into the resume feed whenever claimed tasks have governing rules, with gate mode off. packages/lore/tests/e2e/baseline-slice2-rollback.bun.test.ts was changed but no attested run is recorded. |
| outcome | minor | AC-BLS2-22 | packages/lore/src/service/resume-rule-diff.ts parses every rule in every baseline version before the governing filter. A corrupt non-governing rule therefore fails the resume, and the full history is rescanned for each claimed task. |
| outcome | minor | AC-BLS2-21 | In packages/lore/src/service/fidelity-sample.ts, judge A, judge B and the adjudicator use the same provider with identical prompts, which weakens two-judge independence. The nonce-collision error refers to a --nonce flag that packages/lore/src/adapters/cli/commands/baseline.ts does not define. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Before closing an orchestrator task, require one coverage evidence row per branch (12) with its exit code. | The invariant claims all 12 branches but only 2 are evidenced. |
| process | Whenever a diff changes feed or resume output, re-run the AC-BLS2-11 rollback test and attach the result. | Byte-identity guarantees can break silently. |
| spec | Specify whether the second fidelity judge must be a distinct provider or model. | Same-model judges understate variance. |

## Unverifiable Materials

- packages/lore/tests/unit/service/fidelity-sample.test.ts: Omitted from the diff, so I cannot confirm exclusions and adjudication assertions beyond the pass records.
- packages/lore/tests/e2e/baseline-slice2-rollback.bun.test.ts: Modified but not shown, and no run is recorded.
- AC-BLS2-19..23 statements: The spec table is truncated after AC-BLS2-18.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 5
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 23 declared criteria
- Task evidence: 5 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.69
