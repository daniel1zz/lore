---
id: KN-605
type: knowledge
role: knowledge
title: "AC-BLS2-14 re-measurement after the baseline review: 93.6% of 110 pairs (seed 20261015), PASS"
status: archived
priority: medium
created: 2026-10-10
updated: 2026-10-23
tags: []
---
AC-BLS2-14 re-measurement after the 2026-10-10 baseline review (122 nodes approved, ~40 rule statements rewritten). Same protocol as knowledge-ac-bls2-14-re-measurement-after-105-fidelity-93-6-of: two independent judges reading the named test files, fixed two-part rule, rule text as data, judges barred from earlier verdicts. Seed 20261015, 110 of 386 live citations (311 citing criteria), all 12 branches.

## Verdict: PASS — 103/110 = 93.6% (judge 1: 52/55, judge 2: 51/55); catch-all PASS (max 4 citing criteria vs threshold 15.55). Recounted by the orchestrator from verdict files (n=1..110 checked).

## Unfaithful (7 pairs) — removed after measurement under enforce (sole cites exempted to 2027-01-10)
n16 AC-S-2/BR-375 (squash merge never exercised; BR-375 downgraded), n40 AC-070-3/BR-597 (-t covers one of three parts), n49 AC-RC-3/BR-350 (closure position not run), n63 AC-MH-8/BR-776 (task kind not tested; BR-776 downgraded), n71 AC-DS-7/BR-735 (-t runs only the unknown-value branch), n75 AC-WTC-3/BR-962 — my own mis-citation today (a coverage criterion citing the sweep rule; BR-961 removed too), n84 AC-CF-14/BR-902 (one isolation direction).

## Reading
Same share as seed 20261012 before the rewrites. The rewrites did not lower fidelity on this sample. Judge-to-judge variance remains about the margin to the bar.

Note: `lore baseline fidelity` (C7) was not used for this measurement — its judge does not see the named test's code (#117), so its numbers are not comparable.
