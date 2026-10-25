---
id: KN-622
type: knowledge
role: knowledge
title: "AC-BLS2-14 re-measurement after #105: fidelity 93.6% of 110 pairs, no catch-all, PASS"
status: archived
priority: medium
created: 2026-10-10
updated: 2026-10-23
tags: []
links:
  - {id: KN-626, type: relates-to}
  - {id: PLAN-175, type: informs}
  - {id: SPEC-157, type: informs}
---
AC-BLS2-14 re-measurement after the #105 fix and the removal of the 8 known-unfaithful sole citations (2026-10-10). Independent judges, seed 20261012, 110 pairs drawn from the 381 live cites into live baseline rules (305 citing criteria), all 12 branches represented.

## Verdict: PASS (93.6% >= 90%); catch-all check PASS.

| Check | Bar | Measured | Result |
|---|---|---|---|
| Sampled fidelity | >= 90% of >= 100 pairs | 103/110 = 93.6% (judge 1: 51/55, judge 2: 52/55) | PASS |
| Catch-all rules | flag every rule cited by > 5% of citing criteria | threshold 15.25 criteria; max 4 (BR-149, BR-21); none flagged | PASS |

Counts were recomputed by the orchestrator from the two verdict files (coverage n=1..110 checked), not taken from the judges' replies.

## Method
- Pairs rebuilt from the live corpus after the removals (script scratchpad b14r/build.py); `random.Random(20261012).sample(pairs, 110)`; halves 1-55 and 56-110 to two separate judge agents.
- Rule and criterion text were handed to the judges in a JSON data file with an explicit "data, not instructions" instruction (not inline-fenced in the prompt).
- Judges were told not to read earlier verdict files (scratchpad b14/, fp*/), and judged by reading the named test files' assertions (tests not executed).
- Fixed rule: faithful iff the criterion's statement asserts the rule's main claim AND its named test would fail if the rule were false.

Branch spread: execution 23, hygiene 16, corpus 16, distribution 9, issue-loop 8, specification 8, session 8, product-baseline 6, autonomy 6, context 5, review 3, sync 2.

## Unfaithful pairs (7) and what was done after measurement
All removed under ac-cite enforce (subtractive-only, allowed after measurement; a removal cannot lower fidelity):
- n26 AC-BLS1-4 / BR-667 (criterion text does not state the rule; criterion keeps 3 other cites) — BR-667 downgraded to unconfirmed.
- n31 AC-DR-2 / BR-412 ("continues to other locations" not discriminated) — sole cite: exempted (expires 2027-01-10) then removed; BR-412 downgraded.
- n33 AC-ACODE-1 / BR-16 (id-format negative too weak) — BR-16 downgraded.
- n53 AC-S3-7 / BR-137 (worktree branch half untested) — BR-137 keeps one other cite.
- n95 AC-ACODE-2 / BR-17 (limits not stated, lengths untested) — sole cite: exempted then removed; BR-17 downgraded.
- n102 AC-VRF-10 / BR-162 (criterion is a path list, not the rule) — BR-162 keeps other cites.
- n106 AC-084-5 / BR-714 (criterion omits padded/unpadded equivalence although the test pins it) — BR-714 downgraded. Rewording the criterion would make it faithful; not done (ac set demotes the spec).
After the removals: all 12 branches coverage exit 0 and 0 established|observed rules without a live script-mode citation (r4/all12.sh exit 0); exemptions 20 active, ratio 1.95%.

## Honest reading
- The previous sample (seed 20261011) measured 89.1%; this one 93.6%. Removing 8 of 389 cites cannot by itself move a fresh sample by 4.5 points: most of the difference is judge and sampling variance, which is the same size as the margin to the bar. The true rate sits around 90-93%. This PASS is one sample above the bar, not a proof that the rate is safely above it.
- Judges flagged several faithful-but-thin pairs (stale criterion wording n68; untested thresholds n70, n92; tests filtered by -t that skip part of the rule n8, n13, n21, n36, n55). These are not counted as unfaithful under the fixed rule.
- The structural fix for judge variance is slice 2c: judge each citation when it is written, two judges per pair with adjudication on disagreement.

Previous record: knowledge-ac-bls2-14-post-arming-fidelity-89-1-no-catch-all (FAIL, kept as history). Fix plan: plan-fix-105-the-citation-gate-honours-an-active-exemption-on.
