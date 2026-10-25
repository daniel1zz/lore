---
id: KN-294
type: knowledge
role: knowledge
title: "Assessment: Implementation — declared timeout budgets for spawn-heavy tests (2026-07-31)"
status: archived
priority: medium
created: 2026-07-31
updated: 2026-10-23
tags: []
parent: PLAN-097
links:
  - {id: PLAN-097, type: informs}
---
# Assessment: partially_met (56/100)

Scope: plan `01KYV2PHR4S9HMTFHVM1SSE0QX`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-TB-1 | 18 | The only recorded run of the AC's own verify command (`bun run check:test-budgets`) is result=fail (T1 ev[1]). T2 asserts the oracle must pass on the tree after the declaration but records no re-run. Facts show 0 pass / 1 fail; the AC gate is contradicted, not met. | 01KYV2QAAJA5YRY1EMDWKG70NM (ev[1] lint check:test-budgets = fail), 01KYV2QARE92PK8D3KQ6ET2VVG (T2 claims oracle should then pass; no lint re-run recorded) |
| AC-TB-2 | 70 | Exact verify command run with the 'control fixture is reported' filter, result=pass (T1 ev[2]), plus a full-suite pass (ev[6]) and typecheck (ev[5]). Gap: self-reported only (0 attested), and no diff to confirm the fixture really has 3 spawns and no timeout. | 01KYV2QAAJA5YRY1EMDWKG70NM (ev[2], ev[5], ev[6]) |
| AC-TB-3 | 70 | Exact verify command run with 'threshold boundary two versus three', result=pass (T1 ev[3]). Gap: unattested self-report; without the diff the 2-vs-3 boundary fixture and the oracle's counting rule cannot be inspected. | 01KYV2QAAJA5YRY1EMDWKG70NM (ev[3], ev[6]) |
| AC-TB-4 | 66 | e2e run of the exact command on cli-plan-promote-advisory.bun.test.ts, result=pass (T2 ev[1]). Gaps: unattested; no diff showing the declared timeout value or that it is a declaration rather than a symptom bump; isolation pass does not exercise the under-load failure described. | 01KYV2QARE92PK8D3KQ6ET2VVG (ev[1] e2e pass) |
| AC-TB-5 | 70 | Exact verify command run with 'unparseable file is loud', result=pass (T1 ev[4]). Gap: unattested self-report; the 'never a silent skip' and path-in-output behaviour cannot be inspected without the oracle source or diff. | 01KYV2QAAJA5YRY1EMDWKG70NM (ev[4], ev[6]) |

## Gaps

- The AC's verify command `bun run check:test-budgets` is recorded as result=fail and never re-run after T2 declared the timeout. Deterministic facts confirm 0 pass / 1 fail. The plan's central claim — that the oracle exits 0 on the repo tree once the reported instance declares a timeout — has no supporting run.
- attested_evidence_ratio is 0.00 across both tasks; every oracle result is self-reported by the agent that wrote the code. With diff_available=false, none of the 7 records can be cross-checked against the artifacts they describe.
- Regression signals report tests_touched=false even though T1 is credited with adding scripts/tests/check-test-budgets.test.ts and four -t filtered runs against it. Either the signal or the evidence is wrong; the materials cannot distinguish which.
- The e2e pass is an isolation run. The documented defect was a load-dependent 6222ms overrun with an empty stderr from a killed child; an isolated green run does not demonstrate the declared budget is adequate under the conditions that produced the failure.
- No diff is available, so it cannot be confirmed that T2 declared a timeout on the AC-VRW-5b case only, rather than broadly bumping timeouts or relaxing the oracle threshold to make AC-TB-1 pass.

## Recommendations

- Require the plan-level lint gate (`bun run check:test-budgets`) to be re-run and recorded as passing after the last task that changes the tree, before archiving any task in the plan.
- Block bundle assembly when diff_available=false for plans that add executable checks; attach the diff for scripts/check-test-budgets.ts, package.json, the fixtures, and the modified test file.
- Add a task that re-verifies AC-TB-4 under contention (parallel suite run or repeated runs) rather than a single isolated invocation.
- Route at least the lint and full-suite oracles through an independent recorder (CI) so attested_count is non-zero.
- Capture a short knowledge doc describing the >=3-spawn declaration rule and how to satisfy it.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 54737ms
- Retried: false
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 52 | 0.75 | evidence | 4/5 ACs have a passing run of their exact verify command, but AC-TB-1 — the tree-level gate the whole plan exists to turn green — is recorded only as a failure with no re-run. |
| evidence_integrity | 42 | 0.8 | evidence | Commands match the ACs verbatim, but 0/7 records are attested, no diff backs them, tests_touched=false contradicts the plan, and a stale failing lint result was left unrefreshed. |
| scope_fidelity | 68 | low | absence | Two tasks map cleanly onto the 5 declared ACs with no extra ACs claimed, but with no diff there is no way to confirm the edits stayed inside the oracle plus the one test file. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | blocker | AC-TB-1 | The AC's verify command `bun run check:test-budgets` is recorded as result=fail and never re-run after T2 declared the timeout. Deterministic facts confirm 0 pass / 1 fail. The plan's central claim — that the oracle exits 0 on the repo tree once the reported instance declares a timeout — has no supporting run. |
| evidence_integrity | major | — | attested_evidence_ratio is 0.00 across both tasks; every oracle result is self-reported by the agent that wrote the code. With diff_available=false, none of the 7 records can be cross-checked against the artifacts they describe. |
| evidence_integrity | minor | — | Regression signals report tests_touched=false even though T1 is credited with adding scripts/tests/check-test-budgets.test.ts and four -t filtered runs against it. Either the signal or the evidence is wrong; the materials cannot distinguish which. |
| outcome | minor | AC-TB-4 | The e2e pass is an isolation run. The documented defect was a load-dependent 6222ms overrun with an empty stderr from a killed child; an isolated green run does not demonstrate the declared budget is adequate under the conditions that produced the failure. |
| scope_fidelity | minor | — | No diff is available, so it cannot be confirmed that T2 declared a timeout on the AC-VRW-5b case only, rather than broadly bumping timeouts or relaxing the oracle threshold to make AC-TB-1 pass. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require the plan-level lint gate (`bun run check:test-budgets`) to be re-run and recorded as passing after the last task that changes the tree, before archiving any task in the plan. | AC-TB-1's only record is a pre-fix failure, leaving the plan's headline outcome unevidenced. |
| process | Block bundle assembly when diff_available=false for plans that add executable checks; attach the diff for scripts/check-test-budgets.ts, package.json, the fixtures, and the modified test file. | Without a diff no reviewer can tell a declaration from a symptom-fix bump or a loosened threshold. |
| plan | Add a task that re-verifies AC-TB-4 under contention (parallel suite run or repeated runs) rather than a single isolated invocation. | The reported failure was load-dependent; an isolated pass does not exercise it. |
| process | Route at least the lint and full-suite oracles through an independent recorder (CI) so attested_count is non-zero. | All evidence is currently self-reported by the implementing agents. |
| plan | Capture a short knowledge doc describing the >=3-spawn declaration rule and how to satisfy it. | A new repo-wide gate with 0 linked knowledge docs will surprise contributors. |

## Unverifiable Materials

- Implementation diff (scripts/check-test-budgets.ts, package.json check:test-budgets entry, scripts/tests/check-test-budgets.test.ts, fixtures, cli-plan-promote-advisory.bun.test.ts): diff_available=false; no source shown, so counting logic, threshold behaviour, unparseable-file handling, and the declared timeout value cannot be inspected.
- A post-T2 run of `bun run check:test-budgets`: Only a pre-fix failing run exists; the passing tree-level state asserted by AC-TB-1 and T2 has no recorded run.
- Independent attestation for any oracle result: attested_count is 0 for both tasks; all results carry agent recorders from the implementing agents.
- Under-load behaviour of the AC-VRW-5b case: Only an isolated e2e run is recorded; the 6222ms contention scenario that motivated the change was not reproduced.

## Rubric Warnings

- Dimension "scope_fidelity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 5 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.00
