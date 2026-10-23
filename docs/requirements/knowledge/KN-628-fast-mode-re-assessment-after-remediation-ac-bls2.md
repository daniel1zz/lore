---
id: KN-628
type: knowledge
role: knowledge
title: "Fast-mode re-assessment after remediation: AC-BLS2-13/17/18 pass"
status: archived
priority: medium
created: 2026-10-09
updated: 2026-10-23
tags: []
parent: PLAN-176
---
Fast-mode re-assessment against AC-BLS2-13 / 17 / 18 after the P4 remediation revision (plan-baseline-fast-mode-migration-of-the-remaining-9-branches), 2026-10-09. Attempt 1 (`knowledge-fast-mode-migration-assessment-12-branches-populated`) is kept on record and not rewritten. Every number below was re-run by the orchestrator on main.

## Verdict: PASS on AC-BLS2-13, -17 and -18. Arming is a separate owner decision (config change).

| Item | Bar | Attempt 1 | Attempt 2 (re-probe, after remediation) | Oracle | Result |
|---|---|---|---|---|---|
| AC-BLS2-18 | 9 branches: coverage exit 0, 0 uncited established/observed | 7 of 9 | 9 of 9 | fx/record.sh per branch; r4/all12.sh | PASS |
| AC-BLS2-13 (1)(2) | 12 branches coverage 0; 0 uncited established/observed | 10 of 12 | 12 of 12 (re-verified after the post-measurement repair) | r4/all12.sh exit 0 | PASS |
| AC-BLS2-13 (3) | baseline - control >= 2.0/20, baseline CW 0 | 17 vs 13.5, CW 1 | 16.5 vs 13 (+3.5; +2.5 under the lenient control reading), baseline CW 0, control CW 1 | xr2/bar3.sh exit 0; re-probe `knowledge-fast-mode-cross-branch-frozen-re-probe-set-20` frozen before R1's first write | PASS |
| AC-BLS2-13 (4) | sampled fidelity >= 90%, drawn after the last citation change | 78.6% (seed 20261009) | 205/224 = 91.5% (seed 20261010, after R1) | fp2/bar_fid.py exit 0 | PASS |
| AC-BLS2-17 | review questions, baseline CW 0 | 3/3, CW 0 | 2/2, CW 0 | grade-baseline.md | PASS |

## What the remediation revision did
- R1: a full fidelity pass over all 625 cites (W2's 224 + 401 by 6 judges): 408 faithful (65.3%). 217 unfaithful cites removed, 2 repointed to a judge-named same-branch rule, 114 established rules downgraded to unconfirmed with an open question in their leaf (49 leaves).
- R2/R3/R3b: issue #94 fixed in code (tester RED, implementer green, merged with task slugs; one RED case corrected from `sync status` to `sync push` because status has no business refusal site, assertion unchanged); a false positive on build-asset imports fixed with an explicit asset-extension allowlist after the first allowlist-by-exclusion was rejected as a silent-drop risk.
- R4: autonomy's UAT and evaluation leaves declared their commands and mapped 63 sites (1 new unconfirmed rule BR-958).

## Honest reading
- Fidelity passes because unfaithful cites were removed, not because excavation improved: the full pass found 34.7% of all cites unfaithful, worst in the oldest branches (specification 42%, execution 53%). The baseline now claims less (about 330 established/observed rules of ~960, down from ~450) and what it claims is checked.
- The post-remediation sample still disagreed with the earlier judges on 19 cites that earlier judges had kept: inter-judge variance is ~8%. Those 19 were removed after measurement (9 more rules downgraded; bars not moved; all-12 re-verified PASS).
- The single remaining weak spots: issue-loop 80% and specification 85% in the fresh sample.
- The corpus-only control made a confident-wrong answer on both probes; the baseline made one only in attempt 1 (BR-704, a false belief copied from the corpus, corrected).

## Issues filed in this plan
#84-#94, #95-#102 (grouped excavator findings), #103 (AC-RC-12 vacuous filter), #104 (census does not follow dependency injection).
