---
id: KN-611
type: knowledge
role: knowledge
title: "Assessment: Baseline slice 2c: C7 fidelity sampling command and BL-15 resume rule diff (2026-10-10)"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PLAN-168
links:
  - {id: PLAN-168, type: informs}
---
# Assessment: partially_met (58/100)

Scope: plan `01M4HW022CV6X0BR3ZA0P9Q9JF`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-BLS2-1 | 20 | No evidence in this bundle. The ID is outside this plan's targets (21/22/23), but the plan declares no ac_scope, so it is counted as unevidenced. | — |
| AC-BLS2-2 | 20 | No evidence in this bundle. It belongs to an earlier slice and this plan has no ac_scope. | — |
| AC-BLS2-3 | 20 | No evidence in this bundle. | — |
| AC-BLS2-4 | 20 | No evidence in this bundle. | — |
| AC-BLS2-5 | 20 | No evidence in this bundle. | — |
| AC-BLS2-6 | 20 | No evidence in this bundle. | — |
| AC-BLS2-7 | 20 | No evidence in this bundle. | — |
| AC-BLS2-8 | 20 | No evidence in this bundle. | — |
| AC-BLS2-9 | 20 | No evidence in this bundle. | — |
| AC-BLS2-10 | 20 | No evidence in this bundle. | — |
| AC-BLS2-11 | 15 | No evidence. The diff may also break it: with no baseline docs, a resume for a plan with a claimed task now prints the 'Governing rules since claim' block and the unchanged line, so that output is no longer byte-identical to slice 1. | — |
| AC-BLS2-12 | 75 | There is an attested pass for the specification and execution coverage commands, but the output tail is truncated, so the 0-gap result itself is not visible. The pass also does not show the all-12-branch exit 0 that task 5 promised. | 01M4HW06RH0S962TBMYX4KQXMJ (oracle=other pass) |
| AC-BLS2-13 | 10 | No fast-mode assessment record is shown: no probe, no per-branch coverage and no fidelity measurement. | — |
| AC-BLS2-14 | 30 | The tool exists: seeded draw, nonce-fenced data and a 5% catch-all list. But no fidelity run with size 100 or more was recorded, so the AC itself is not measured yet. | 01M4HW04WFZV4M35VTM99BVYXB |
| AC-BLS2-15 | 20 | No evidence in this bundle. | — |
| AC-BLS2-16 | 15 | No review-branch assessment record in this bundle. | — |
| AC-BLS2-17 | 15 | No cross-branch probe record in this bundle. | — |
| AC-BLS2-18 | 15 | The statement is truncated and there is no evidence. | — |
| AC-BLS2-19 | 20 | No evidence; the statement is not shown. | — |
| AC-BLS2-20 | 20 | No evidence; the statement is not shown. | — |
| AC-BLS2-21 | 85 | There are 3 attested passes with RED-before-green. The code shows a deterministic mulberry32 draw, a nonce fence, strict reply parsing (exit 6), --judges 1\|2 with an adjudicator, exit 2 refusals and a CLI e2e test. Gaps: judges A and B use the same provider and prompt, and the 35 unit tests are uns… | 01M4HW04WFZV4M35VTM99BVYXB, 01M4HW02Z6K680B4M963RY347Z |
| AC-BLS2-22 | 82 | There are 3 attested passes and a wiring test. Version rows dated at or before claim.at give the old value, and changes before the claim are excluded. Gaps: one task with a claim but no 'at' fails the whole resume, and every claimed task rescans all versions of every baseline doc. | 01M4HW05V4T2K4PESHRAFMTA7M, 01M4HW03ZH39NNSFQDA9VWRW1Y |
| AC-BLS2-23 | 78 | Attested passes exist and the code builds and samples the exclusion pool and wrong_share. Evidence is the same unit test file as AC-21, which is unseen. The CLI e2e test does not exercise --exclusions. | 01M4HW04WFZV4M35VTM99BVYXB |

## Gaps

- buildResumeFeed in packages/lore/src/flows/feed-flow.ts now always adds the rule-diff block for claimed tasks, including 'governing rules unchanged since claim' when there are no baseline docs. This changes resume output that slice 1 required to stay byte-identical.
- Task 5's evidence covers only 2 branches, and its output is truncated. There is no proof of all-12 coverage exit 0 or of mapping the fidelity command's sites.
- computeRuleDiffSinceClaim in packages/lore/src/service/resume-rule-diff.ts reloads every version of every baseline doc for each claimed task. A claim without 'at' turns the entire resume feed into an error.
- runFidelity in packages/lore/src/service/fidelity-sample.ts sends the identical prompt to the same provider for judge A and judge B. Its nonce error tells the user to 'pass another --nonce', but the CLI has no such flag.

## Recommendations

- Add a task to run fidelity with size 100 or more and judges 2, recording the seed, then link the research doc to close AC-BLS2-14.
- Require coverage output for all 12 branches, untruncated, as task 5's evidence.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 86766ms
- Retried: false
- Truncated sections: spec, diff:packages/lore/tests/unit/service/fidelity-sample.test.ts
- Reasoning clipped for: AC-BLS2-21

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 72 | 0.6 | evidence | Both commands are implemented and tested. Task 5 closure and the AC-14 measurement are not shown, and there is an AC-11 regression risk. |
| evidence_integrity | 68 | 0.6 | evidence | RED to green with attested passes. The integration evidence has no tail and no ac_ref, the task 5 tail is truncated, and the unit test file is unseen. |
| scope_fidelity | 85 | 0.7 | evidence | Changes stay within C7/BL-15 plus the exclusions mode approved in the review answers. No unexplained drift. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-BLS2-11 | buildResumeFeed in packages/lore/src/flows/feed-flow.ts now always adds the rule-diff block for claimed tasks, including 'governing rules unchanged since claim' when there are no baseline docs. This changes resume output that slice 1 required to stay byte-identical. |
| evidence_integrity | major | — | Task 5's evidence covers only 2 branches, and its output is truncated. There is no proof of all-12 coverage exit 0 or of mapping the fidelity command's sites. |
| outcome | minor | AC-BLS2-22 | computeRuleDiffSinceClaim in packages/lore/src/service/resume-rule-diff.ts reloads every version of every baseline doc for each claimed task. A claim without 'at' turns the entire resume feed into an error. |
| outcome | minor | AC-BLS2-21 | runFidelity in packages/lore/src/service/fidelity-sample.ts sends the identical prompt to the same provider for judge A and judge B. Its nonce error tells the user to 'pass another --nonce', but the CLI has no such flag. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Add a task to run fidelity with size 100 or more and judges 2, recording the seed, then link the research doc to close AC-BLS2-14. | The tool exists but the measurement is missing. |
| process | Require coverage output for all 12 branches, untruncated, as task 5's evidence. | The plan invariant is unverified. |

## Unverifiable Materials

- packages/lore/tests/unit/service/fidelity-sample.test.ts: Omitted from the diff, so assertions on determinism, adjudication and catch-all cannot be checked.
- AC-BLS2-18..23 statement text: Truncated in the spec table.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 3
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 23 declared criteria
- Task evidence: 5 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.69
