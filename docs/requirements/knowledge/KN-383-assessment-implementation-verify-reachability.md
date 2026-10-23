---
id: KN-383
type: knowledge
role: knowledge
title: "Assessment: Implementation — verify reachability advisory, reachability-aware feeding pack, exemption kind (2026-07-28)"
status: archived
priority: medium
created: 2026-07-28
updated: 2026-10-23
tags: []
parent: PLAN-114
links:
  - {id: PLAN-114, type: informs}
---
# Assessment: met (80/100)

Scope: plan `01KYKCZRBKJMG7RF3BZ6EMF1XP`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-VRW-1 | 88 | 7 pass / 0 fail, 5 attested. verify-reachability.test.ts green (14 tests) across both tasks and re-runs. Truth-table content and 'verdict unchanged' assertions unverifiable without diff/test source. | 01KYKD05RT1PZDFBSP8F8KRT7R (T1 ev[1],[6],[10],[15] — 14 tests pass), 01KYKEK36Z77JYEJQ3GJAFC49J (T2 ev[2],[6],[11] — bundled with gate-enforcer/review-service suites) |
| AC-VRW-2 | 86 | 6 pass / 0 fail, 5 attested; feed-attestation-reachability.test.ts green (8 tests) repeatedly. Byte-identical regression pin and 'zero occurrences of Recovery: run' claims rest on test names alone — no diff or test body shown. | 01KYKD05RT1PZDFBSP8F8KRT7R (T1 ev[2],[7],[11],[16]) |
| AC-VRW-3 | 88 | 6 pass / 0 fail, 5 attested; attestation-exempt-kind.test.ts green (19 tests) across all re-runs, exceeding the AC's minimum case count. Enum membership and checkPlanClose 4-row table not directly inspectable. | 01KYKD05RT1PZDFBSP8F8KRT7R (T1 ev[3],[8],[12],[17]) |
| AC-VRW-4 | 90 | 6 pass / 0 fail, 5 attested. tsc oracle 'bun run typecheck' exits 0 across core/lore/lore-tests/scripts/dashboard, output tail shows per-project tsc invocations. Strongest-evidenced AC. | 01KYKD05RT1PZDFBSP8F8KRT7R (T1 ev[4],[9],[13],[18]), 01KYKEK36Z77JYEJQ3GJAFC49J (T2 ev[1],[9],[14]) |
| AC-VRW-5 | 68 | Mixed: 3 pass / 2 fail (2 attested fail). Both failures are AC-VRW-5b (advisory lines != 0 on reachable-spec parent). Final runs are 2 pass/0 fail with RED-before/GREEN-after confirmed, so the end state is met, but the trail is non-monotonic. | 01KYKEK36Z77JYEJQ3GJAFC49J (ev[4] RED confirmed pre-fix; ev[10] fail; ev[15] 2 pass 0 fail), 01KYKD05RT1PZDFBSP8F8KRT7R (ev[14] fail; ev[19] 2 pass 0 fail) |

## Gaps

- T1 declared M1 complete while planPromoteReachabilityAdvisory had zero consumers on the approve path (GateEnforcer/ReviewService/CLI). The unit tests for M1 passed against dead code; only a post-merge live probe exposed it, requiring T2. Unit-green is therefore not sufficient signal for the advisory mechanism in this bundle.
- AC-VRW-5 has 2 attested fails against 3 passes, both on the 5b branch (expected 0 advisory lines, got >0). The bundle gives no commit/SHA per evidence row, so 'the failures are superseded' is inferred from recorder ordering rather than proven.
- diff_available=false and tests_touched=false. AC-VRW-2's two substantive requirements (reachable branch byte-identical to prior text; unreachable branch contains zero 'Recovery: run' and names both real options) are content assertions that cannot be checked from pass counts. Same for AC-VRW-3's enum membership and AC-VRW-1's verdict-unchanged claim.
- Plan states 'One task, one implementer'; execution ran two tasks. T2 is remedial rather than new scope, but the plan was not visibly amended, so the scope statement in the plan no longer describes what happened.
- Knowledge capture is empty (0 linked docs). The inert-mechanism lesson is exactly the class of retro lesson this spec was created to mechanize, and it was not written down.

## Recommendations

- Require a reader-existence oracle for any new exported predicate/advisory: a script AC that greps the live enforcement path for at least one call site and fails if the count is zero.
- Include the diff (or at least the touched-file list plus the changed feedAttestationFloor text) in the audit bundle for content-assertion ACs.
- Stamp each evidence row with the commit SHA it ran against and mark superseded failing rows stale, so an AC's pass/fail tally is interpretable without ordering heuristics.
- Add a knowledge-capture obligation to this spec's close conditions, naming the inert-advisory incident as the doc to write.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 62974ms
- Retried: false
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 82 | 0.7 | evidence | All 5 ACs end green with attested oracle runs; M1 initially shipped inert (no consumers) and required T2 remediation, which the e2e now covers end-to-end on dist/lore. |
| evidence_integrity | 78 | 0.65 | evidence | Three oracle kinds, 24 attested runs, RED-before/GREEN-after on the e2e. Weakened by 2 attested AC-VRW-5 failures with no commit mapping and no diff to corroborate. |
| scope_fidelity | 76 | 0.6 | evidence | Plan declared one task; a second (T2) was added post-merge. Drift is explained and remedial, stays on M1's stated surface, and D1 (advisory never changes verdict) is restated. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-VRW-5 | T1 declared M1 complete while planPromoteReachabilityAdvisory had zero consumers on the approve path (GateEnforcer/ReviewService/CLI). The unit tests for M1 passed against dead code; only a post-merge live probe exposed it, requiring T2. Unit-green is therefore not sufficient signal for the advisory mechanism in this bundle. |
| evidence_integrity | major | AC-VRW-5 | AC-VRW-5 has 2 attested fails against 3 passes, both on the 5b branch (expected 0 advisory lines, got >0). The bundle gives no commit/SHA per evidence row, so 'the failures are superseded' is inferred from recorder ordering rather than proven. |
| evidence_integrity | major | — | diff_available=false and tests_touched=false. AC-VRW-2's two substantive requirements (reachable branch byte-identical to prior text; unreachable branch contains zero 'Recovery: run' and names both real options) are content assertions that cannot be checked from pass counts. Same for AC-VRW-3's enum membership and AC-VRW-1's verdict-unchanged claim. |
| scope_fidelity | minor | — | Plan states 'One task, one implementer'; execution ran two tasks. T2 is remedial rather than new scope, but the plan was not visibly amended, so the scope statement in the plan no longer describes what happened. |
| outcome | minor | — | Knowledge capture is empty (0 linked docs). The inert-mechanism lesson is exactly the class of retro lesson this spec was created to mechanize, and it was not written down. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require a reader-existence oracle for any new exported predicate/advisory: a script AC that greps the live enforcement path for at least one call site and fails if the count is zero. | M1 passed unit tests as dead code and shipped inert; only a post-merge probe caught it. |
| plan | Include the diff (or at least the touched-file list plus the changed feedAttestationFloor text) in the audit bundle for content-assertion ACs. | AC-VRW-2/3 are string- and enum-content claims that pass counts cannot substantiate. |
| process | Stamp each evidence row with the commit SHA it ran against and mark superseded failing rows stale, so an AC's pass/fail tally is interpretable without ordering heuristics. | AC-VRW-5 shows 2 attested fails; their supersession is currently inferred, not recorded. |
| spec | Add a knowledge-capture obligation to this spec's close conditions, naming the inert-advisory incident as the doc to write. | Zero knowledge docs linked despite a directly on-topic retro lesson. |

## Unverifiable Materials

- Source diff for gate-predicates.ts, checkpoint-registry.ts, schemas.ts, gate-enforcer/review-service/CLI approve: diff_available=false; no code shown, so implementation-content claims are judged only from oracle pass counts and task prose.
- Bodies of the three vitest files and the bun e2e file: Only counts and one truncated failure excerpt are present; assertion strength (byte-identical pin, zero 'Recovery: run', verdict-unchanged) cannot be inspected.
- Commit identity for each evidence row on AC-VRW-5: No SHA per row, so which runs are pre-fix vs post-fix rests on recorder timestamps and narrative.

## Facts Summary

- AC coverage: 5 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.71
