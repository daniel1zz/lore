---
id: KN-649
type: knowledge
role: knowledge
title: "Pilot assessment v2: baseline migration method v2 on the specification branch (AC-BLS1-12)"
status: archived
priority: medium
created: 2026-10-08
updated: 2026-10-23
tags: []
parent: PLAN-173
---
# Pilot v2 assessment — migration method v2 on the specification branch (AC-BLS1-12)

Plan `plan-baseline-pilot-v2-migration-method-v2-on-the-specification`. Every bar was registered in AC-BLS1-12 (spec v34, 2026-10-08 01:56:22 UTC) before the plan existed; the only later addition, the in-branch secondary measure, was registered before the reader ran (`knowledge-pilot-v2-pre-registration-addendum-probe-scope-error`) and decides nothing.

## Verdict: FAIL — one of five bars missed (blind score). Per the plan, this was the one retry; the direction goes back to the owner.

| # | AC-BLS1-12 number | Measured | Bar | Verdict | Record |
|---|---|---|---|---|---|
| 1 | Sample size, seed, freeze time | 70 ACs, seed 20261008, frozen 2026-10-08T02:01:00.469Z, specs outside the v1 population | >= 60 | ✅ | `knowledge-pilot-v2-frozen-ac-sample-70-acs-seed-20261008-for` |
| 2 | Adjudicated disagreements / sample | 1 / 70 = 1.4% | <= 30% | ✅ | `knowledge-pilot-v2-placement-1-4-kill-line-disagreement-12-9` |
| 3 | Established/observed rules with no citing script-mode AC | 0 of 55 | 0 | ✅ | `knowledge-pilot-v2-citation-coverage-pass-59-falsifying` |
| 4 | Blind reader score | 4.5 / 10 | >= 9 | ❌ | `knowledge-pilot-v2-blind-reader-4-5-10-primary-4-5-5-in-branch` |
| 5 | Confident-wrong answers | 0 | 0 | ✅ | same |
| — | Probe v2 frozen before the first v2 leaf revision | probe 2026-10-08T02:03:15.869Z < first v2 baseline version 2026-10-08 02:20:44 UTC | precondition | ✅ | `knowledge-pilot-v2-frozen-probe-set-10-questions-for-the` |

Secondary (decides nothing): in-branch questions 4.5 / 5, 0 confident-wrong.

## Why bar 4 failed
Five of the ten questions (3, 4, 5, 6, 9) are about the execution branch, which this pilot does not populate, and one part of question 7 is about review-branch status transitions. The reader answered every one of those NOT ANSWERABLE instead of guessing. The cause is the orchestrator's probe brief (domain written wider than the populated branch), recorded before the reader ran. On the five in-branch questions the reader scored 4.5/5.

This does not make the failure a pass. What it shows is narrower: **a one-branch baseline cannot answer questions that cross branches**, which is v1's root cause 3 ("the branch is cut too narrow for the specs that touch it") measured from the reader's side.

## What changed between v1 and v2, measured
| | v1 | v2 |
|---|---|---|
| Placement disagreement (collapsed) | 49.4% (42/85) | 1.4% (1/70) |
| Rule-vs-out-of-branch confusions | 24 | 0 |
| Confident-wrong answers | 2 | 0 |
| In-branch blind accuracy | 8/10 | 4.5/5 |
| Rules contradicted by code, found | 0 (not checked) | 6, corrected |
| Rules with a falsifying citation | 12 of 95 cited, not checked for falsification | 55 of 96, each tied to a named test |

## Validity limits (read before relying on the numbers)
1. **The placement sample had almost no in-branch ACs**: 68 of 70 were placed outside the branch by both mappers. Bar 2 therefore shows the in/out boundary is reproducible; it says almost nothing about choosing the right rule inside the branch (n = 2, 1 exact match). Full-granularity agreement was 87.1%; 6 of its 9 misses came from one gap in the placement ADR (mixed business/technical ACs), now amended.
2. **v1's diagnosis was half wrong** and has been corrected in place: BR-73 was never wrong, the v1 Q3 miss was a reader misreading correct content. The "excavated rules inherit doc errors" lesson now rests on the 6 contradicted rules the v2 citation pass found, not on BR-73.
3. **The v2 baseline is smaller in what it asserts with confidence**: 32 rules (28 observed, 4 established) were downgraded to unconfirmed because no live check would fail if they were false. 41 of 96 rules are now uncovered.
4. n = 1 branch, 10 probe questions, 70 sampled ACs, one reader, one grader, two mappers.

## Recommendation (owner decision — not executed)
The method problems v1 exposed are fixed and measured: placement is reproducible at the in/out boundary, rule truth is tied to named tests, and the reader no longer answers confidently wrong. What remains is coverage, not method. Options:

- **A. Populate the execution branch next with method v2, then re-run a NEW probe set spanning both branches** (frozen before the execution leaves exist). Tests the remaining question directly: does a multi-branch baseline answer cross-branch questions? Cost: one more pilot round.
- **B. Proceed to slice 2 (all branches + enforcing citation gate) on method v2.** Rests on bars 1-3 and 5 passing; accepts bar 4 as explained rather than met. Risk: slice 2's gate would be built before any probe has shown a multi-branch baseline answers correctly.
- **C. Stop the baseline migration.** Not supported by the measurements: every method defect v1 exposed is now measured as fixed.

Recommended: **A** — it is the smallest step that can turn bar 4 green or show it cannot be, and it does not build an enforcing gate on an unmet bar.

## Follow-ups filed during v2
#40 plan judge does not see structured ACs · #41 stale rejection survives a non-versioning fix · #42 root CLAUDE.md says extra edits demote, code does not.
