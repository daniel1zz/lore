---
id: KN-632
type: knowledge
role: knowledge
title: "Review-branch migration re-assessment (attempt 2) against AC-BLS2-16"
status: archived
priority: medium
created: 2026-10-09
updated: 2026-10-23
tags: []
parent: PLAN-177
---
Review-branch migration re-assessment against AC-BLS2-16 (attempt 2, after owner choice A), 2026-10-09. Attempt 1: `knowledge-review-branch-migration-assessment-against-ac-bls2-16` (8.5/10, kept on record). All oracles run by the orchestrator on main.

## Verdict: FAIL (4 of 5 bars met). One re-probe per remediation revision is used; stop rule applies.

| Bar | Requirement | Attempt 1 | Attempt 2 (re-probe) | Source | Result |
|---|---|---|---|---|---|
| 1 | >= 9/10, 0 confident-wrong | 8.5, 0 CW | 7.5, 0 CW | grader2/bar1.sh exit 1; re-probe `knowledge-review-branch-frozen-re-probe-set-10-questions` created 04:02:35Z, first W6 write 04:11:18Z; author statement: never read any baseline, pilot or probe doc; questions disjoint from attempt 1 (7 replaced against a behaviour list) | FAIL |
| 2 | coverage exit 0 | 0 gaps | 0 gaps (5 leaves) | rb-draft/bar23.sh | PASS |
| 3 | established/observed rules cited | 11/53 | 13/59, all cited | rb-draft/bar23.sh | PASS |
| 4 | 100% cited-or-exempt, exemptions <= 10% | 26 criteria, 9 exempt | 26 criteria, 10 exempt (1.0% of 1021) | rb-draft/bar4.py | PASS |
| 5 | >= 90% faithful | 19/20 | 19/20 (re-judged on rewritten rules) | judge2/bar5.sh | PASS |

## Where attempt 2 lost points
- Q5 (0, marked unsure): asked whether the agent AI-off default stops a review. Key: it does not (review uses AI on every surface; only --no-ai or an explicit config override stops it, exit 2). The reader read BR-265 ("if AI is switched off for a surface ... exit 2") as covering the agent default. Rule wording is ambiguous on exactly the point the repo's own root CLAUDE.md gets wrong (#78).
- Q1, Q2, Q9 (0.5 each): absences — the queue badge text on a mechanical verdict; which identity the review's audit row names and that the requester is stored nowhere; both reviewer options with the same name.
- Both attempts: 0 confident-wrong in 20 questions. Every miss is an absence or an ambiguity; no rule was shown false.

## Reading the two attempts together
- Probes written from code by authors told to find prose-vs-code discriminators sample fine-grained details (labels, identity fields, flag combinations). The branch states business outcomes plus (after step 6) exit codes and rows written. Each new probe finds new details; filling them one probe at a time does not converge and approaches teaching to the test.
- PRD kill/revisit criterion (2) names 8/10 (the corpus-only reader) as the baseline to beat; attempt 2 is below it on this probe. No corpus-only control was run on either review probe, so whether the baseline beats the corpus on review is NOT measured.

## Corpus repairs after measurement (bars not moved)
- AC-ESC-5: judge 1 found BR-277 unfaithful, judge 2 found BR-278 unfaithful (its tests never record two judgments on one version). Cite removed; exempted as `no-rule:` (it needs its own rule). Bars 3-4 re-run PASS.

## Issues filed in P5
#77 #78 #79 #80 (re-probe author), #81 #82 #83 (remediation drafter).


## Addendum 2026-10-09 — verdict under the re-baselined relative bar (owner choice A after the corpus-only control)
The verdict above (FAIL) stands as measured under the absolute bar and is not rewritten. After the corpus-only control (`knowledge-corpus-only-control-on-both-review-branch-probes`) the owner replaced bar 1 with "baseline >= corpus-only control + 1.0 on the same probe, 0 confident-wrong" (SPEC-157 amendment log, v45; PRD v13).

| Bar | Requirement (current wording) | Measured | Source | Result |
|---|---|---|---|---|
| 1 | deciding probe (re-probe): baseline - control >= 1.0, baseline CW 0 | 7.5 - 6.5 = +1.0, CW 0 (attempt 1: 8.5 - 7.0 = +1.5, CW 0) | ctl/bar1rel.sh exit 0; red control at +1.5 required -> exit 1 | PASS, exactly at the threshold |
| 2-5 | unchanged | as above (coverage 0 gaps; 13/59 established cited; 26 criteria, 10 exempt = 1.0%; fidelity 19/20) | bar23.sh, bar4.py, judge2/bar5.sh | PASS |

**Verdict under the current AC-BLS2-16: PASS (5 of 5).** Margin is zero on bar 1: half a point less and it fails. Arming the review branch is not part of this plan; it is a separate owner decision.
