---
id: PLAN-202
type: plan
role: plan
title: "Corpus truthfulness: finish AC-CT-3..10 (never implemented)"
status: approved
priority: medium
created: 2026-10-17
updated: 2026-10-17
tags: []
parent: SPEC-143
phases:
  - {name: "Phase 1: re-measure", description: "T1: current state of AC-CT-3..10 against main"}
  - {name: "Phase 2: implement", description: "Tasks created after T1, one per criterion or coupled pair"}
---
## Overview
Finish spec-corpus-truthfulness-a-verdict-must-carry-the-state-it (approved, critical). Measured 2026-10-17 by the test-governance oracle-ownership check: AC-CT-1, AC-CT-2 and AC-CT-7 carry attested passes; AC-CT-3, 4, 5, 6, 8, 9 and 10 have no evidence and their command paths never existed in git history (packages/lore/tests/unit/{service,adapters,hooks}/: stamp-currency-floor, blast-radius-staleness, stamp-pre-post-demotion, pre-push-mirror-rev, occupancy-skip-continuity, unmeasured-floor-consequence). The earlier plan plan-land-corpus-truthfulness-part-a-the-two-axis-type is deprecated (its implement tasks were absorbed elsewhere). Shipped code is partial: stampCurrency exists in gate-predicates.ts; blastRadiusChanged and probeOccupancy are absent.

User decision 2026-10-17: implement in a separate plan (this one), not inside the test-governance plan. Until each criterion lands, the test-governance ownership check carries it in its not-built ledger with this plan as owner.

| T | Task | AC |
|---|---|---|
| R1 | Re-measure AC-CT-3..10 on main (done: knowledge-ac-ct-3-10-re-measured-on-main-cb55711d-verdicts-nine) | - |
| CT-1 | Spec corrections from R1 §3: C1 per-corpus arming audit row instead of the shipped ARMING_REV; C2 each evidence row stores its write-time corpus_rev server-side; C3 AC-CT-3 half (3) names the stamp-verdict distribution; C4 per user: evidence recorded on a dirty working tree is counted under its own reason and does NOT satisfy the attestation floor (the user accepted that evidence must be recorded on a committed tree), no tree digest; C5 AC-CT-9(d)/AC-CT-10 re-baselined to classifyCaptureSource's three buckets; C6 echo texts match statements; C7/AC-CT-6 retired by correction per user (audit-id compare unreliable, full mirror check already in bun run test) — no corpus_rev pre-push compare is built; C8 occupancy probe hosted in lore verify's stamp step, reader in adapters/; C9 commands use bunx --bun vitest run. Plus user decision: lore done refuses unbound evidence once stamps are written. Re-approve. | - |
| CT-2 | Runner reads the stamp before and after the oracle | AC-CT-5 |
| CT-3 | Stamp axis, per-corpus arming row, audit-id resolution, unbound refused | AC-CT-3 |
| CT-4 | Blast-radius staleness through the shared git diff port | AC-CT-4 |
| CT-5 | Floor reads stamp then radius; one distribution predicate in assess and status | AC-CT-9 |
| CT-6 | Capture-source bucket site scan in the test chain | AC-CT-10 |
| CT-7 | Occupancy SKIPPED-and-continue in verify and status | AC-CT-8 |
| CT-9 | Plan gate on merged main | all |

No CT-8: R1's proposed T8 implemented AC-CT-6, which CT-1 retires by correction, so its artifacts (corpus_rev in the export index, the pre-push compare) are not built.

Dependencies: CT-1 blocks CT-2, CT-3, CT-4, CT-7; CT-2 blocks CT-3 and CT-7 (arming must not precede stamp writing, measured); CT-3 and CT-4 block CT-5; CT-5 blocks CT-6; every task blocks CT-9. Critical path CT-1 -> CT-2 -> CT-3 -> CT-5 -> CT-6.

## Invariants
- INV-1: no criterion is weakened to fit the code; an obsolete criterion is corrected on the spec with the reason, never silently dropped.
- INV-2: each criterion lands with its own red-first oracle at the path its command names (or the command is corrected first).

## Risk Register
| Risk | Impact | Mitigation |
|---|---|---|
| Criteria written 2026-08 assume code since rewritten | H | Done: R1 re-measured each against main cb55711d (knowledge-ac-ct-3-10-re-measured-on-main-cb55711d-verdicts-nine) |
| The not-built ledger hides the gap | M | Each ledger row names this plan; the plan's exit removes every row |

## Exit Criteria
AC-CT-3, 4, 5, 8, 9 and 10 (as corrected by CT-1) pass via lore verify on main; AC-CT-6 is retired on the spec with its reason; the test-governance not-built ledger holds no AC-CT row.
