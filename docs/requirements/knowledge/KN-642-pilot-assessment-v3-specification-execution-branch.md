---
id: KN-642
type: knowledge
role: knowledge
title: "Pilot assessment v3: specification + execution branches, method v2 (AC-BLS1-13)"
status: draft
priority: medium
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PLAN-174
---
# Pilot assessment v3: specification + execution branches, method v2 (AC-BLS1-13)

Plan `plan-baseline-pilot-v3-populate-the-execution-branch-with`. Bars registered in AC-BLS1-13 before the plan existed. Per the plan's stop rule, any missed bar returns the direction to the owner.

## Verdict: FAIL — 2 of 6 bars missed (blind score 8/10; 1 confident-wrong). Every placement and coverage bar passed.

| # | AC-BLS1-13 number | Measured | Bar | Verdict | Record |
|---|---|---|---|---|---|
| 1 | Sample size, seed, freeze, disjointness | 80 ACs, seed 20261009, frozen 2026-10-08T02:58:52Z, 0 overlap with the v2 sample and the v1 specs (attested check) | >= 60, disjoint | ✅ | `knowledge-pilot-v3-frozen-ac-sample-80-acs-seed-20261009-for` |
| 2 | Full-granularity disagreement | 9 / 80 = 11.2% | <= 30% | ✅ | `knowledge-pilot-v3-placement-11-2-full-granularity-disagreement` |
| 3 | In-tree count | 22 (both mappers on a rule: 20, same rule 20/20) | >= 20 | ✅ | same |
| 4 | Established/observed rules without a citing script-mode AC, both branches | 0 of 148 | 0 | ✅ | `knowledge-pilot-v3-execution-branch-build-log-132-rules-93-with` |
| 5 | Blind score | 8.0 / 10 | >= 9 | ❌ | `knowledge-pilot-v3-blind-reader-8-10-1-confident-wrong-mixed` |
| 6 | Confident-wrong | 1 (Q2) | 0 | ❌ | same |
| — | Probe frozen before the first execution-branch document | probe 03:07:39.596Z < branch 03:20:15.055Z (all 9 execution docs checked by `lore get`) | precondition | ✅ | see "Evidence defects" |

## Why bars 5 and 6 failed
- **Q2 (the confident-wrong)** asks about a refusal that comes from the evidence command's mixed-runner guard. No baseline rule describes that guard, so the reader attributed the refusal to a different, correct rule (BR-150) at high confidence. The guard itself is a filed defect (issue #46: this repository's two-runner convention is imposed on consumer projects). The baseline describes the product's rules; a refusal path nobody wrote down as a rule is invisible to a reader, whether it is intended or a defect.
- Q3 and Q10 lost half a point each on details the baseline does not state (byte-exact command matching for approval; the printed success line), both correctly marked NOT ANSWERABLE.
- Scoring note: the "right outcome, contradicted reason = wrong" rule that makes Q2 part 1 confident-wrong was fixed in the grader brief before grading, not in the plan. Without it the score is still 8.0 and confident-wrong is 0. The stricter reading is the verdict.

## What the three pilots now establish
| | v1 | v2 | v3 |
|---|---|---|---|
| Placement disagreement (collapsed) | 49.4% | 1.4% | 6.2% |
| Full granularity | — | 12.9% | 11.2% |
| Same rule chosen when both mappers chose one | 1/5 | 1/2 | 20/20 |
| Established/observed rules without a falsifying AC | 83 of 95 uncited | 0 | 0 (148 rules, 2 branches) |
| Baseline content shown false by a blind miss | 0 (claimed 1, refuted) | 0 | 0 |
| Blind score | 8/10 | 4.5/10 (5 Qs out of branch) | 8/10 |
| Confident-wrong | 2 | 0 | 1 |

Placement and rule truth are now reproducible and mechanically backed. The remaining failure mode is **completeness**: every blind miss in v3 is something the product does that no rule states. Correctness of what IS stated has held across 3 probes (0 confirmed false rules).

## Evidence defects (orchestrator's own, disclosed)
1. W0a's "durable" ordering oracle read `created_at` from `lore list`, which does not return that field. At record time it passed vacuously (0 new documents); after the branch was built it false-fails (null compares before any time). Replaced by a check that reads each of the 9 execution documents with `lore get` (recorded on W3); the ordering holds. Lesson: an absent field in jq is null and null compares as earliest — a vacuous pass, exactly the North Star's "vacuously true must be distinguishable".
2. W0a row v3 and W1b row v3: expected-fail rows that failed because of an error in the orchestrator's command, not because of the intended mutation. Correct red rows were recorded after them; the bad rows remain on the tasks.

## Recommendation (owner decision — not executed)
- **A. Add a completeness check to the method, then proceed to slice 2.** For each leaf, enumerate the refusal and outcome sites on its command path in code and require each to be stated by a rule (intended behaviour as established/observed, suspected defects as unconfirmed). This targets the only failure mode left. Slice 2 (all branches + enforcing citation gate) would be built on placement and coverage bars that have now held twice.
- **B. One more probe round (v4) after the completeness check, before slice 2.** Strongest evidence, one more round of cost; requires a new frozen probe set.
- **C. Proceed to slice 2 now** and treat completeness as ongoing maintenance. Risk: the enforcing gate lands before any probe has passed.

Recommended: **A**, with the completeness check written as part of slice 2's migration method so every branch gets it, and with a blind probe kept as slice 2's per-branch exit test.

## Issues filed during v3
#43 exit-0 falsifier recorded as attested red · #44 phase rename leaves no task version · #45 release refusal says "wait for expiry" · #46 mixed-runner guard leaks into consumer projects · #47 plan close archives open tasks bypassing done · #48 runner-labelled row without attestation on failed green control · #49 stale "SOLE issuer" refusal text · #50 plan set-approved skips plan-promote · #51 claim/evidence ignore task status · #52 active spec no longer counts as approved.
