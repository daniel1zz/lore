---
id: KN-629
type: knowledge
role: knowledge
title: "Fast-mode migration assessment: 12 branches populated, not armable"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PLAN-176
---
Fast-mode migration assessment against AC-BLS2-13 / 17 / 18 (plan-baseline-fast-mode-migration-of-the-remaining-9-branches), 2026-10-09. All numbers re-run by the orchestrator on main; oracle scripts named per row.

## Verdict: NOT ARMABLE. Stop rule applies.

| Item | Bar | Measured | Source | Result |
|---|---|---|---|---|
| AC-BLS2-18 (9 branches) | each branch coverage exit 0, 0 uncited established/observed | 7 of 9 PASS (corpus 19 leaves/107 rules, product-baseline 15/88, session 8/80, hygiene 11/89, issue-loop 5/49, distribution 7/64, context 7/49); autonomy 7/74 coverage exit 1 (2 leaves UNMEASURED), sync 8/38 coverage exit 4 — both blocked by #94 (census cannot resolve standalone-const subcommands) | fx/record.sh per branch | FAIL (2 branches) |
| AC-BLS2-13 item 1 | 12 branches coverage 0 | 10 of 12 (autonomy, sync) | record.sh; AC-BLS2-12 for spec/exec, review W8 | FAIL |
| AC-BLS2-13 item 2 | 0 uncited established/observed | 0 in every branch | record.sh | PASS |
| AC-BLS2-13 item 3 | baseline - control >= 2.0 of 20, baseline CW 0 | 17 vs 13.5 (+3.5); baseline CW 1 (Q12), control CW 1 (same Q12) | xr/bar3.sh exit 1; probe `knowledge-fast-mode-cross-branch-frozen-probe-set-20-questions` frozen before any of the 9 branches | FAIL on CW |
| AC-BLS2-13 item 4 | sampled fidelity >= 90% | 176/224 = 78.6% (seed 20261009, <= 20 per branch) | fp/bar_fid.py exit 1 | FAIL |
| AC-BLS2-17 | review questions, baseline CW 0 | 3 review questions, 3/3, CW 0 | grade-baseline.md | PASS (but item 3 failed overall) |

## Findings
1. **The one confident-wrong answer came from the corpus, not from the baseline format.** BR-704's example said creating a handoff with the generic create "names the handoff action"; on the CLI a schema error fires first and does not (#88). The corpus-only control made the identical confident-wrong answer from the code comments and rule files the excavator also read. BR-704's example was corrected after measurement (bar not moved).
2. **Fidelity is the systemic weakness, and it predates fast mode.** Per branch: review 100%, sync 100%, autonomy 95%, corpus 95%, context 85%, distribution 80%, issue-loop 80%, hygiene 75%, execution 65%, session 65%, specification 65%, product-baseline 55%. Execution and specification were migrated in slice 2a and never sampled; this is their first measurement. Dominant failure: the criterion does not assert the rule; a different test in the same file covers it ("whole suite passes" criteria, stale criterion text). Above the PRD's 70% revisit line, below 90%.
3. **One real code/test contradiction**: the territory regression test asserts a genuinely foreign claim is classified unmeasured when the caller has no session id, while BR-392 says foreign stays foreign (verdicts3 n=195).
4. **Stale criteria texts** (AC-083-1, AC-S3-3, AC-BLS1-6 vs BR-38, AC-AEP-9 version) need re-baselines by their owners.
5. **The baseline still beats the corpus by 3.5/20** and lets the reader commit (16 sure vs 8).

## What would make it armable
(a) #94 fixed (code) and autonomy/sync re-covered; (b) every unfaithful sampled cite removed or repointed, and — because sampling found 21% unfaithful — a full fidelity pass over all ~650 cites with rules left uncited downgraded to unconfirmed; (c) a fresh cross-branch probe after that remediation revision (one re-probe allowed).

## Issues filed in this plan
#84-#93 (probe author), #94 (+comment), #95-#102 (grouped per-branch excavator findings).
