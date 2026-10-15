---
id: KN-641
type: knowledge
role: knowledge
title: "Assessment: Baseline pilot v3: populate the execution branch with method v2 and re-probe across two branches (2026-10-08)"
status: approved
priority: medium
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PLAN-174
links:
  - {id: PLAN-174, type: informs}
---
# Assessment: not_met (28/100)

Scope: plan `01M4CQ4FQDFS6XVTRJ429KYBJV`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-BLS1-1 | 10 | The materials have no evidence for this script AC (coverage 0/0). This plan targets AC-BLS1-13 and makes no source changes, so it is likely evidenced elsewhere, but nothing here verifies it. | — |
| AC-BLS1-2 | 10 | The materials have no evidence (0 pass, 0 fail). Probably out of this pilot plan's practical scope, but no ac_scope is declared and nothing here shows it is met. | — |
| AC-BLS1-3 | 10 | The materials have no evidence (0 pass, 0 fail). This plan does not touch the rule-state service, so it cannot be verified from these materials. | — |
| AC-BLS1-4 | 10 | The materials have no evidence (0 pass, 0 fail), so it cannot be verified here. | — |
| AC-BLS1-5 | 10 | The materials have no evidence (0 pass, 0 fail), so it cannot be verified here. | — |
| AC-BLS1-6 | 10 | The materials have no evidence (0 pass, 0 fail), so it cannot be verified here. | — |
| AC-BLS1-7 | 12 | No script evidence. W1b indirectly shows rules_with_impl_detail==0 on the live corpus, but the fixture test this AC requires was not run. | task-w1b-apply-the-execution-branch-to-the-corpus (lint count 0 on corpus, not the fixture test) |
| AC-BLS1-8 | 10 | The materials have no evidence (0 pass, 0 fail), so it cannot be verified here. | — |
| AC-BLS1-9 | 10 | The materials have no evidence (0 pass, 0 fail), so it cannot be verified here. | — |
| AC-BLS1-11 | 10 | This is the v1 pilot exit, superseded by later pilots. These materials have no evidence for it. | — |
| AC-BLS1-12 | 10 | This is the v2 pilot exit. The plan references the v2 assessment, which led the owner to choose option A after v2, but the materials record no v2 numbers. Not verifiable here. | — |
| AC-BLS1-13 | 12 | Contradicted by the evidence. The W3 oracle records a blind score of 8.0/10 (bar 9) and 1 confident-wrong (bar 0), giving a FAIL. Per-task evidence supports bars 1-4 and the timing-order check. The failure is recorded honestly and the stop rule applies. | task-w3-pilot-v3-assessment-against-ac-bls1-13 (attested fail: 8.0/10, cw 1), task-w2b-blind-reader-on-probe-v3-independent-grader, task-w2a-two-independent-mappers-on-ac-sample-v3-amended-adr, task-w1c-citation-coverage-and-downgrades-across-both-branches, task-w0a-freeze-probe-set-v3-before-the-first-execution-branch, task-w0b-freeze-ac-sample-v3-80-acs-seed-20261009-disjoint-from |

## Gaps

- The blind reader scored 8.0/10 with 1 confident-wrong answer on probe v3, missing bars 5 (>= 9) and 6 (== 0). AC-BLS1-13 fails.
- The output tails do not show the W2a full-granularity disagreement ratio or the in-tree count, or the W1c uncited count. W3 asserts 'bars 1-4 met' as a literal string rather than computing it.
- Several expected-fail reds use placeholder hashes (0000dead) or off-by-one counts. These show the oracle can fail, but they are weak mutation tests.

## Recommendations

- Add extra.ac_scope = [AC-BLS1-13] to pilot plans.
- Make the W3 assessment oracle compute bars 1-4 from the source docs and print every number, instead of echoing 'bars 1-4 met'.
- Return to the owner with root causes for the confident-wrong question and the missed question before choosing a v4 direction.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 40107ms
- Retried: false
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 20 | 0.85 | evidence | The exit criterion AC-BLS1-13 failed on blind bars 5-6 (8.0/10, 1 confident-wrong). The build, freeze and mapping tasks were delivered, but the goal question was answered negatively. |
| evidence_integrity | 68 | 0.6 | evidence | All evidence is attested, with red/green pairs and hash-pinned freezes. Some reds are trivial placeholders (0000dead), and key numbers for bars 2-4 are missing from the output tails. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | blocker | AC-BLS1-13 | The blind reader scored 8.0/10 with 1 confident-wrong answer on probe v3, missing bars 5 (>= 9) and 6 (== 0). AC-BLS1-13 fails. |
| evidence_integrity | minor | AC-BLS1-13 | The output tails do not show the W2a full-granularity disagreement ratio or the in-tree count, or the W1c uncited count. W3 asserts 'bars 1-4 met' as a literal string rather than computing it. |
| evidence_integrity | minor | — | Several expected-fail reds use placeholder hashes (0000dead) or off-by-one counts. These show the oracle can fail, but they are weak mutation tests. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Add extra.ac_scope = [AC-BLS1-13] to pilot plans. | Stops unrelated ACs from depressing pilot assessments. |
| process | Make the W3 assessment oracle compute bars 1-4 from the source docs and print every number, instead of echoing 'bars 1-4 met'. | Makes every recorded number in the rubric checkable from the evidence. |
| process | Return to the owner with root causes for the confident-wrong question and the missed question before choosing a v4 direction. | The stop rule requires an explicit owner choice. |

## Unverifiable Materials

- knowledge-pilot-assessment-v3-specification-execution-branches content: Only grep-based checks are shown. The 6 recorded numbers themselves are not visible.
- W2a mapper TSV tables: The disagreement ratio and in-tree count are not printed in the evidence shown.
- Reader/grader and mapper isolation: Independence and blinding are asserted in the task descriptions only.
- Evidence for AC-BLS1-1..9, 11, 12: This bundle has no evidence records for them.
- scope_fidelity dimension score: Commit set unverifiable (convention mismatch — plan archived, no commit referenced any task slug). scope_fidelity was NOT SCORED, regardless of what the judge reported.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 0
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 12 declared criteria
- Task evidence: 8 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=1.00
