---
id: KN-626
type: knowledge
role: knowledge
title: "AC-BLS2-14 post-arming fidelity: 89.1%, no catch-all rules, 8 unfaithful cites stuck behind the gate"
status: archived
priority: medium
created: 2026-10-09
updated: 2026-10-23
tags: []
parent: PLAN-176
---
AC-BLS2-14 measurement after arming the citation gate on all 12 baseline branches (2026-10-09). Independent judges, rule text as fenced data, seed 20261011, 110 pairs drawn from the 391 live cites into baseline rules (312 citing criteria).

## Verdict: FAIL (89.1% < 90%); catch-all check PASS. Above the PRD's 70% return-to-report line, so the gate stays in enforce.

| Check | Bar | Measured | Result |
|---|---|---|---|
| Sampled fidelity | >= 90% of >= 100 pairs | 98/110 = 89.1% (judge 1: 50/55, judge 2: 48/55) | FAIL |
| Catch-all rules | flag every rule cited by > 5% of citing criteria | threshold 15.6 criteria; max is 4 (BR-21, BR-149); none flagged | PASS |

## After measurement
- 4 of the 12 unfaithful cites were removed (their criteria keep other citations); BR-83 and BR-943 downgraded to unconfirmed.
- 8 could NOT be removed: each was its criterion's only citation and the armed gate refuses leaving a revised criterion uncited, even after the criterion is exempted (issue #105; AC-069-5 was exempted in the attempt). Remaining known-unfaithful cites: AC-069-5/BR-115, AC-RR-4/BR-65, AC-ADV-1/BR-430, AC-076-8/BR-817, AC-053-7/BR-270, AC-061-11/BR-153, AC-068-1/BR-706, AC-OX-2/BR-176.
- Successive independent samples disagree with earlier judges on ~8-11% of pairs those judges kept: 91.5% (seed 20261010) then 89.1% (seed 20261011). The true rate sits near the 90% bar; judge variance is of the same size as the margin.
