---
id: KN-498
type: knowledge
role: knowledge
title: "Assessment: Close the falsify green-control gap: an unrunnable scratch worktree must record inconclusive, never a machine-proven red (2026-08-21)"
status: archived
priority: medium
created: 2026-08-21
updated: 2026-10-23
tags: []
parent: PLAN-136
links:
  - {id: PLAN-136, type: informs}
---
# Assessment: inconclusive (N/A (fully truncated))

Scope: plan `01M0HGHQ23SN3P83DR79RJ8VZQ`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-FR-1 | 25 | 0 pass / 0 fail recorded. No task in this plan targets checkpoint-registry coverage and no oracle run is present. Mitigation: predates this defect-closure plan, which only worked AC-FR-11; no contradicting evidence either. | — |
| AC-FR-2 | 25 | 0 pass / 0 fail. The diff touches attested-red.test.ts (AC-FR-2's oracle file) yet no AC-FR-2 run is recorded, so post-change status of that oracle is unverified. Mitigation: out of this plan's worked scope. | 01M0HGKJMF4J3W7QMJCE5622ZQ (diff edits AC-FR-2's oracle file; no AC-FR-2 run recorded) |
| AC-FR-3 | 25 | 0 pass / 0 fail. The new green-control STATE test asserts isolation on the new path, but AC-FR-3's own oracle command was never run after the change. Mitigation: outside this plan's worked scope. | 01M0HGKJMF4J3W7QMJCE5622ZQ (STATE test covers isolation on the new early-exit path only) |
| AC-FR-4 | 25 | 0 pass / 0 fail; no oracle run, no diff touching the evidence-tail guard. Mitigation: not worked by this plan. | — |
| AC-FR-5 | 25 | 0 pass / 0 fail; no capture-source visibility work or run in these materials. Note: this plan adds a new 'inconclusive' outcome, which plausibly widens the distribution AC-FR-5 must enumerate, and that is unverified. | — |
| AC-FR-6 | 25 | 0 pass / 0 fail; no mirror-export run recorded. Mitigation: not worked by this plan. | — |
| AC-FR-7 | 25 | 0 pass / 0 fail; no drift-check run recorded. Mitigation: not worked by this plan. | — |
| AC-FR-8 | 25 | 0 pass / 0 fail; no gate-trace run recorded. Mitigation: not worked by this plan. | — |
| AC-FR-9 | 25 | 0 pass / 0 fail. Notable risk: this plan adds new pasteable guidance text in the CLI/service messages ('Fix the scratch environment...'), and AC-FR-9's scanner was never re-run against it. | 01M0HGKJMF4J3W7QMJCE5622ZQ (new refusal/outcome messages added in verify.ts and verify-runner-service.ts) |
| AC-FR-10 | 25 | 0 pass / 0 fail; no full-corpus mirror parity run recorded. Mitigation: not worked by this plan. | — |
| AC-FR-11 | 76 | Implementation matches the plan: green control before mutation, same executor/spawn shape, inconclusive + no attestation, no mutation applied. 6 tests pass (1 attested), red-first row exists. Gaps: oracle observes an injected recorder, not a persisted row; CLI branch untested; own falsifier run cam… | 01M0HGKJMF4J3W7QMJCE5622ZQ (ev[1] red-first expected-fail; ev[2]/[5] pass (1 attested); ev[3] tsc; ev[4] scoped regression; ev[6] inconclusive falsify run) |

## Gaps

- The AC's oracle observes an injected recorder spy in packages/lore/tests/unit/service/attested-red.test.ts (recorder.calls[0].entry), not a persisted evidence row, and no test drives the --falsify branch in packages/lore/src/adapters/cli/commands/verify.ts. The task explicitly forbade service-level-only evidence for this criterion.
- In packages/lore/src/service/verify-runner-service.ts a green control that fails to LAUNCH returns err(STORE_ERROR) and records nothing, so that unrunnable-environment shape produces no inconclusive row at all — inconsistent with the outcome the criterion names for an unusable scratch environment.
- attested_fail=0 for AC-FR-11: its own falsifier run recorded result=inconclusive (vitest/config unresolvable in the scratch worktree), so the criterion has no machine-proven red. Correct behavior of the new guard, but the discriminating power of AC-FR-11's oracle remains unattested by the runner.
- packages/lore/tests/unit/service/attested-red.test.ts and packages/lore/tests/unit/service/falsifier-execution-root.bun.test.ts were both modified (the latter's command changed to exit 0 unmutated) but neither AC-FR-2 nor AC-FR-3 records a post-change oracle run; ev[7] runs the whole file with no ac_ref.
- New user-facing guidance text was added in packages/lore/src/adapters/cli/commands/verify.ts and packages/lore/src/service/verify-runner-service.ts without re-running AC-FR-9's suggested-command scanner, the exact recurrence shape that AC warns about.

## Recommendations

- Add a task that asserts the PERSISTED inconclusive row and the --falsify CLI exit code/message end-to-end, so AC-FR-11 is satisfied by an oracle observing the recorded result rather than an injected recorder spy.
- Declare extra.ac_scope on this plan (AC-FR-11 only) or schedule re-runs of AC-FR-2/AC-FR-3/AC-FR-9, whose subject files or message text this diff changed.
- Require a knowledge doc whenever a defect's cause is an oracle that cannot discriminate (here: exit-code-only comparison); capture the green-control pattern for reuse.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 81349ms
- Retried: false
- Truncated sections: task:task-run-the-unmutated-green-control-before-the-mutation-and
- Reasoning clipped for: AC-FR-11
- Overall confidence: low (degraded by truncation)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 74 | 0.72 | evidence | AC-FR-11's mechanism is genuinely built and pinned (exit-code coincidence, reverse control, timeout, isolation, exactly-one-row). CLI surface required by the task is unevidenced; 10 sibling ACs uncov… |
| evidence_integrity | 62 | 0.7 | evidence | Red-first row, tsc, scoped regression, and a dogfooded inconclusive run present; but 1/7 attested, oracle inspects a spy not a stored row, and the red tail is not shown here. |
| scope_fidelity | 88 | 0.8 | evidence | All four touched files are the plan's targets or necessary collateral; the sibling-test command change is explained inline. No drift beyond the green-control change. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-FR-11 | The AC's oracle observes an injected recorder spy in packages/lore/tests/unit/service/attested-red.test.ts (recorder.calls[0].entry), not a persisted evidence row, and no test drives the --falsify branch in packages/lore/src/adapters/cli/commands/verify.ts. The task explicitly forbade service-level-only evidence for this criterion. |
| outcome | minor | AC-FR-11 | In packages/lore/src/service/verify-runner-service.ts a green control that fails to LAUNCH returns err(STORE_ERROR) and records nothing, so that unrunnable-environment shape produces no inconclusive row at all — inconsistent with the outcome the criterion names for an unusable scratch environment. |
| evidence_integrity | major | AC-FR-11 | attested_fail=0 for AC-FR-11: its own falsifier run recorded result=inconclusive (vitest/config unresolvable in the scratch worktree), so the criterion has no machine-proven red. Correct behavior of the new guard, but the discriminating power of AC-FR-11's oracle remains unattested by the runner. |
| evidence_integrity | minor | AC-FR-2 | packages/lore/tests/unit/service/attested-red.test.ts and packages/lore/tests/unit/service/falsifier-execution-root.bun.test.ts were both modified (the latter's command changed to exit 0 unmutated) but neither AC-FR-2 nor AC-FR-3 records a post-change oracle run; ev[7] runs the whole file with no ac_ref. |
| outcome | minor | AC-FR-9 | New user-facing guidance text was added in packages/lore/src/adapters/cli/commands/verify.ts and packages/lore/src/service/verify-runner-service.ts without re-running AC-FR-9's suggested-command scanner, the exact recurrence shape that AC warns about. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Add a task that asserts the PERSISTED inconclusive row and the --falsify CLI exit code/message end-to-end, so AC-FR-11 is satisfied by an oracle observing the recorded result rather than an injected recorder spy. | The criterion's prose and the task's ⛔ constraint both name the recorded RESULT; current evidence stops at the service port. |
| plan | Declare extra.ac_scope on this plan (AC-FR-11 only) or schedule re-runs of AC-FR-2/AC-FR-3/AC-FR-9, whose subject files or message text this diff changed. | 10 of 11 in-scope ACs show 0/0 coverage, so an unscoped plan reads as broadly unevidenced. |
| process | Require a knowledge doc whenever a defect's cause is an oracle that cannot discriminate (here: exit-code-only comparison); capture the green-control pattern for reuse. | 0 linked knowledge docs; the same false-match shape can recur in any other exit-code-only gate. |

## Unverifiable Materials

- Persisted evidence rows / lore corpus state (only summary rows and tails shown): Cannot confirm the recorded row's attestation absence independently of the in-test recorder spy.
- Red-first evidence [1] output tail (4284 bytes, not shown): Content of the claimed pre-fix failure could not be inspected.
- Oracle runs for AC-FR-1 through AC-FR-10: No evidence records present; coverage table shows 0 pass / 0 fail for each.
- Declaration of AC-FR-11's own falsifier via `lore ac set --falsifier-*`: Task text is truncated mid-command and no confirming evidence row appears.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 7
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 11 declared criteria
- Task evidence: 1 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.14
