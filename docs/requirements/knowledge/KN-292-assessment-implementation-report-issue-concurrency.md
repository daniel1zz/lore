---
id: KN-292
type: knowledge
role: knowledge
title: "Assessment: Implementation — report-issue concurrency contract (2026-07-31)"
status: approved
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PLAN-090
links:
  - {id: PLAN-090, type: informs}
---
# Assessment: partially_met (55/100)

Scope: plan `01KYV2PJ6MQZSSPAS5DN9VZWPK`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-IC-1 | 62 | e2e 'fifty runs only conforming outcomes' recorded pass. But T1 probe[4] shows 97/100 natural pairs are both-exit-0, so the harness is near-vacuous, and the ~1.5%/invocation dlopen crash (probe[5]: reproduces on zero-write 'lore list') means either flaky or an unrelated crash class counted as confo… | 01KYV2QBKFCBS9M09XHG0GY0KR (evidence [2] e2e pass, self-reported), 01KYV2QB5VSCGPFQA4C5MSMMD7 (probe[4]/probe[5] natural + zero-write controls) |
| AC-IC-2 | 70 | e2e 'forced contention control' pass, and T1 probe[3] independently shows the held BEGIN IMMEDIATE reliably forces failure (10/10 runs exits=(1,1)), so the control is not vacuous. Unverifiable that the fixture holds the txn for the full second-invocation duration or that the failure is the declared… | 01KYV2QBKFCBS9M09XHG0GY0KR (evidence [3]), 01KYV2QB5VSCGPFQA4C5MSMMD7 (probe[3] AC-IC-2-shaped control) |
| AC-IC-3 | 40 | check:no-timer-retry recorded pass, but T1 evidence[6] states two of the spec-named paths DO NOT EXIST (real paths are cli/commands/report-issue.ts and a different test dir). A grep over missing files returns zero matches vacuously. No evidence the spec's D3 path list was corrected. | 01KYV2QBKFCBS9M09XHG0GY0KR (evidence [4] lint pass), 01KYV2QB5VSCGPFQA4C5MSMMD7 (evidence [6] path existence check: MISSING) |
| AC-IC-4 | 66 | e2e 'failure message names contender and next action' pass; string/regex assertion is an appropriate oracle shape. But the declared template text is not in the bundle, T1 observed only bare 'Error: Storage failure: database is locked' (no source field, no retry line), so the added fields are unveri… | 01KYV2QBKFCBS9M09XHG0GY0KR (evidence [5]), 01KYV2QB5VSCGPFQA4C5MSMMD7 (probe[3] stderr sample lacks source/retry) |
| AC-IC-5 | 50 | e2e 'concurrent CLI invocations' pass recorded. But the removal half ('assertions at :626-627 are gone from the file') is a negative requirement a passing test cannot demonstrate, and the verify path (tests/unit/service/) contradicts the statement's path (tests/integration/cli/), which T1 flagged a… | 01KYV2QBKFCBS9M09XHG0GY0KR (evidence [6]), 01KYV2QB5VSCGPFQA4C5MSMMD7 (evidence [6] path mismatch) |
| AC-IC-6 | 58 | vitest classifier decision-table test recorded pass, satisfying the pure/no-spawn half. The second half — that the 50-run harness calls the classifier rather than re-implementing the rule — is a structural claim no test run here evidences, and no diff was provided to confirm the import. | 01KYV2QBKFCBS9M09XHG0GY0KR (evidence [1] unit test pass) |

## Gaps

- AC-IC-3 exists to stop the target being narrowed after the fact, yet T1 evidence[6] records that two of the three spec-named paths do not exist (packages/lore/src/adapters/cli/report-issue.ts and packages/lore/tests/integration/cli/issue-report-cross-corpus.bun.test.ts). A grep for setTimeout/sleep/backoff over missing files returns zero matches regardless of implementation, so the recorded check:no-timer-retry pass carries little signal, and no evidence shows the spec path list was fixed.
- diff_available=false and attested_evidence_ratio=0.00. All 8 T2 records are self-reported by agent:ic-t2-concurrency-contract with no output tails, so the classifier's purity, the harness's use of it, the fixture's transaction hold, and the stderr template are all uninspectable.
- The AC has two halves: the concurrent-invocations case asserts the contract, and the prior unconditional r1/r2 exitCode 0 assertions at :626-627 are gone. A passing 'concurrent CLI invocations' test evidences only the first half; absence of the old assertions needs a grep or diff oracle. The path discrepancy (statement says tests/integration/cli, command uses tests/unit/service) leaves it unclear which file was even inspected.
- T1 probe[4] shows 97/100 natural pairs are both-exit-0 and the only failures are L3-dlopen crashes; probe[5] proves that class reproduces on 120 zero-write read-only 'lore list' invocations. So the 50-run harness almost never exercises the failure branch, and its one recorded pass is consistent with either treating an unrelated startup crash as a conforming loud failure or with a ~1-in-20 flake that happened not to fire.
- The 'harness calls it rather than re-implementing the rule' clause is a code-structure property. The recorded vitest run on the classifier's own decision table cannot show that the 50-run harness imports it, and no diff is available to confirm.
- Plan D1 forbids any implementation commit before the exit code and message template are written into the spec's Contract Details via lore set. T1's six records are all probes; none evidences the spec write, so the 'declared' code/template that AC-IC-1/2/4 compare against is not shown anywhere in the bundle.

## Recommendations

- Update the D3 path list and the AC-IC-5 file reference to the real paths (packages/lore/src/adapters/cli/commands/report-issue.ts and the actual cross-corpus test path), then re-run check:no-timer-retry.
- Make check:no-timer-retry fail when a path in the spec-derived list does not exist, rather than reporting zero matches.
- Add an absence oracle for AC-IC-5 (grep the file for the removed r1/r2 exitCode 0 assertions) and an import/structural check for AC-IC-6's harness-calls-classifier clause.
- Require the diff and the spec Contract Details text in the audit bundle, and attest at least the lint and e2e oracles by a second recorder.
- State explicitly whether a dlopen/compiled-binary startup crash is a conforming loud failure; if not, have the classifier reject that class and the 50-run harness treat it as a run-level error.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 93613ms
- Retried: false
- Truncated sections: (none)
- Reasoning clipped for: AC-IC-1, AC-IC-2, AC-IC-4, AC-IC-5

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 58 | 0.6 | evidence | All 6 ACs have recorded passes, but T1's own probes show the AC-IC-3 grep target is nonexistent, the 50-run sample is near-vacuous, and two structural/negative clauses go unverified. |
| evidence_integrity | 45 | low | absence | 0 attested of 14 records, one recorder per task, no diff, no spec contract text, no oracle output tails for T2. T1's manual probes are unusually detailed and credible by contrast. |
| scope_fidelity | 55 | low | absence | No diff to bound the change. Spec-named D3/AC-IC-5 paths are wrong per T1 and the verify command silently substitutes a different path — unexplained target drift on the anti-narrowing AC. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | blocker | AC-IC-3 | AC-IC-3 exists to stop the target being narrowed after the fact, yet T1 evidence[6] records that two of the three spec-named paths do not exist (packages/lore/src/adapters/cli/report-issue.ts and packages/lore/tests/integration/cli/issue-report-cross-corpus.bun.test.ts). A grep for setTimeout/sleep/backoff over missing files returns zero matches regardless of implementation, so the recorded check:no-timer-retry pass carries little signal, and no evidence shows the spec path list was fixed. |
| evidence_integrity | major | — | diff_available=false and attested_evidence_ratio=0.00. All 8 T2 records are self-reported by agent:ic-t2-concurrency-contract with no output tails, so the classifier's purity, the harness's use of it, the fixture's transaction hold, and the stderr template are all uninspectable. |
| outcome | major | AC-IC-5 | The AC has two halves: the concurrent-invocations case asserts the contract, and the prior unconditional r1/r2 exitCode 0 assertions at :626-627 are gone. A passing 'concurrent CLI invocations' test evidences only the first half; absence of the old assertions needs a grep or diff oracle. The path discrepancy (statement says tests/integration/cli, command uses tests/unit/service) leaves it unclear which file was even inspected. |
| outcome | major | AC-IC-1 | T1 probe[4] shows 97/100 natural pairs are both-exit-0 and the only failures are L3-dlopen crashes; probe[5] proves that class reproduces on 120 zero-write read-only 'lore list' invocations. So the 50-run harness almost never exercises the failure branch, and its one recorded pass is consistent with either treating an unrelated startup crash as a conforming loud failure or with a ~1-in-20 flake that happened not to fire. |
| outcome | minor | AC-IC-6 | The 'harness calls it rather than re-implementing the rule' clause is a code-structure property. The recorded vitest run on the classifier's own decision table cannot show that the 50-run harness imports it, and no diff is available to confirm. |
| evidence_integrity | minor | — | Plan D1 forbids any implementation commit before the exit code and message template are written into the spec's Contract Details via lore set. T1's six records are all probes; none evidences the spec write, so the 'declared' code/template that AC-IC-1/2/4 compare against is not shown anywhere in the bundle. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| spec | Update the D3 path list and the AC-IC-5 file reference to the real paths (packages/lore/src/adapters/cli/commands/report-issue.ts and the actual cross-corpus test path), then re-run check:no-timer-retry. | T1 evidence[6] shows two named paths are missing, which makes the anti-narrowing grep vacuous. |
| process | Make check:no-timer-retry fail when a path in the spec-derived list does not exist, rather than reporting zero matches. | A missing-file zero-match is indistinguishable from a clean file, defeating AC-IC-3's purpose. |
| plan | Add an absence oracle for AC-IC-5 (grep the file for the removed r1/r2 exitCode 0 assertions) and an import/structural check for AC-IC-6's harness-calls-classifier clause. | Passing tests cannot evidence removal or call-graph structure. |
| process | Require the diff and the spec Contract Details text in the audit bundle, and attest at least the lint and e2e oracles by a second recorder. | attested ratio 0.00 with no diff leaves every structural AC clause unverifiable. |
| spec | State explicitly whether a dlopen/compiled-binary startup crash is a conforming loud failure; if not, have the classifier reject that class and the 50-run harness treat it as a run-level error. | probe[5] shows the class occurs with zero writes, so it is not the contended-writer failure the contract governs. |

## Unverifiable Materials

- Implementation diff: diff_available=false; no source for classifier, CLI failure path, harness, or fixture could be inspected.
- Spec Contract Details (literal exit code + stderr template): Not present in the bundle and no T1 evidence record shows the lore set write, so 'the declared code/template' cannot be checked.
- check:no-timer-retry script definition and its spec-derived path list: Only a pass/fail line is recorded; whether it reads paths from the spec and how it handles missing files is unknown.
- Harness-to-classifier wiring for AC-IC-6: No diff or import-level oracle; the unit test run only exercises the classifier in isolation.
- T2 oracle output tails: All 8 T2 records carry result=pass with no captured output, unlike T1's records, so nothing corroborates them.

## Rubric Warnings

- Dimension "evidence_integrity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.
- Dimension "scope_fidelity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 6 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.00
